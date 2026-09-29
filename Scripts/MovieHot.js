/*
* MovieHot.js — Loon 定时任务：每日热映电影推送
*
* Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
* cron "0 45 8 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/MovieHot.js, tag=热映电影, timeout=60, enable=true
*
* 每天 8:45 推送一条横幅通知：
* 猫眼在映 Top 8（片名 + 猫眼评分）
* 豆瓣北美票房榜 Top 5（片名 + 周票房/美元）
* 长按可展开，点击通知跳转猫眼在映页。
*/

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

var CN_URL = 'https://m.maoyan.com/ajax/movieOnInfoList?token=';
var US_URL = 'https://movie.douban.com/chart';
var OPEN_URL = 'https://m.maoyan.com/';

var CN_N = 8;
var US_N = 5;

function parseCn(body) {
var data = JSON.parse(body);
return (data.movieList || [])
.filter(function (m) { return m.showst === 3;})
.slice(0, CN_N)
.map(function (m) {
var s = m.nm;
if (m.sc > 0) s += ' ' + m.sc + '分';
return s;
});
}

function parseUs(body) {
var html = String(body);
var sec = html.split('北美票房榜')[1] || '';
sec = sec.split('</ul>')[0];
var items = [];
var re = /<div class="no">\d+<\/div>[\s\S]*?<a[^>]*>([^<]+)<\/a>[\s\S]*?<span class="box_chart_num[^"]*">([^<]+)<\/span>/g;
var m;
while ((m = re.exec(sec))!== null && items.length < US_N) {
items.push(m[1].trim() + ' ' + m[2].trim() + '美元');
}
var u = html.match(/北美票房榜[\s\S]{0,300}?(\d+月\d+日)\s*更新/);
return { items: items, update: u? u[1]: ''};
}

function main() {
$httpClient.get({ url: CN_URL, headers: { 'User-Agent': UA, 'Referer': 'https://m.maoyan.com/'}}, function (e1, r1, b1) {
$httpClient.get({ url: US_URL, headers: { 'User-Agent': UA, 'Referer': 'https://movie.douban.com/'}}, function (e2, r2, b2) {
try {
var cn = (!e1 && b1)? parseCn(b1): [];
var us = (!e2 && b2)? parseUs(b2): { items: [], update: ''};
if (!cn.length &&!us.items.length) {
$notification.post('🎬 热映电影', '获取失败', '电影数据拉取失败，请稍后重试');
return $done();
}
var lines = [];
if (cn.length) {
lines.push('== 国内热映 ==');
cn.forEach(function (t, i) { lines.push((i + 1) + '. ' + t);});
}
if (us.items.length) {
if (lines.length) lines.push('');
lines.push('== 北美票房 ==' + (us.update? us.update + '更新': ''));
us.items.forEach(function (t, i) { lines.push((i + 1) + '. ' + t);});
}
$notification.post('🎬 热映电影', '今日在映 · 国内外', lines.join('\n'), OPEN_URL);
} catch (err) {
$notification.post('🎬 热映电影', '获取失败', '数据解析失败，请稍后重试');
}
$done();
});
});
}

main();
