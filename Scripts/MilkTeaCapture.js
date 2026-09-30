/*
 * MilkTeaCapture.js — Loon 辅助脚本：自动抓取奶茶品牌 token
 *
 * 用户无需手动抓包：按下方的重写订阅链接加入 Loon 后，
 * 打开对应小程序点一次"签到"，token 会自动保存并弹通知确认。
 * 之后每天 8:30 的奶茶签到定时任务（MilkTea.js）会自动使用这些 token。
 *
 * Loon 配置（配置 → 重写 → 右上角 → 引用，粘贴下面整行）：
 * https://raw.githubusercontent.com/LeBron93/lewis/main/Rules/MilkTea.rewrite.list
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

function saveToken(key, brand, token) {
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

function notifySaved(brand, result) {
  if (result === 'saved') {
    $notification.post('🧋 ' + brand, 'token 已自动保存', '明早 8:30 起自动签到；换号可再抓一次，会自动追加');
  } else if (result === 'exists') {
    $notification.post('🧋 ' + brand, 'token 已是最新', '无需重复保存');
  }
}

/* 从 JSON 里按多条路径取值 */
function dig(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    var cur = obj, ok = true;
    for (var j = 0; j < paths[i].length; j++) {
      if (cur && typeof cur === 'object' && paths[i][j] in cur) cur = cur[paths[i][j]];
      else { ok = false; break; }
    }
    if (ok && cur) return cur;
  }
  return '';
}

function main() {
  var url = '';
  try {
    /* 注意：响应体重写时 $request 与 $response 同时存在，先判断 $response */
    if (typeof $response !== 'undefined' && $response && $response.body) {
      url = (typeof $request !== 'undefined' && $request && $request.url) || '';
      var body = $response.body || '';
      if (url.indexOf('flash-sale-login') !== -1 && body) {
        var json = null;
        try { json = JSON.parse(body); } catch (e) {}
        if (json) {
          var token = dig(json, [['data', 'token'], ['token'], ['data', 'accessToken'], ['data', 'access_token']]);
          var userId = dig(json, [['data', 'user', 'id'], ['data', 'userId'], ['data', 'user_id'], ['user', 'id']]);
          if (token && userId) notifySaved('霸王茶姬', saveToken('milktea_chagee', '霸王茶姬', token + '#' + userId));
          else if (token) $notification.post('🧋 霸王茶姬', '只抓到 token，没抓到 userId', '登录返回里没找到用户 id，可进 BoxJs 手动补成 token#userId');
        }
      }
      $done({ body: body });
      return;
    }
    if (typeof $request !== 'undefined' && $request) {
      url = $request.url || '';
      var headers = $request.headers || {};
      if (url.indexOf('mxsa.mxbc.net') !== -1) {
        var t1 = getHeader(headers, 'Access-Token');
        if (t1) notifySaved('蜜雪冰城', saveToken('milktea_mxbc', '蜜雪冰城', t1));
      } else if (url.indexOf('tm-web.pin-dao.cn') !== -1) {
        var t2 = String(getHeader(headers, 'Authorization') || '').replace(/^Bearer\s+/i, '');
        if (t2) notifySaved('奈雪的茶', saveToken('milktea_nx', '奈雪的茶', t2));
      }
      $done({});
      return;
    }
  } catch (e) {}
  try { $done({}); } catch (e2) {}
}

main();
