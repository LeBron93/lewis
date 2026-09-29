/*
 * HotSearch.js — Loon 定时任务：每日热搜推送
 *
 * Loon 配置（配置 → 定时任务 → 右上角 +，粘贴下面整行）：
 * cron "0 45 9 * * *" script-path=https://raw.githubusercontent.com/LeBron93/lewis/main/Scripts/HotSearch.js, tag=每日热搜, timeout=60, argument="weibo", enable=true
 *
 * 来源选择（只选一个，优先级从高到低）：
 *   1. BoxJs 可视化选择（订阅 HotSearch.boxjs.json 后，在 BoxJs 面板里点选）
 *   2. cron 的 argument 参数
 *   3. 默认 weibo
 * 可选值：
 *   weibo    = 微博热搜（默认）
 *   36kr     = 36氪快讯
 *   douyin   = 抖音热搜
 *   thepaper = 澎湃新闻热榜
 *   zhihu    = 知乎热榜
 *   sspai    = 少数派热门
 *   caixin   = 财新要闻
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
  '36kr': {
    name: '36氪快讯',
    method: 'post',
    req: function () {
      return {
        url: 'https://gateway.36kr.com/api/mis/nav/newsflash/flow',
        headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ partner_id: 'wap', param: { siteId: 1, platformId: 2, pageSize: 20, pageEvent: 0 }, timestamp: Date.now() })
      };
    },
    openUrl: 'https://www.36kr.com/newsflashes',
    parse: parseKr36
  },
  douyin: {
    name: '抖音热搜',
    req: { url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', headers: { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/' } },
    openUrl: 'https://www.douyin.com/',
    parse: parseDouyin
  },
  thepaper: {
    name: '澎湃新闻',
    req: { url: 'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar', headers: { 'User-Agent': UA } },
    openUrl: 'https://www.thepaper.cn/',
    parse: parseThepaper
  },
  zhihu: {
    name: '知乎热榜',
    req: { url: 'https://api.zhihu.com/topstory/hot-lists/total?limit=50', headers: { 'User-Agent': UA } },
    openUrl: 'https://www.zhihu.com/hot',
    parse: parseZhihu
  },
  sspai: {
    name: '少数派热门',
    req: { url: 'https://sspai.com/api/v1/article/tag/page/get?limit=10&offset=0&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0', headers: { 'User-Agent': UA, 'Referer': 'https://sspai.com/' } },
    openUrl: 'https://sspai.com/',
    parse: parseSspai
  },
  caixin: {
    name: '财新要闻',
    req: { url: 'https://gateway.caixin.com/api/extapi/homeInterface.jsp?subject=100589266&start=1&count=10&picdim=_266_177&type=2&callback=cb', headers: { 'User-Agent': UA, 'Referer': 'https://www.caixin.com/' } },
    openUrl: 'https://www.caixin.com/',
    parse: parseCaixin
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

function parseKr36(body) {
  var data = JSON.parse(body);
  if (data.code !== 0) return { items: [], update: '' };
  var items = (((data || {}).data || {}).itemList || [])
    .slice(0, TOP_N)
    .map(function (x) { return ((x || {}).templateMaterial || {}).widgetTitle; })
    .filter(Boolean);
  return { items: items, update: '' };
}

function parseThepaper(body) {
  var data = JSON.parse(body);
  var items = ((((data || {}).data || {}).hotNews) || [])
    .slice(0, TOP_N)
    .map(function (x) { return x.name; })
    .filter(Boolean);
  return { items: items, update: '' };
}

function parseZhihu(body) {
  var data = JSON.parse(body);
  var items = ((data || {}).data || [])
    .slice(0, TOP_N)
    .map(function (x) { return ((x || {}).target || {}).title; })
    .filter(Boolean);
  return { items: items, update: '' };
}
function parseDouyin(body) {
  var data = JSON.parse(body);
  var items = (data.word_list || []).slice(0, TOP_N).map(function (x) { return x.word; }).filter(Boolean);
  return { items: items, update: '' };
}

function parseSspai(body) {
  var data = JSON.parse(body);
  var items = ((data || {}).data || [])
    .slice(0, TOP_N)
    .map(function (x) { return x.title; })
    .filter(Boolean);
  return { items: items, update: '' };
}

function parseCaixin(body) {
  var m = String(body).match(/\(\s*(\{[\s\S]*\})\s*\)/);
  if (!m) return { items: [], update: '' };
  var data = JSON.parse(m[1]);
  var items = ((data || {}).datas || [])
    .slice(0, TOP_N)
    .map(function (x) { return x.desc; })
    .filter(Boolean);
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

function getSourceKey() {
  var raw = '';
  try {
    if (typeof $persistentStore !== 'undefined') raw = $persistentStore.read('hotsearch_source') || '';
  } catch (e) {}
  if (!raw && typeof $argument !== 'undefined' && $argument) {
    raw = String($argument).split(',')[0].trim().toLowerCase();
  }
  raw = String(raw || '').trim().toLowerCase();
  return SOURCES[raw] ? raw : 'weibo';
}

function main() {
  var source = SOURCES[getSourceKey()];
  var reqOpt = (typeof source.req === 'function') ? source.req() : source.req;
  var doRequest = (source.method === 'post') ? $httpClient.post : $httpClient.get;
  doRequest(reqOpt, function (error, response, body) {
    if (error || !body) {
      notifyFail(source, error);
      return $done();
    }
    try {
      var result = source.parse(body);
      if (result.items.length) notify(source, result);
      else notifyFail(source, '数据为空');
    } catch (e) {
      notifyFail(source, e && e.message);
    }
    $done();
  });
}

main();
