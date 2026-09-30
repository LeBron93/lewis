/*
 * MilkTea.js — Loon 定时任务：奶茶品牌自动签到
 *
 * Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
 * cron "0 30 8 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/MilkTea.js, tag=奶茶签到, timeout=90, enable=true
 *
 * 每天 8:30 对已配置凭证的品牌各执行一次签到，完成后发一条横幅通知汇总结果。
 *
 * 凭证配置（两种方式，优先级从高到低）：
 *   1. BoxJs 可视化配置：订阅 Scripts/MilkTea.boxjs.json，在 BoxJs 面板里粘贴各品牌的 token
 *   2. cron 的 argument 参数：JSON 字符串，如 {"mxbc":"token1&token2","nx":"token","chagee":"token#userId"}
 *
 * 各品牌 token 抓取方法（iPhone：Loon 开启 MITM 后，在对应小程序里点一次"签到"，
 * 在 Loon「请求记录」里找到对应请求，复制请求头里的 token）：
 *   蜜雪冰城：Host 为 mxsa.mxbc.net 的请求，复制请求头 Access-Token（eyJ0 开头）
 *             注意：重新打开小程序可能导致 token 失效，失效后需重新抓取
 *   奈雪的茶：打开"奈雪点单"小程序，抓任意请求头带 Authorization 的请求，
 *             复制 Authorization 的值（不要前面的 Bearer）
 *             注意：抓完后不要再手动打开小程序，否则 token 失效
 *   霸王茶姬（实验性）：抓小程序登录请求 https://webapi2.qmai.cn/web/seller/oauth/flash-sale-login，
 *             从返回 JSON 取 token 和 user.id，拼成 token#userId 填入
 *             该品牌官方疑似已上加密通道，签到可能失败，脚本会如实上报服务端返回
 *
 * 暂不支持：喜茶、茶百道、茶颜悦色（公开渠道无签到接口，需自行抓包补接口）
 *           古茗（仅有已过期限时活动脚本，无常规会员签到接口）
 *
 * 接口来源（公开开源脚本，2024 vintage，已实测接口存活）：
 *   蜜雪冰城 https://github.com/sudojia/AutoTaskScript (script/src/wx_mini/sudojia_mxbc.js)
 *   奈雪的茶   https://github.com/CHERWING/CHERWIN_SCRIPTS (NXDD.py)
 *   霸王茶姬   https://github.com/checkToke/yangtai (bwcj.js)
 */

var UA_MINI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50 NetType/WIFI MiniProgramEnv/iOS';

/* ================= 配置读取 ================= */

function readStore(key) {
  try {
    if (typeof $persistentStore !== 'undefined') {
      var v = $persistentStore.read(key);
      if (v) return v;
    }
  } catch (e) {}
  try {
    if (typeof $prefs !== 'undefined') {
      var v2 = $prefs.valueForKey(key);
      if (v2) return v2;
    }
  } catch (e2) {}
  return '';
}

function readArgument() {
  try {
    if (typeof $argument !== 'undefined' && $argument) return JSON.parse($argument);
  } catch (e) {}
  return {};
}

var ARG = readArgument();

function cfg(key) {
  var v = readStore(key);
  if (v) return v;
  if (ARG[key]) return ARG[key];
  return '';
}

