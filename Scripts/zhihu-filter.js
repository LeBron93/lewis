// 知乎过滤脚本：m-cloud 全局配置 + topstory 推荐信息流。
// 逻辑与可莉原版 jq 规则一一对应；另带临时诊断日志 [ZHDIAG]，确认字段特征与配置开关后删除日志行。
// 注意：同一 URL 上 Response Body Rewrite 会禁用 Response Script（Loon 文档），所以这两个接口的过滤只能放在脚本里，不能再配重写规则。
if (!$response.body) $done({});
var url = $request.url;
var obj = null;
try {
  obj = JSON.parse($response.body);
} catch (e) {
  $done({});
}

if (url.indexOf("/api/cloud/zhihu/config/all") !== -1) {
  // ---- 全局配置：去掉 HTTPDNS / QUIC 相关配置（对应原版 drop_keys jq）----
  var cfgs = (obj && obj.data && obj.data.configs) || [];
  console.log("[ZHDIAG] config keys=" + cfgs.length);
  var interesting = cfgs.map(function (c) { return c && c.configKey; }).filter(function (k) {
    return k && /search|hot|recommend|guess|tab|feed|discover/i.test(k);
  });
  console.log("[ZHDIAG] config interesting=[" + interesting.join(",") + "]");
  console.log("[ZHDIAG] config first30=[" + cfgs.slice(0, 30).map(function (c) { return c && c.configKey; }).join(",") + "]");
  var DROP_KEYS = {
    "km_httpdns_new_config_tars": true, "preFetchHttpDns": true,
    "httpdns_detector_use_concurrent": true, "httpdns_use_memory_cache": true,
    "httpdns_new_config_tars": true, "coreNetworkConf_useTars": true,
    "km_coreNetworkConf_useTars": true, "sugarQuicConfig": true,
    "quic_dns_detect_enable": true, "quicMixAB": true,
    "quic_downgrade_enable": true, "quic_priority_strategy": true,
    "quic_check_health_enable": true, "tquic_configuration": true,
    "networkExprimentList": true, "tars_ab_list": true, "zaSetExtraRequestHeader": true
  };
  if (obj && obj.data && Array.isArray(obj.data.configs)) {
    obj.data.configs = obj.data.configs.filter(function (c) { return !DROP_KEYS[c && c.configKey]; });
    obj.data.configs.forEach(function (c) {
      var v = c && c.configValue;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        delete v.delayHttpdns;
        delete v.dnsParser;
        delete v.HTTPDNS;
      }
    });
  }
  $done({ body: JSON.stringify(obj) });
} else {
  // ---- 推荐信息流：只留 ComponentCard，并去掉 children 里的 ring（对应原版两条 jq）----
  // 注意：本次请求体除 data 外还有 dataV1 字段，先记录两个字段的形态再决定过滤目标
  var dataV1 = obj && obj.dataV1;
  var dataField = obj && obj.data;
  var list = Array.isArray(dataV1) ? dataV1 : (Array.isArray(dataField) ? dataField : []);
  var listName = Array.isArray(dataV1) ? "dataV1" : "data";
  console.log("[ZHDIAG] items=" + list.length + " from=" + listName + " keys=" + (obj && typeof obj === "object" ? Object.keys(obj).join(",") : "?") + " dataV1=" + (Array.isArray(dataV1) ? "array" + dataV1.length : typeof dataV1) + " data=" + (Array.isArray(dataField) ? "array" + dataField.length : typeof dataField));
  var items = list;
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
  if (obj && Array.isArray(obj.dataV1)) { obj.dataV1 = zhihuFilterList(obj.dataV1, "dataV1"); }
  if (obj && Array.isArray(obj.data)) { obj.data = zhihuFilterList(obj.data, "data"); }
  $done({ body: JSON.stringify(obj) });
}

// 显式广告标记才判定为广告（宁可漏杀、不错杀）：id=ad、type=613、强插原因、
// 强制插入、内部横幅、is_ad、ad_type、promotion_extra、上报字段含 gdt/advert。
function zhihuIsAd(it) {
  if (!it || typeof it !== "object") return false;
  if (it.id === "ad") return true;
  if (it.type === 613 || it.type === "613") return true;
  var reason = it.reason || it.ad_reason || it.adReason || "";
  if (typeof reason === "string" && reason.indexOf("强插") !== -1) return true;
  if (it.is_force_insert === true || it.force_insert === true) return true;
  if (it.internalbanner === true) return true;
  if (it.is_ad === true) return true;
  if (it.ad_type || it.adType) return true;
  if (it.promotion_extra && typeof it.promotion_extra === "object" && Object.keys(it.promotion_extra).length) return true;
  var rep = it.report || it.report_info || it.ad_report || it.adReport || "";
  var repStr = typeof rep === "string" ? rep : "";
  try { if (typeof rep !== "string") repStr = JSON.stringify(rep); } catch (e) { repStr = ""; }
  if (/gdt|advert/i.test(repStr)) return true;
  return false;
}

function zhihuFilterList(arr, name) {
  var dropped = 0;
  var kept = arr.filter(function (i) {
    if (!i || typeof i !== "object") { dropped++; return false; }
    if (i.type !== "ComponentCard") { dropped++; return false; }
    if (zhihuIsAd(i)) { dropped++; return false; }
    return true;
  });
  kept.forEach(function (i) {
    // 与 jq 的 |= 语义一致：children 缺失时补 null，数组时去掉 id=ring 与广告子项
    if (!("children" in i)) {
      i.children = null;
    } else if (Array.isArray(i.children)) {
      i.children = i.children.filter(function (c) { return (!c || typeof c !== "object") ? true : (c.id !== "ring" && !zhihuIsAd(c)); });
    }
  });
  console.log("[ZHDIAG] " + name + " kept=" + kept.length + " dropped=" + dropped);
  return kept;
}
