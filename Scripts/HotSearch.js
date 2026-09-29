/*
 * HotSearch.js — Loon 定时任务：每日热搜推送
 *
 * Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
 * cron "0 45 9 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/HotSearch.js, tag=每日热搜, timeout=60, argument="weibo,baidu,douyin", enable=true
 *
 * argument 选择热搜来源（逗号分隔，可多选）：
 *   weibo  = 微博热搜
 *   baidu  = 百度热搜
 *   douyin = 抖音热搜
 *   all    = 全部（默认）
 *
 * 每个来源单独发一条横幅通知：标题党条目可长按展开查看，点击通知跳转对应热搜页。
 */

var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

var SOURCES = {
  weibo: {
    name: '微博热搜',
    req: { url: 'https://raw.githubusercontent.com/v5tech/weibo-trending-hot-search/HEAD/README.md' },
    openUrl: 'https://s.weibo.com/top/summary?cate=realtimehot',
    parse: parseWeibo
  },
  baidu: {
    name: '百度热搜',
    req: { url: 'https://top.baidu.com/api/board?tab=realtime', headers: { 'User-Agent': UA } },
    openUrl: 'https://top.baidu.com/board?tab=realtime',
    parse: parseBaidu
  },
  douyin: {
    name: '抖音热搜',
    req: { url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', headers: { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/' } },
    openUrl: 'https://www.douyin.com/',
    parse: parseDouyin
  }
};

var TOP_N = 10;

function parseWeibo(body) {
  var sec = String(body).split('## 今日热门搜索')[1] || '';
  sec = sec.split('\n## ')[0];
  var titles = [];
  var re = /^1\.\s*\[([^\]]+)\]/gm;
  var m;
  while ((m = re.exec(sec)) !== null && titles.length < TOP_N) {
    titles.push(m[1]);
  }
  var t = String(body).match(/最后更新时间\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2})/);
  return { items: titles, update: t ? t[1] : '' };
}

function parseBaidu(body) {
  var data = JSON.parse(body);
  var list = (((data || {}).data || {}).cards || [])[0] || {};
  var items = (list.content || []).slice(0, TOP_N).map(function (x) { return x.word; }).filter(Boolean);
  return { items: items, update: '' };
}

function parseDouyin(body) {
  var data = JSON.parse(body);
  var items = (data.word_list || []).slice(0, TOP_N).map(function (x) { return x.word; }).filter(Boolean);
  return { items: items, update: '' };
}

function notify(source, result) {
  var body = result.items.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n');
  var subtitle = result.update ? ('更新于 ' + result.update) : '今日热搜 Top' + result.items.length;
  $notification.post('🔥 ' + source.name, subtitle, body, source.openUrl);
}

function notifyFail(source, err) {
  $notification.post('🔥 ' + source.name, '获取失败', '热搜数据拉取失败，请稍后重试（' + String(err || '网络错误').slice(0, 40) + '）');
}

function main() {
  var raw = (typeof $argument !== 'undefined' && $argument) ? String($argument).trim().toLowerCase() : 'all';
  var keys = raw === 'all'
    ? Object.keys(SOURCES)
    : raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return SOURCES[s]; });

  if (!keys.length) {
    $notification.post('每日热搜', '参数错误', 'argument 可选：weibo, baidu, douyin（逗号分隔），或 all');
    return $done();
  }

  var i = 0;
  (function next() {
    if (i >= keys.length) return $done();
    var key = keys[i++];
    var source = SOURCES[key];
    $httpClient.get(source.req, function (error, response, body) {
      if (error || !body) {
        notifyFail(source, error);
        return next();
      }
      try {
        var result = source.parse(body);
        if (result.items.length) notify(source, result);
        else notifyFail(source, '数据为空');
      } catch (e) {
        notifyFail(source, e && e.message);
      }
      next();
    });
  })();
}

main();
