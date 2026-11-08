// MT.js：原样取自 ZenmoFeiShi/Qx（MT.snippet 的配套脚本），仅用 $request/$response/$done，Loon 无需改写。
// Source: https://raw.githubusercontent.com/ZenmoFeiShi/Qx/refs/heads/main/MT.js
// 2026-11-07 与上游的唯一差别：mtqxSearchHide 增加 CaixiQueryCardV2（美团 12.68.402 外卖搜索页"猜你想搜"，诊断日志确认响应里仅此一段；上游无此规则）。
// 2026-11-08 诊断版：mtqxDiagHome 记录所有 lycoris 场景名与数据结构（首页信息流定位用），过滤逻辑不变；定位到首页场景后回滚诊断代码。
const mtqxUrl = (typeof $request !== "undefined" && $request && $request.url) || "";
const mtqxHideTabs = ["video", "xiaotuan"];
const mtqxKeepTabs = ["homepage", "mine"];
const mtqxFeedScenes = ["gwc_feed1_2265", "personalcenter_2154"];
const mtqxMineHide = ["mine_cross_recommend"];
const mtqxSearchHide = ["EntranceHotwordsV2Hotwords", "EntranceHotwordsV2ContentCard", "CaixiQueryCardV2"];

function mtqxIsObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mtqxTab(obj) {
  const res = obj && obj.data && obj.data.resource;
  if (!mtqxIsObj(res) || !Array.isArray(res.tabArea)) return false;
  const names = res.tabArea.map(t => (mtqxIsObj(t) ? t.tabName : ""));
  if (!mtqxKeepTabs.every(n => names.indexOf(n) >= 0)) return false;
  const kept = res.tabArea.filter(t => !(mtqxIsObj(t) && mtqxHideTabs.indexOf(t.tabName) >= 0));
  if (kept.length === res.tabArea.length) return false;
  res.tabArea = kept;
  return true;
}

function mtqxDiagHome(obj) {
  const m = mtqxUrl.match(/\/lycoris\/scene\/([A-Za-z0-9_]+)/);
  if (!m) return;
  const d = obj && obj.data;
  const keys = obj ? Object.keys(obj) : [];
  const n = Array.isArray(d) ? d.length : -1;
  const sample = [];
  if (Array.isArray(d)) {
    d.slice(0, 3).forEach(it => {
      if (mtqxIsObj(it)) sample.push(Object.keys(it).slice(0, 8).join(","));
    });
  }
  console.log("[mtqxDiagHome] scene=" + m[1] + " keys=" + keys.join(",") + " dataLen=" + n + " items=[" + sample.join(" | ") + "]");
}

function mtqxFeed(obj) {
  const m = mtqxUrl.match(/\/lycoris\/scene\/([A-Za-z0-9_]+)/);
  if (!m || mtqxFeedScenes.indexOf(m[1]) < 0) return false;
  if (!mtqxIsObj(obj) || !Array.isArray(obj.data)) return false;
  obj.data = [];
  obj.bottom = true;
  if (!mtqxIsObj(obj.ext)) obj.ext = {};
  obj.ext.forbidByExp = true;
  return true;
}

function mtqxMine(obj) {
  if (!mtqxIsObj(obj) || !Array.isArray(obj.children)) return false;
  const kept = obj.children.filter(c => !(mtqxIsObj(c) && mtqxMineHide.indexOf(c.name) >= 0));
  if (kept.length === obj.children.length) return false;
  obj.children = kept;
  return true;
}

function mtqxDefaultWord(obj) {
  const res = obj && obj.searchIntroduceResponse;
  if (!mtqxIsObj(res)) return false;
  let changed = false;
  const dw = res.defaultWordRes;
  if (mtqxIsObj(dw) && Array.isArray(dw.defaultWordItems) && dw.defaultWordItems.length) {
    dw.defaultWordItems = [];
    changed = true;
  }
  if (Array.isArray(res.HotWordInfos) && res.HotWordInfos.length) {
    res.HotWordInfos = [];
    changed = true;
  }
  return changed;
}

function mtqxHotRecommend(obj) {
  const d = obj && obj.data;
  if (!mtqxIsObj(d) || !Array.isArray(d.segmentsV2)) return false;
  let changed = false;
  const kept = [];
  d.segmentsV2.forEach(s => {
    if (!mtqxIsObj(s) || !Array.isArray(s.hotwordSegments)) {
      kept.push(s);
      return;
    }
    const hs = s.hotwordSegments.filter(h => !(mtqxIsObj(h) && mtqxSearchHide.indexOf(h.pageName) >= 0));
    if (hs.length === s.hotwordSegments.length) {
      kept.push(s);
      return;
    }
    changed = true;
    if (hs.length) {
      s.hotwordSegments = hs;
      kept.push(s);
    }
  });
  if (changed) d.segmentsV2 = kept;
  const b = d.aiSearchBubble;
  if (mtqxIsObj(b) && Array.isArray(b.bubbleTexts) && b.bubbleTexts.length) {
    b.bubbleTexts = [];
    changed = true;
  }
  return changed;
}

function mtqxAiSkill(obj) {
  if (!mtqxIsObj(obj) || typeof obj.data !== "string") return false;
  const d = JSON.parse(obj.data);
  if (!mtqxIsObj(d) || !mtqxIsObj(d.skills) || !Object.keys(d.skills).length) return false;
  d.skills = {};
  obj.data = JSON.stringify(d);
  return true;
}

function mtqxClearArea(root, key) {
  const holders = [root, root && root.data];
  let changed = false;
  holders.forEach(h => {
    if (!mtqxIsObj(h)) return;
    [h.resourcesMap, h.resource].forEach(r => {
      if (mtqxIsObj(r) && Array.isArray(r[key]) && r[key].length) {
        r[key] = [];
        changed = true;
      }
    });
  });
  return changed;
}

(function () {
  const body = typeof $response !== "undefined" && $response ? $response.body : "";
  if (typeof body !== "string" || !body) {
    $done({});
    return;
  }
  let obj;
  try {
    obj = JSON.parse(body);
  } catch (e) {
    $done({});
    return;
  }
  let changed = false;
  try {
    if (/\/aggroup\/indexTab/.test(mtqxUrl)) changed = mtqxTab(obj);
    else if (/\/lycoris\/scene\//.test(mtqxUrl)) { mtqxDiagHome(obj); changed = mtqxFeed(obj); }
    else if (/\/usercenter\/display/.test(mtqxUrl)) changed = mtqxMine(obj);
    else if (/\/searchpage\/defaultword/.test(mtqxUrl)) changed = mtqxDefaultWord(obj);
    else if (/\/searchpage\/hotword\/city\/divide\/hotrecommend\//.test(mtqxUrl)) changed = mtqxHotRecommend(obj);
    else if (/\/assistant\/getAppClientHornConfig/.test(mtqxUrl)) changed = mtqxAiSkill(obj);
    else if (/\/mop\/entry\/shoppingCartEntry/.test(mtqxUrl)) changed = mtqxClearArea(obj, "topBannerArea");
    else if (/\/entryModule\/startupPicture/.test(mtqxUrl)) changed = mtqxClearArea(obj, "startupPicArea");
  } catch (e) {
    changed = false;
  }
  if (changed) $done({ body: JSON.stringify(obj) });
  else $done({});
})();
