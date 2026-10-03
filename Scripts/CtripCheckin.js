/*
 * CtripCheckin.js — Loon 定时任务：携程旅行自动签到
 *
 * Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
 * cron "0 0 9 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/CtripCheckin.js, tag=携程签到, timeout=60, enable=true
 *
 * 每天 9:00 对已配置凭证的账号执行一次签到，完成后发一条横幅通知汇总结果。
 *
 * 凭证配置（两种方式，优先级从高到低）：
 *   1. BoxJs 可视化配置：订阅 Scripts/CtripCheckin.boxjs.json，在 BoxJs 面板里粘贴 cticket
 *   2. cron 的 argument 参数：JSON 字符串，如 {"ctrip_cticket":"cticket值1&cticket值2"}
 *
 * cticket 抓取（两种方式）：
 *   A. 免抓包自动获取（推荐）：在 Loon「配置 → 重写」引用订阅
 *      https://raw.githubusercontent.com/LeBron93/lewis/main/Rules/Ctrip.rewrite.list
 *      确认 MitM 已开启且证书已信任，然后打开「携程旅行」微信小程序登录一次
 *      （或随便逛一下），收到「cticket 已自动保存」通知即成功。
 *   B. 手动：Loon 开 MITM 后打开携程微信小程序，在「请求记录」里找 Host 为 m.ctrip.com 的请求，
 *      复制请求头 Cookie 里的 cticket= 后面的值（不要 cticket= 本身）。
 *
 * 注意：cticket 会过期（一般几周），失效后脚本会提示，重新抓一次即可。
 *
 * 接口来源（公开开源脚本，已实测接口存活 2026-10）：
 *   https://github.com/Litre-WU/Sign
 *   POST https://m.ctrip.com/restapi/soa2/22769/signToday，Cookie: cticket=xxx
 */

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50 NetType/WIFI';

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

/* ================= HTTP 封装 ================= */

function httpPost(opts) {
  return new Promise(function (resolve) {
    $httpClient.post(opts, function (err, resp, data) { resolve({ err: err, resp: resp, data: data }); });
  });
}

function parseJson(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

function maskTicket(t) {
  t = String(t || '');
  return t.length > 12 ? t.slice(0, 6) + '...' + t.slice(-4) : '****';
}

/* ================= 携程签到 ================= */

function doCtripSignIn(cticket, idx) {
  var body = JSON.stringify({ openId: '' });
  var opts = {
    url: 'https://m.ctrip.com/restapi/soa2/22769/signToday',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Referer': 'https://m.ctrip.com/',
      'Cookie': 'cticket=' + cticket
    },
    body: body
  };
  return httpPost(opts).then(function (r) {
    var j = parseJson(r.data);
    if (!j) return '账号' + idx + '（' + maskTicket(cticket) + '）：请求无响应';
    if (j.code === 404001 || /未登录/.test(j.message || '')) {
      return '账号' + idx + '：cticket 已失效，需重新抓取（' + (j.message || '') + '）';
    }
    var msg = j.message || '';
    var extra = [];
    if (j.continueDay) extra.push('已连签' + j.continueDay + '天');
    var pts = (j.baseIntegratedPoint || 0) + (j.extraIntegratedPoint || 0) + (j.extraCtripPoint || 0);
    if (pts) extra.push('积分+' + pts);
    if (/已签|成功/.test(msg)) {
      return '账号' + idx + '：✅ ' + msg + (extra.length ? '，' + extra.join('，') : '');
    }
    return '账号' + idx + '：' + msg + (extra.length ? '，' + extra.join('，') : '');
  }).catch(function (e) {
    return '账号' + idx + '：请求异常 ' + e;
  });
}

/* ================= 主流程 ================= */

function main() {
  var tickets = splitTokens(cfg('ctrip_cticket'));
  if (!tickets.length) {
    $notification.post('✈️ 携程签到', '未配置 cticket', '打开携程 App 逛一下自动抓取，或进 BoxJs「携程签到」手动粘贴');
    $done();
    return;
  }
  var chain = Promise.resolve([]);
  tickets.forEach(function (tk, i) {
    chain = chain.then(function (arr) {
      return doCtripSignIn(tk, i + 1).then(function (r) { arr.push(r); return arr; });
    });
  });
  chain.then(function (arr) {
    var body = arr.join('\n');
    $notification.post('✈️ 携程签到完成', tickets.length + ' 个账号', body);
    $done();
  }).catch(function (e) {
    $notification.post('✈️ 携程签到', '执行异常', String(e).slice(0, 200));
    $done();
  });
}

main();