function splitTokens(s) {
  return String(s || '').split(/[\n&]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}

/* 启用的品牌：BoxJs 的 milktea_brands（逗号分隔），默认 mxbc,nx */
function enabledBrands() {
  var raw = cfg('milktea_brands') || 'mxbc,nx';
  return raw.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

/* ================= 纯 JS 加密工具（Loon 无 Node crypto） ================= */

var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(bin) {
  var out = '', i;
  for (i = 0; i < bin.length; i += 3) {
    var a = bin.charCodeAt(i), b = i + 1 < bin.length ? bin.charCodeAt(i + 1) : 0, c = i + 2 < bin.length ? bin.charCodeAt(i + 2) : 0;
    var n = (a << 16) | (b << 8) | c;
    out += B64C[(n >>> 18) & 63] + B64C[(n >>> 12) & 63] + (i + 1 < bin.length ? B64C[(n >>> 6) & 63] : '=') + (i + 2 < bin.length ? B64C[n & 63] : '=');
  }
  return out;
}

function utf8bin(str) {
  return unescape(encodeURIComponent(str));
}

function bin2hex(bin) {
  var h = '';
  for (var i = 0; i < bin.length; i++) {
    var c = bin.charCodeAt(i).toString(16);
    h += c.length === 1 ? '0' + c : c;
  }
  return h;
}

function hex2bin(hex) {
  var s = '';
  for (var i = 0; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return s;
}

function str2words(bin) {
  var w = [], i;
  for (i = 0; i < bin.length; i++) w[i >>> 2] = (w[i >>> 2] || 0) | (bin.charCodeAt(i) << (24 - (i % 4) * 8));
  return w;
}

function words2bin(w, len) {
  var s = '';
  for (var i = 0; i < (len || w.length * 4); i++) s += String.fromCharCode((w[i >>> 2] >>> (24 - (i % 4) * 8)) & 255);
  return s;
}

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

/* MD5（二进制字符串输入 → 二进制摘要） */
function md5(bin) {
  function f(x, y, z) { return (x & y) | (~x & z); }
  function g(x, y, z) { return (x & z) | (y & ~z); }
  function h(x, y, z) { return x ^ y ^ z; }
  function ii(x, y, z) { return y ^ (x | ~z); }
  function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
  var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
           5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
           4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
           6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  var K = [];
  for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  var msgLen = bin.length;
  bin += '\x80';
  while (bin.length % 64 !== 56) bin += '\x00';
  var bitLen = msgLen * 8;
  for (i = 0; i < 8; i++) bin += String.fromCharCode((bitLen / Math.pow(256, i)) & 255);
  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var off = 0; off < bin.length; off += 64) {
    var M = [];
    for (i = 0; i < 16; i++) M[i] = bin.charCodeAt(off + i * 4) | (bin.charCodeAt(off + i * 4 + 1) << 8) | (bin.charCodeAt(off + i * 4 + 2) << 16) | (bin.charCodeAt(off + i * 4 + 3) << 24);
    var A = a0, B = b0, C = c0, D = d0, F, gi;
    for (i = 0; i < 64; i++) {
      if (i < 16) { F = f(B, C, D); gi = i; }
      else if (i < 32) { F = g(B, C, D); gi = (5 * i + 1) % 16; }
      else if (i < 48) { F = h(B, C, D); gi = (3 * i + 5) % 16; }
      else { F = ii(B, C, D); gi = (7 * i) % 16; }
      F = (F + A + K[i] + M[gi]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  function le(x) {
    return String.fromCharCode(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255);
  }
  return le(a0) + le(b0) + le(c0) + le(d0);
}

function md5hex(s) { return bin2hex(md5(utf8bin(s))); }

/* SHA1（二进制字符串输入 → 二进制摘要） */
function sha1(bin) {
  var msgLen = bin.length;
  bin += '\x80';
  while (bin.length % 64 !== 56) bin += '\x00';
  var bitHi = Math.floor(msgLen / 0x20000000), bitLo = (msgLen * 8) >>> 0;
  bin += String.fromCharCode((bitHi >>> 24) & 255, (bitHi >>> 16) & 255, (bitHi >>> 8) & 255, bitHi & 255,
                             (bitLo >>> 24) & 255, (bitLo >>> 16) & 255, (bitLo >>> 8) & 255, bitLo & 255);
  var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  var w = new Array(80), i, t;
  for (var off = 0; off < bin.length; off += 64) {
    for (i = 0; i < 16; i++) w[i] = bin.charCodeAt(off + i * 4) * 0x1000000 + bin.charCodeAt(off + i * 4 + 1) * 0x10000 + bin.charCodeAt(off + i * 4 + 2) * 0x100 + bin.charCodeAt(off + i * 4 + 3);
    for (i = 16; i < 80; i++) { t = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (t << 1) | (t >>> 31); }
    var a = h0, b = h1, c = h2, d = h3, e = h4, fv, kv;
    for (i = 0; i < 80; i++) {
      if (i < 20) { fv = (b & c) | (~b & d); kv = 0x5a827999; }
      else if (i < 40) { fv = b ^ c ^ d; kv = 0x6ed9eba1; }
      else if (i < 60) { fv = (b & c) | (b & d) | (c & d); kv = 0x8f1bbcdc; }
      else { fv = b ^ c ^ d; kv = 0xca62c1d6; }
      t = (((a << 5) | (a >>> 27)) + fv + e + kv + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return words2bin([h0, h1, h2, h3, h4]);
}

/* SHA256（二进制字符串输入 → 二进制摘要） */
function sha256(bin) {
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  var msgLen = bin.length;
  bin += '\x80';
  while (bin.length % 64 !== 56) bin += '\x00';
  var bitHi = Math.floor(msgLen / 0x20000000), bitLo = (msgLen * 8) >>> 0;
  bin += String.fromCharCode((bitHi >>> 24) & 255, (bitHi >>> 16) & 255, (bitHi >>> 8) & 255, bitHi & 255,
                             (bitLo >>> 24) & 255, (bitLo >>> 16) & 255, (bitLo >>> 8) & 255, bitLo & 255);
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64), i;
  for (var off = 0; off < bin.length; off += 64) {
    for (i = 0; i < 16; i++) w[i] = (bin.charCodeAt(off + i * 4) << 24) | (bin.charCodeAt(off + i * 4 + 1) << 16) | (bin.charCodeAt(off + i * 4 + 2) << 8) | bin.charCodeAt(off + i * 4 + 3);
    for (i = 16; i < 64; i++) {
      var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7], t1, t2;
    for (i = 0; i < 64; i++) {
      t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return words2bin(H);
}

function hmacSha1(keyBin, msgBin) {
  var bs = 64;
  if (keyBin.length > bs) keyBin = sha1(keyBin);
  while (keyBin.length < bs) keyBin += '\x00';
  var o = '', p = '', i;
  for (i = 0; i < bs; i++) { o += String.fromCharCode(keyBin.charCodeAt(i) ^ 0x5c); p += String.fromCharCode(keyBin.charCodeAt(i) ^ 0x36); }
  return sha1(o + sha1(p + msgBin));
}
var MXBC_N_HEX = 'adca951d1d924a950f4b2fa948252a619e1aa391eec7725816b960d15afce8bf7d1dbb6df97029b5de6a89df3ce2a8b0b0b2d75092e5e8f6c38f221f78b7a9f30474eea98035c21ad49d0aca7eff57e3f877415933c13fb159f944f8ab9b259a1ef9d68b2a40de6635569d492ef28bf4139bf00030027e7b44840c224995002d7f5480d0d33db8f911278823e573b59fca385b111cc4df0dbd46211fdd01cd662f9b986e1d21d856bf7f144f81fede24e7961a2ca07ac9770968f451ed77ab05fd3dc1bb9252577d3a08e7be8c63e03bd36edad1a678f5084a9f2b0c1a14ddb450a4b181b49703f3ddb211d7a36f97134b29a9dcda1f882d31506cc5bf6370d1';
var MXBC_D_HEX = '91937d7eab13acd7d9bcc04acbbd1e183128dd5553afcbef4ff1aed10fa7848b4a91ca3bdfd2fd8d73a6c8a0afcea9418071fe7c66e0a1597b0c7da7e125effd3a017d1d8ce0fb1c2076ffe009ab7882e4d17872f130725aec242a8b26ac4a3e24ae60f1a7ce38bd62f68fc00acc6f415fdfa29575a1d1330e7c91f172b396361ef0ea878c7eb203144bb9121104f8603cc20cf940a0416017dae55e78745154baa59b6fab7711ee947803d86f0e05fdc14eb39f5746772e0c117229724b99921c1ba832e67e81c77897394488d13fb588461d82a1d8deb603c513e495ed27631029af6096deb7860b83e42297438a47db3d4b505b39b81c6c2f56c5472b4e01';

/* RSA-SHA256 签名（蜜雪冰城 query 参数 sign 用；BigInt 实现，Loon 可用） */
var RSA_K = 256; /* 2048 bit */

function modPow(base, exp, mod) {
  var r = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}

function binToBigInt(bin) {
  var h = bin2hex(bin);
  return BigInt('0x' + h);
}

function bigIntToBin(n, len) {
  var h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  while (h.length < len * 2) h = '00' + h;
  return hex2bin(h);
}

/* PKCS#1 v1.5 + SHA256，输出 base64url（无填充），与原脚本 getSHA256withRSA 等价 */
function rsaSignSha256(content) {
  var digest = sha256(utf8bin(content));
  var t = hex2bin('3031300d060960864801650304020105000420') + digest; /* DigestInfo */
  var psLen = RSA_K - t.length - 3;
  var ps = '';
  for (var i = 0; i < psLen; i++) ps += '\xff';
  var em = '\x00\x01' + ps + '\x00' + t;
  var n = BigInt('0x' + MXBC_N_HEX), d = BigInt('0x' + MXBC_D_HEX);
  var sig = modPow(binToBigInt(em), d, n);
  return b64encode(bigIntToBin(sig, RSA_K)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ================= HTTP 封装 ================= */

function httpGet(opts) {
  return new Promise(function (resolve) {
    $httpClient.get(opts, function (err, resp, data) { resolve({ err: err, resp: resp, data: data }); });
  });
}

function httpPost(opts) {
  return new Promise(function (resolve) {
    $httpClient.post(opts, function (err, resp, data) { resolve({ err: err, resp: resp, data: data }); });
  });
}

function parseJson(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

function todayStr() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function firstDayStr() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-01';
}

function maskPhone(p) {
  p = String(p || '');
  return p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(7) : p;
}

/* ================= 品牌：蜜雪冰城 ================= */

var MXBC_APPID = 'd82be6bbc1da11eb9dd000163e122ecb';

function mxbcSignedUrl(path, token) {
  var t = String(Date.now());
  var sign = rsaSignSha256('appId=' + MXBC_APPID + '&t=' + t);
  return {
    url: 'https://mxsa.mxbc.net' + path + '?appId=' + MXBC_APPID + '&t=' + t + '&sign=' + sign,
    headers: {
      'Host': 'mxsa.mxbc.net',
      'app': 'mxbc',
      'appchannel': 'xiaomi',
      'User-Agent': UA_MINI,
      'Content-Type': 'application/json',
      'Accept': '*/*',
      'Referer': 'https://servicewechat.com/wx7696c66d2245d107/123/page-frame.html',
      'Accept-Encoding': 'gzip, deflate, br',
      'Access-Token': token
    }
  };
}

function doMixue(token, idx) {
  var lines = [];
  return httpGet(mxbcSignedUrl('/api/v1/customer/info', token)).then(function (r) {
    var body = parseJson(r.data);
    if (!body || body.code != 0) {
      lines.push('账号' + idx + '：Token 失效，需重新抓包（' + ((body && body.msg) || '无响应') + '）');
      return lines.join('\n');
    }
    var phone = maskPhone(body.data && body.data.mobilePhone);
    lines.push('账号' + idx + '（' + phone + '）：登录成功');
    return httpGet(mxbcSignedUrl('/api/v1/customer/signin', token)).then(function (r2) {
      var b2 = parseJson(r2.data);
      if (b2 && b2.code == 0) {
        lines.push('✅ 签到成功，雪王币+' + (b2.data && b2.data.ruleValuePoint) + '，已连签' + (b2.data && b2.data.ruleValueGrowth) + '天');
      } else if (b2 && b2.code == 5020) {
        lines.push('☑️ 今日已签到（' + (b2.msg || '') + '）');
      } else {
        lines.push('❌ 签到失败：' + ((b2 && (b2.msg || b2.code)) || '无响应'));
      }
      return httpGet(mxbcSignedUrl('/api/v1/customer/info', token)).then(function (r3) {
        var b3 = parseJson(r3.data);
        if (b3 && b3.code == 0) lines.push('当前雪王币：' + (b3.data && b3.data.customerPoint));
        return lines.join('\n');
      });
    });
  }).catch(function (e) {
    return '账号' + idx + '：请求异常 ' + e;
  });
}

/* ================= 品牌：奈雪的茶 ================= */

var NX_HMAC_KEY = 'sArMTldQ9tqU19XIRDMWz7BO5WaeBnrezA';
var NX_OPENID = 'QL6ZOftGzbziPlZwfiXM'; /* 原脚本固定值 */
var NX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF XWEB/6945';

function nxEnvelope(token, extraParams) {
  var nonce = String(Math.floor(100000 + Math.random() * 900000));
  var timestamp = String(Math.floor(Date.now() / 1000));
  var msg = 'nonce=' + nonce + '&openId=' + NX_OPENID + '&timestamp=' + timestamp;
  var signature = b64encode(hmacSha1(utf8bin(NX_HMAC_KEY), utf8bin(msg)));
  var params = { businessType: 1, brand: 26000252, tenantId: 1, channel: 2, stallType: null, storeId: null };
  for (var k in extraParams) params[k] = extraParams[k];
  return {
    url: '',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Referer': 'https://tm-web.pin-dao.cn/',
      'Origin': 'https://tm-web.pin-dao.cn',
      'Content-Type': 'application/json',
      'User-Agent': NX_UA
    },
    body: JSON.stringify({
      common: { platform: 'wxapp', version: '5.1.8', imei: '', osn: 'microsoft', sv: 'Windows 10 x64', lang: 'zh_CN', currency: 'CNY', timeZone: '', nonce: nonce, openId: NX_OPENID, timestamp: timestamp, signature: signature },
      params: params
    })
  };
}

function nxPost(token, path, extraParams) {
  var e = nxEnvelope(token, extraParams);
  e.url = 'https://tm-web.pin-dao.cn' + path;
  return httpPost(e);
}

function doNayuki(token, idx) {
  var lines = [];
  return nxPost(token, '/user/base-userinfo', {}).then(function (r) {
    var body = parseJson(r.data);
    if (!body || body.code != 0) {
      lines.push('账号' + idx + '：登录失效，需重新抓包（' + ((body && body.message) || '无响应') + '）');
      return lines.join('\n');
    }
    var phone = body.data && body.data.phone;
    lines.push('账号' + idx + '（' + maskPhone(phone) + '）：登录成功');
    return nxPost(token, '/user/sign/records', { signDate: firstDayStr(), startDate: todayStr() }).then(function (r2) {
      var b2 = parseJson(r2.data);
      if (!b2 || b2.code != 0) {
        lines.push('❌ 查询签到状态失败：' + ((b2 && b2.message) || '无响应'));
        return lines.join('\n');
      }
      var already = b2.data && b2.data.status;
      var count = b2.data && b2.data.signCount;
      if (already) {
        lines.push('☑️ 今日已签到，本月已签' + count + '天');
        return nxCoin(token).then(function (c) { lines.push(c); return lines.join('\n'); });
      }
      return nxPost(token, '/user/sign/save', { signDate: todayStr() }).then(function (r3) {
        var b3 = parseJson(r3.data);
        if (b3 && b3.code == 0 && b3.data && b3.data.flag) lines.push('✅ 签到成功，本月已签' + count + '天');
        else if (b3 && b3.code == 0) lines.push('☑️ 今日已签到');
        else lines.push('❌ 签到失败：' + ((b3 && b3.message) || '无响应'));
        return nxCoin(token).then(function (c) { lines.push(c); return lines.join('\n'); });
      });
    });
  }).catch(function (e) {
    return '账号' + idx + '：请求异常 ' + e;
  });
}

function nxCoin(token) {
  return nxPost(token, '/user/account/user-account', {}).then(function (r) {
    var body = parseJson(r.data);
    if (body && body.code == 0) return '当前奈雪币：' + (body.data && body.data.coin);
    return '';
  }).catch(function () { return ''; });
}

/* ================= 品牌：霸王茶姬（实验性） ================= */

var CHAGEE_APPID = 'wxafec6f8422cb357b';
var CHAGEE_ACTIVITY = '947079313798000641';
var CHAGEE_SELLER = '49006';   /* 原脚本固定值 */
var CHAGEE_STORE = 48910;      /* 原脚本固定值 */

function chageeHeaders(userToken) {
  return {
    'Content-Type': 'application/json',
    'scene': '1027',
    'Qm-From': 'wechat',
    'Qm-From-Type': 'catering',
    'store-id': String(CHAGEE_STORE),
    'Referer': 'https://servicewechat.com/' + CHAGEE_APPID + '/175/page-frame.html',
    'Qm-User-Token': userToken,
    'User-Agent': UA_MINI
  };
}

function qmaiOk(body) {
  return !!(body && (body.status === true || (body.data && body.data.status === true)));
}
function qmaiData(body) {
  if (!body) return null;
  if (body.data && typeof body.data === 'object' && 'status' in body.data && 'data' in body.data) return body.data.data;
  return body.data;
}
function qmaiMsg(body) {
  if (!body) return '无响应';
  return body.message || (body.data && body.data.message) || ('code=' + body.code);
}

function doChagee(userToken, idx) {
  var lines = [];
  var parts = String(userToken).split('#');
  var token = parts[0], userId = parts[1] || '';
  if (!token || !userId) {
    return Promise.resolve('账号' + idx + '：凭证格式错误，应为 token#userId');
  }
  var H = chageeHeaders(token + '#' + userId);
  return httpGet({ url: 'https://webapi2.qmai.cn/web/catering2-apiserver/crm/customer-center?appid=' + CHAGEE_APPID, headers: H }).then(function (r) {
    var body = parseJson(r.data);
    if (!qmaiOk(body)) {
      lines.push('账号' + idx + '：登录失效，需重新抓包（' + qmaiMsg(body) + '）');
      return lines.join('\n');
    }
    var d = qmaiData(body) || {};
    var integral = d.customerAssertInfo && d.customerAssertInfo.integral;
    lines.push('账号' + idx + '：登录成功' + (integral !== undefined ? '，积分 ' + integral : ''));
    var statBody = JSON.stringify({ activityId: CHAGEE_ACTIVITY, appid: CHAGEE_APPID });
    return httpPost({ url: 'https://webapi2.qmai.cn/web/cmk-center/sign/userSignStatistics', headers: H, body: statBody }).then(function (r2) {
      var b2 = parseJson(r2.data);
      if (!qmaiOk(b2)) {
        lines.push('❌ 查询签到状态失败：' + qmaiMsg(b2));
        return lines.join('\n');
      }
      var sd = qmaiData(b2) || {};
      if (sd.signStatus == 1) {
        lines.push('☑️ 今日已签到，已连签' + (sd.signDays || 0) + '天');
        return lines.join('\n');
      }
      var ts = String(Date.now());
      var str = 'activityId=' + CHAGEE_ACTIVITY + '&sellerId=' + CHAGEE_SELLER + '&timestamp=' + ts + '&userId=' + userId + '&key=' + CHAGEE_ACTIVITY.split('').reverse().join('');
      var signature = md5hex(str).toUpperCase();
      var signBody = JSON.stringify({ activityId: CHAGEE_ACTIVITY, appid: CHAGEE_APPID, storeId: CHAGEE_STORE, timestamp: Number(ts), signature: signature, store_id: CHAGEE_STORE });
      return httpPost({ url: 'https://webapi2.qmai.cn/web/cmk-center/sign/takePartInSign', headers: H, body: signBody }).then(function (r3) {
        var b3 = parseJson(r3.data);
        var m3 = qmaiMsg(b3);
        if (qmaiOk(b3)) lines.push('✅ 签到成功，已连签' + (sd.signDays || 0) + '天');
        else if (/已签到/.test(m3)) lines.push('☑️ 今日已签到');
        else lines.push('❌ 签到失败：' + m3);
        return lines.join('\n');
      });
    });
  }).catch(function (e) {
    return '账号' + idx + '：请求异常 ' + e;
  });
}

/* ================= 主流程 ================= */

var BRANDS = {
  mxbc: { name: '蜜雪冰城', tokenKey: 'milktea_mxbc', run: doMixue, needHint: '需在 BoxJs 填写 Access-Token（抓包 mxsa.mxbc.net 请求头）' },
  nx: { name: '奈雪的茶', tokenKey: 'milktea_nx', run: doNayuki, needHint: '需在 BoxJs 填写 Authorization（抓包奈雪点单小程序请求头，不要 Bearer 前缀）' },
  chagee: { name: '霸王茶姬', tokenKey: 'milktea_chagee', run: doChagee, needHint: '需在 BoxJs 填写 token#userId（抓包小程序登录接口返回）' }
};

function runBrand(key) {
  var b = BRANDS[key];
  var tokens = splitTokens(cfg(b.tokenKey));
  var out = ['—— ' + b.name + ' ——'];
  if (!tokens.length) {
    out.push('⚠️ 未配置凭证：' + b.needHint);
    return Promise.resolve(out.join('\n'));
  }
  var chain = Promise.resolve([]);
  tokens.forEach(function (tk, i) {
    chain = chain.then(function (arr) {
      return b.run(tk, i + 1).then(function (r) { arr.push(r); return arr; });
    });
  });
  return chain.then(function (arr) {
    out.push(arr.join('\n'));
    return out.join('\n');
  });
}

function main() {
  var brands = enabledBrands().filter(function (k) { return BRANDS[k]; });
  if (!brands.length) {
    $notification.post('奶茶签到', '未启用任何品牌', '在 BoxJs「奶茶签到」中启用品牌并填写凭证');
    $done();
    return;
  }
  var chain = Promise.resolve([]);
  brands.forEach(function (k) {
    chain = chain.then(function (arr) {
      return runBrand(k).then(function (r) { arr.push(r); return arr; });
    });
  });
  chain.then(function (arr) {
    var body = arr.join('\n');
    $notification.post('🧋 奶茶签到完成', brands.map(function (k) { return BRANDS[k].name; }).join('、'), body);
    $done();
  }).catch(function (e) {
    $notification.post('🧋 奶茶签到', '执行异常', String(e).slice(0, 200));
    $done();
  });
}

main();
