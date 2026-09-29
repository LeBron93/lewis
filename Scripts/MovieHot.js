/*
* MovieHot.js — Loon 定时任务：每日热映电影推送
*
* Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
* cron "0 45 8 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/MovieHot.js, tag=热映电影, timeout=60, enable=true
*
* 每天 8:45 推送一条横幅通知：
* 国内热映 Top 8（猫眼在映，片名 + 猫眼评分）
* 国内票房（Box Office Mojo 中国周末冠军 + 周末票房/美元）
* 北美票房 Top 5（豆瓣，片名 + 周票房/美元）
* 欧洲票房（Box Office Mojo 英/法/德/意/西周末冠军 + 周末票房/美元）
* 港台票房（Box Office Mojo 香港/台湾周末冠军 + 周末票房/美元）
* 长按可展开，点击通知跳转猫眼在映页。
*/

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

var CN_URL = 'https://m.maoyan.com/ajax/movieOnInfoList?token=';
var US_URL = 'https://movie.douban.com/chart';
var INTL_URL = 'https://www.boxofficemojo.com/intl/';
var OPEN_URL = 'https://m.maoyan.com/';

var CN_N = 8;
var US_N = 5;

// Box Office Mojo 地区名 → 中文
var AREAS = {
  'China': '国内',
  'United Kingdom': '英国',
  'France': '法国',
  'Germany': '德国',
  'Italy': '意大利',
  'Spain': '西班牙',
  'Hong Kong': '香港',
  'Taiwan': '台湾'
};
var EU_KEYS = ['United Kingdom', 'France', 'Germany', 'Italy', 'Spain'];

function parseCn(body) {
  try {
    var data = JSON.parse(body);
    return (data.movieList || [])
      .filter(function (m) { return m.showst === 3; })
      .slice(0, CN_N)
      .map(function (m) {
        var s = m.nm;
        if (m.sc > 0) s += ' ' + m.sc + '分';
        return s;
      });
  } catch (e) { return []; }
}

function parseUs(body) {
  try {
    var html = String(body);
    var sec = html.split('北美票房榜')[1] || '';
    sec = sec.split('</ul>')[0];
    var items = [];
    var re = /<div class="no">\d+<\/div>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<span class="box_chart_num[^"]*">([^<]+)<\/span>/g;
    var m;
    while ((m = re.exec(sec)) !== null && items.length < US_N) {
      items.push(m[1].trim() + ' ' + m[2].trim() + '美元');
    }
    var u = html.match(/北美票房榜[\s\S]{0,300}?(\d+月\d+日)\s*更新/);
    return { items: items, update: u ? u[1] : '' };
  } catch (e) { return { items: [], update: '' }; }
}

function stripTags(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 解析 Box Office Mojo /intl/ 各地区周末冠军表，取最新一周（首次出现为准）
function parseIntl(body) {
  try {
    var html = String(body);
    var out = {};
    var rows = html.split(/<tr[^>]*>/i);
    for (var i = 0; i < rows.length; i++) {
      var cells = [];
      var re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      var m;
      while ((m = re.exec(rows[i])) !== null) cells.push(stripTags(m[1]));
      // 表列：地区 | 周末 | 上映数 | 周末冠军 | 发行商 | 周末票房
      if (cells.length >= 6 && AREAS[cells[0]] && !out[cells[0]]) {
        out[cells[0]] = { weekend: cells[1], title: cells[3], gross: cells[5] };
      }
    }
    return out;
  } catch (e) { return {}; }
}

function fmtUSD(s) {
  var n = parseFloat(String(s).replace(/[$,]/g, ''));
  if (isNaN(n)) return String(s);
  if (n >= 1e8) return '$' + (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return '$' + (n / 1e4).toFixed(1) + '万';
  return '$' + Math.round(n);
}

function finish(cnBody, usBody, intlBody) {
  try {
    var cn = cnBody ? parseCn(cnBody) : [];
    var us = usBody ? parseUs(usBody) : { items: [], update: '' };
    var intl = intlBody ? parseIntl(intlBody) : {};

    var lines = [];
    if (cn.length) {
      lines.push('== 国内热映 ==');
      cn.forEach(function (t, i) { lines.push((i + 1) + '. ' + t); });
    }

    if (intl['China']) {
      if (lines.length) lines.push('');
      var c = intl['China'];
      lines.push('== 国内票房·周末冠军 (' + c.weekend + ') ==');
      lines.push('中国：' + c.title + ' ' + fmtUSD(c.gross));
    }

    if (us.items.length) {
      if (lines.length) lines.push('');
      lines.push('== 北美票房 ==' + (us.update ? us.update + '更新' : ''));
      us.items.forEach(function (t, i) { lines.push((i + 1) + '. ' + t); });
    }

    var eu = EU_KEYS.filter(function (k) { return intl[k]; });
    if (eu.length) {
      if (lines.length) lines.push('');
      lines.push('== 欧洲票房·周末冠军 ==');
      eu.forEach(function (k) {
        lines.push(AREAS[k] + '：' + intl[k].title + ' ' + fmtUSD(intl[k].gross));
      });
    }

    if (intl['Hong Kong'] || intl['Taiwan']) {
      if (lines.length) lines.push('');
      lines.push('== 港台票房·周末冠军 ==');
      if (intl['Hong Kong']) lines.push('香港：' + intl['Hong Kong'].title + ' ' + fmtUSD(intl['Hong Kong'].gross));
      if (intl['Taiwan']) lines.push('台湾：' + intl['Taiwan'].title + ' ' + fmtUSD(intl['Taiwan'].gross));
    }

    if (!lines.length) {
      $notification.post('🎬 热映电影', '获取失败', '电影数据拉取失败，请稍后重试');
      return $done();
    }
    $notification.post('🎬 热映电影', '今日在映 · 全球票房', lines.join('\n'), OPEN_URL);
  } catch (err) {
    $notification.post('🎬 热映电影', '获取失败', '数据解析失败，请稍后重试');
  }
  $done();
}

function main() {
  var bodies = { cn: null, us: null, intl: null };
  var pending = 3;
  function one(key, opts) {
    $httpClient.get(opts, function (err, resp, body) {
      bodies[key] = (!err && body) ? body : null;
      if (--pending === 0) finish(bodies.cn, bodies.us, bodies.intl);
    });
  }
  one('cn', { url: CN_URL, headers: { 'User-Agent': UA, 'Referer': 'https://m.maoyan.com/' } });
  one('us', { url: US_URL, headers: { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/' } });
  one('intl', { url: INTL_URL, headers: { 'User-Agent': UA, 'Referer': 'https://www.boxofficemojo.com/' } });
}

if (typeof $httpClient !== 'undefined') { main(); }

// ---- 本地测试用（Loon 里不会执行） ----
if (typeof $httpClient === 'undefined' && typeof module !== 'undefined') {
  module.exports = { parseCn: parseCn, parseUs: parseUs, parseIntl: parseIntl, fmtUSD: fmtUSD };
}
