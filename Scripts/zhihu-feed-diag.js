// 知乎信息流诊断脚本（临时）：只记录条目结构，不改动任何数据。
// 配合 Loon 记录详情里的日志，确认当前信息流里广告的字段特征。
if (!$response.body) $done({});
var obj = null;
try {
  obj = JSON.parse($response.body);
} catch (e) {
  console.log("[ZHDIAG] parse-fail len=" + $response.body.length);
  $done({});
}
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
