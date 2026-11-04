// 知乎诊断脚本（临时）：只记录，不改动任何数据。
// 1) topstory/recommend：记录每条的 type/字段/广告特征词，确认信息流广告的字段特征。
// 2) m-cloud config/all：记录全部 configKey，找控制搜索页模块的开关（标题和占位条不受数据接口控制时，开关可能在这里）。
if (!$response.body) $done({});
var obj = null;
try {
  obj = JSON.parse($response.body);
} catch (e) {
  console.log("[ZHDIAG] parse-fail len=" + $response.body.length);
  $done({});
}
if ($request.url.indexOf("config/all") !== -1) {
  var cfgs = (obj && obj.data && obj.data.configs) || [];
  console.log("[ZHDIAG] config keys=" + cfgs.length);
  var interesting = cfgs.map(function (c) { return c && c.configKey; }).filter(function (k) {
    return k && /search|hot|recommend|guess|tab|feed|discover/i.test(k);
  });
  console.log("[ZHDIAG] config interesting=[" + interesting.join(",") + "]");
  console.log("[ZHDIAG] config first30=[" + cfgs.slice(0, 30).map(function (c) { return c && c.configKey; }).join(",") + "]");
  $done({});
} else {
var items = obj && Array.isArray(obj.data) ? obj.data : [];
console.log("[ZHDIAG] items=" + items.length + " keys=" + (obj && typeof obj === "object" ? Object.keys(obj).join(",") : "?"));
var MARKERS = ["广告", "推广", "promotion", "ad_info", "盐选", "feed_advert", "aggregation", "market_card", "business_type", "paid", "sponsored", "commercial"];
items.slice(0, 20).forEach(function (it, idx) {
  var s = "";
  try { s = JSON.stringify(it); } catch (e) { s = ""; }
  var hits = MARKERS.filter(function (m) { return s.indexOf(m) !== -1; });
  var keys = it && typeof it === "object" ? Object.keys(it).join(",") : typeof it;
  var extra = "";
  var ch = it && (it.children || it.components || (it.data && it.data.children) || (it.card && it.card.children));
  if (Array.isArray(ch)) {
    extra = " children=[" + ch.map(function (c) { return (c && (c.type || c.component_type || c.name || c.card_type)) || "?"; }).join("|") + "]";
  }
  var cardType = it && (it.card_type || it.cardType || (it.extra && it.extra.type) || "");
  console.log("[ZHDIAG] #" + idx + " type=" + (it && it.type) + " card_type=" + cardType + " keys=[" + keys + "] markers=[" + hits.join(",") + "]" + extra);
});
$done({});
}
