/*
 * CtripCapture.js — Loon 辅助脚本：自动抓取携程 cticket
 *
 * 用户无需手动抓包：按下方的重写订阅链接加入 Loon 后，
 * 打开「携程旅行」微信小程序登录（或随便逛一下），cticket 会自动保存并弹通知确认。
 * 之后每天 9:00 的携程签到定时任务（CtripCheckin.js）会自动使用它。
 *
 * 抓取位置（三处，互相兜底）：
 *   1. 发往 m.ctrip.com 的请求头 Cookie 里的 cticket
 *   2. 小程序登录接口响应头 Set-Cookie 里的 cticket
 *   3. 登录接口响应体 JSON 里的 cticket 字段
 *
 * Loon 配置（配置 → 重写 → 右上角 → 引用，粘贴下面整行）：
 * https://raw.githubusercontent.com/LeBron93/lewis/main/Rules/Ctrip.rewrite.list
 *
 * 前提：Loon 的 MitM 已开启且证书已在 iPhone 上信任
 *      （Loon → 更多 → MitM → 开启；证书：配置 → MitM → 安装证书，按提示去系统设置信任）
 */

function getHeader(headers, name) {
  var lower = String(name).toLowerCase();
  for (var k in headers) {
    if (String(k).toLowerCase() === lower) return headers[k];
  }
  return '';
}

function saveToken(key, token) {
  token = String(token || '').trim();
  if (!token || token.length < 10) return false;
  var old = '';
  try { old = $persistentStore.read(key) || ''; } catch (e) {}
  var list = String(old).split(/[\n&]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (list.indexOf(token) !== -1) return 'exists';
  list.push(token);
  try { $persistentStore.write(list.join('&'), key); } catch (e2) { return false; }
  return 'saved';
}

function notifySaved(result) {
  if (result === 'saved') {
    $notification.post('✈️ 携程', 'cticket 已自动保存', '明早 9:00 起自动签到；换号可再登录一次，会自动追加');
  } else if (result === 'exists') {
    $notification.post('✈️ 携程', 'cticket 已是最新', '无需重复保存');
  }
}

function pickTicket(s) {
  var m = String(s || '').match(/(?:^|;\s*)cticket=([^;,\s]+)/);
  if (m && m[1]) return m[1];
  var j = String(s || '').match(/"cticket"\s*:\s*"([^"]+)"/);
  if (j && j[1]) return j[1];
  return '';
}

function main() {
  try {
    /* 注意：响应体重写时 $request 与 $response 同时存在，先判断 $response */
    if (typeof $response !== 'undefined' && $response) {
      /* 1. 响应头 Set-Cookie */
      var rh = $response.headers || {};
      var sc = getHeader(rh, 'Set-Cookie') || getHeader(rh, 'set-cookie');
      var t1 = pickTicket(sc);
      if (t1) { notifySaved(saveToken('ctrip_cticket', t1)); }
      else {
        /* 2. 响应体 JSON */
        var t2 = pickTicket($response.body || '');
        if (t2) notifySaved(saveToken('ctrip_cticket', t2));
      }
      $done({});
      return;
    }
    /* 3. 请求头 Cookie */
    if (typeof $request !== 'undefined' && $request) {
      var url = $request.url || '';
      if (url.indexOf('m.ctrip.com') !== -1) {
        var cookie = getHeader($request.headers || {}, 'Cookie');
        var t3 = pickTicket(cookie);
        if (t3) notifySaved(saveToken('ctrip_cticket', t3));
      }
      $done({});
      return;
    }
  } catch (e) {}
  try { $done({}); } catch (e2) {}
}

main();
