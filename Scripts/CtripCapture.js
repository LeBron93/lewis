/*
 * CtripCapture.js — Loon 辅助脚本：自动抓取携程 cticket
 *
 * 用户无需手动抓包：按下方的重写订阅链接加入 Loon 后，
 * 打开携程 App 随便逛一下，cticket 会自动保存并弹通知确认。
 * 之后每天 9:00 的携程签到定时任务（CtripCheckin.js）会自动使用它。
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
  if (!token) return false;
  var old = '';
  try { old = $persistentStore.read(key) || ''; } catch (e) {}
  var list = String(old).split(/[\n&]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (list.indexOf(token) !== -1) return 'exists';
  list.push(token);
  try { $persistentStore.write(list.join('&'), key); } catch (e2) { return false; }
  return 'saved';
}

function main() {
  try {
    if (typeof $request !== 'undefined' && $request) {
      var url = $request.url || '';
      if (url.indexOf('m.ctrip.com') !== -1) {
        var cookie = getHeader($request.headers || {}, 'Cookie');
        var m = String(cookie).match(/(?:^|;\s*)cticket=([^;]+)/);
        if (m && m[1]) {
          var r = saveToken('ctrip_cticket', m[1]);
          if (r === 'saved') $notification.post('✈️ 携程', 'cticket 已自动保存', '明早 9:00 起自动签到；换号可再抓一次，会自动追加');
          else if (r === 'exists') $notification.post('✈️ 携程', 'cticket 已是最新', '无需重复保存');
        }
      }
      $done({});
      return;
    }
  } catch (e) {}
  try { $done({}); } catch (e2) {}
}

main();
