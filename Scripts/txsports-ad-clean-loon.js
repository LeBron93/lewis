/*
 * 腾讯体育净化 · Loon 适配副本
 * 原作者: TG@ZenMoFiShi, 源文件: ZenmoFeiShi/Qx txsports-ad-clean.js (snippet 注明更新于 2026-11-01)
 * 源文件 SHA-256: 4e226de5408e8a6fb25bc5ebfd1cb802bc89097d21dc3c1e85c12f3f3d56fab4
 * 仅改动平台 I/O 垫片, 其余逻辑原样未动; 本文件与源文件不是逐字节相同。
 * 扩展 v12 (2026-11-04): feeds/list 分支在上游原逻辑之后, 追加整项删除广告条目
 * (谓词移植自 Hey-sayiwanna TencentSportsAdBlock.js 的 isFeedAd: id=ad / type 613 /
 * 强插 / is_force_insert / internalbanner 等标记); 上游原逻辑未动, 其余分支与上游一致。
 * 动因: 诊断证实 SSP 渠道返回空单、HTTPDNS 层亦无效, 文章底部广告随列表数据下发,
 * 上游只清广告字段不删整项, 故补此一层。
 * 垫片: (1) $response.statusCode -> $response.status || $response.statusCode;
 * (2) $response.bodyBytes -> $response.bodyBytes || $response.body (Loon 在 binary-body-mode=true 时 $response.body 为 Uint8Array);
 * (3) $done({bodyBytes: ArrayBuffer}) -> $done({body: Uint8Array})。
 * 插件中仅 GetTabRemoteConfig 一条开 binary-body-mode=true, 其余规则保持字符串 body。
 * 未在真机验证, protobuf 分支与 sports.ssp.qq.com 的 $request.body 分支尤其未验证。
 */
(function () {
  function tsqxVarint(b, p) {
    var n = 0, m = 1, i, x;
    for (i = 0; i < 5 && p < b.length; i++) {
      x = b[p++];
      n += (x & 127) * m;
      if (!(x & 128)) {
        if (n > 4294967295) throw new Error("varint");
        return { n: n, p: p };
      }
      m *= 128;
    }
    throw new Error("varint");
  }
  function tsqxFields(b) {
    var out = [], p = 0, t, n, w, s, a, z, i;
    while (p < b.length) {
      if (out.length >= 10000) throw new Error("fields");
      s = p; t = tsqxVarint(b, p); p = t.p;
      n = Math.floor(t.n / 8); w = t.n % 8;
      if (!n) throw new Error("tag");
      if (w === 2) {
        t = tsqxVarint(b, p); a = t.p; z = a + t.n; p = z;
      } else if (w === 0) {
        a = p;
        for (i = 0; i < 10; i++) {
          if (p >= b.length) throw new Error("bounds");
          if (!(b[p++] & 128)) break;
        }
        if (i === 10) throw new Error("varint64");
        z = p;
      } else if (w === 1 || w === 5) {
        a = p; z = p + (w === 1 ? 8 : 4); p = z;
      } else {
        throw new Error("wire");
      }
      if (p > b.length) throw new Error("bounds");
      out.push({ n: n, w: w, s: s, e: p, a: a, z: z });
    }
    return out;
  }
  function tsqxText(b) {
    var s = "", i;
    for (i = 0; i < b.length; i++) {
      if (b[i] > 127) return null;
      s += String.fromCharCode(b[i]);
    }
    return s;
  }
  function tsqxEncode(s) {
    var b = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function tsqxJoin(parts) {
    var n = 0, i, p = 0, b;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    if (n > 2097152) throw new Error("size");
    b = new Uint8Array(n);
    for (i = 0; i < parts.length; i++) {
      b.set(parts[i], p); p += parts[i].length;
    }
    return b;
  }
  function tsqxUnsigned(n) {
    var a = [];
    while (n >= 128) {
      a.push((n % 128) + 128); n = Math.floor(n / 128);
    }
    a.push(n);
    return new Uint8Array(a);
  }
  function tsqxPack(n, b) {
    return tsqxJoin([tsqxUnsigned(n * 8 + 2), tsqxUnsigned(b.length), b]);
  }
  function tsqxString(n, s) {
    return tsqxPack(n, tsqxEncode(s));
  }
  function tsqxKey(b, fs) {
    var key = null, i, f;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.n === 1 && f.w === 2) {
        if (key !== null) throw new Error("duplicate-key");
        key = tsqxText(b.subarray(f.a, f.z));
      }
    }
    return key;
  }
  function tsqxValue(b, key, wanted) {
    var fs = tsqxFields(b), chunks = [], count = 0, changed = false, i, f, v;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.n === 4 && f.w === 2 && tsqxText(b.subarray(f.a, f.z)) !== key) {
        throw new Error("name");
      }
      if (f.n === 1 && f.w === 2) {
        count++;
        v = tsqxText(b.subarray(f.a, f.z));
        if (v !== wanted) {
          chunks.push(tsqxString(1, wanted)); changed = true;
          continue;
        }
      }
      chunks.push(b.subarray(f.s, f.e));
    }
    if (!count) throw new Error("value");
    return changed ? tsqxJoin(chunks) : b;
  }
  function tsqxEntry(b, fs, key, wanted) {
    var chunks = [], count = 0, changed = false, i, f, old, next;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.n === 2 && f.w === 2) {
        count++;
        old = b.subarray(f.a, f.z); next = tsqxValue(old, key, wanted);
        if (next !== old) {
          chunks.push(tsqxPack(2, next)); changed = true;
          continue;
        }
      }
      chunks.push(b.subarray(f.s, f.e));
    }
    if (count !== 1) throw new Error("entry");
    return changed ? tsqxJoin(chunks) : b;
  }
  function tsqxNewEntry(key, value) {
    return tsqxPack(3, tsqxJoin([
      tsqxString(1, key),
      tsqxPack(2, tsqxJoin([tsqxString(1, value), tsqxString(4, key)]))
    ]));
  }
  function tsqxHeaderUserAgent() {
    var hs = $request.headers || {}, h;
    for (h in hs) if (h.toLowerCase() === "user-agent") return String(hs[h]);
    return "";
  }
  function tsqxXmlRun(url) {
    var raw, ua, out;
    if (!/^https?:\/\/k\.ssp\.qq\.com\/getsdkconfig(?:\?|$)/.test(url)) return {};
    ua = tsqxHeaderUserAgent();
    if (!/^QQSportsV3\//i.test(ua)) return {};
    raw = $response.body;
    if (typeof raw !== "string" || !raw) return {};
    out = raw.replace(/(<key>adOn<\/key>\s*<string>)YES(<\/string>)/g, "$1NO$2");
    out = out.replace(/(<key>gdtAdOn<\/key>\s*<string>)YES(<\/string>)/g, "$1NO$2");
    return out !== raw ? { body: out } : {};
  }
  function tsqxClearAdInfos(a) {
    var i, x, changed = false;
    if (!Array.isArray(a)) return false;
    for (i = 0; i < a.length; i++) {
      x = a[i];
      if (x && typeof x === "object" && Array.isArray(x.adInfos) && x.adInfos.length) {
        x.adInfos = [];
        changed = true;
      }
    }
    return changed;
  }
  function tsqxDropMyModules(a) {
    var drop = { "804": true, "810": true, "816": true, "817": true }, keep = [], i, x, t;
    if (!Array.isArray(a)) return false;
    for (i = 0; i < a.length; i++) {
      x = a[i]; t = x && Number(x.moduleType);
      if (drop[String(t)]) continue;
      keep.push(x);
    }
    if (keep.length === a.length) return false;
    a.length = 0;
    for (i = 0; i < keep.length; i++) a.push(keep[i]);
    return true;
  }
  function tsqxDropHotRaceRail(a) {
    var keep = [], i, x, t, hit = false;
    if (!Array.isArray(a)) return false;
    for (i = 0; i < a.length; i++) {
      x = a[i]; t = x && typeof x === "object" ? Number(x.type) : NaN;
      if (t === 1120) { hit = true; continue; }
      keep.push(x);
    }
    if (!hit) return false;
    a.length = 0;
    for (i = 0; i < keep.length; i++) a.push(keep[i]);
    return true;
  }
  function tsqxSspTargetRequest() {
    var raw = $request.body, req, a, i, slot, hit = false;
    if (typeof raw !== "string" || !raw) return false;
    try { req = JSON.parse(raw); } catch (e) { return false; }
    a = req && req.adReqData;
    if (!a || a.adtype !== 7 || a.chid !== 5 || String(a.launch) !== "0" || !Array.isArray(a.slot)) return false;
    for (i = 0; i < a.slot.length; i++) {
      slot = a.slot[i];
      if (slot && String(slot.loid) === "71,73") hit = true;
    }
    return hit;
  }
  function tsqxIsFeedAd(item) {
    var report, infoReport, jumpUrl, info, param;
    if (!item || typeof item !== "object") return false;
    report = typeof item.report === "string" ? item.report : JSON.stringify(item.report || {});
    info = item.info && typeof item.info === "object" ? item.info : null;
    infoReport = info && typeof info.report === "string" ? info.report : JSON.stringify((info && info.report) || {});
    jumpUrl = "";
    if (info && info.jumpData && info.jumpData.param && typeof info.jumpData.param === "object") {
      param = info.jumpData.param;
      jumpUrl = param.url || param.iosUrl || "";
    }
    return (
      item.id === "ad" ||
      item.type === 613 ||
      item.reason === "\u5f3a\u63d2" ||
      /"rec_type":"613"/.test(report) ||
      /"is_force_insert":"1"/.test(report) ||
      /"module":"internalbanner"/.test(report) ||
      /"sub_ei":"banner"/.test(report) ||
      /ad\.sports|gdt|advert|internalbanner/i.test(report) ||
      /ad\.sports|gdt|advert|internalbanner/i.test(infoReport) ||
      /waimai\.meituan\.com|gdt\.qq\.com/i.test(jumpUrl)
    );
  }
  function tsqxJsonRun(url) {
    var raw = $response.body, o, d, inner, changed = false, i;
    if (typeof raw !== "string" || !raw) return {};
    try { o = JSON.parse(raw); } catch (e) { return {}; }
    if (/^https?:\/\/app\.sports\.qq\.com\/init\/config(?:\?|$)/.test(url)) {
      d = o && o.data;
      if (!d || typeof d !== "object" || !d.middleIcon || typeof d.middleIcon !== "object") return {};
      if (String(d.middleIcon.isAble) === "0") return {};
      d.middleIcon.isAble = "0";
      return { body: JSON.stringify(o) };
    }
    if (/^https?:\/\/app\.sports\.qq\.com\/user\/homePageV2(?:\?|$)/.test(url)) {
      d = o && o.data;
      if (!d || typeof d !== "object" || !tsqxDropMyModules(d.moduleList)) return {};
      return { body: JSON.stringify(o) };
    }
    if (/^https?:\/\/app\.sports\.qq\.com\/m\/match\/liveSum(?:\?|$)/.test(url)) {
      d = o && o.data;
      if (!d || typeof d !== "object") return {};
      if (Number(d.sum) === 0 && d.mids && typeof d.mids === "object" && Object.keys(d.mids).length === 0) return {};
      d.sum = 0;
      d.mids = {};
      return { body: JSON.stringify(o) };
    }
    if (/^https?:\/\/app\.sports\.qq\.com\/match\/multiUpdate(?:\?|$)/.test(url)) {
      d = o && o.data;
      if (!d || typeof d !== "object" || Array.isArray(d)) return {};
      for (i in d) {
        if (d[i] && typeof d[i] === "object" && d[i].matchInfo) {
          o.data = {};
          return { body: JSON.stringify(o) };
        }
      }
      return {};
    }
    if (/^https?:\/\/app\.sports\.qq\.com\/feeds\/(?:home|list)(?:\?|$)/.test(url)) {
      d = o && o.data;
      if (!d || typeof d !== "object") return {};
      if (Array.isArray(d.topItem) && tsqxDropHotRaceRail(d.topItem)) changed = true;
      if (/^https?:\/\/app\.sports\.qq\.com\/feeds\/home(?:\?|$)/.test(url) && Array.isArray(d.hotWords) && d.hotWords.length) {
        d.hotWords = [];
        changed = true;
      }
      if (/^https?:\/\/app\.sports\.qq\.com\/feeds\/home(?:\?|$)/.test(url) && Object.prototype.hasOwnProperty.call(d, "coinIcon")) {
        delete d.coinIcon;
        changed = true;
      }
      if (typeof d.adList === "string" && d.adList !== "") {
        d.adList = "";
        changed = true;
      }
      if (tsqxClearAdInfos(d.list)) changed = true;
      if (tsqxClearAdInfos(d.topItem)) changed = true;
      if (Array.isArray(d.list)) {
        var kept = [], k;
        for (k = 0; k < d.list.length; k++) {
          if (!tsqxIsFeedAd(d.list[k])) kept.push(d.list[k]);
        }
        if (kept.length !== d.list.length) { d.list = kept; changed = true; }
      }
      return changed ? { body: JSON.stringify(o) } : {};
    }
    if (/^https?:\/\/sports\.ssp\.qq\.com\/app(?:\?|$)/.test(url)) {
      if (!tsqxSspTargetRequest() || !o || typeof o.adList !== "string" || !o.adList) return {};
      try { inner = JSON.parse(o.adList); } catch (e2) { return {}; }
      if (!inner || !Array.isArray(inner.index) || !inner.index.length || !Array.isArray(inner.order) || !inner.order.length) return {};
      for (i = 0; i < inner.index.length; i++) {
        if (!inner.index[i] || Number(inner.index[i].channel_id) !== 7247) return {};
      }
      inner.order = [];
      o.adList = JSON.stringify(inner);
      return { body: JSON.stringify(o) };
    }
    return {};
  }
  function tsqxRun() {
    if (typeof $request === "undefined" || typeof $response === "undefined") return {};
    var tsqxUrl = $request.url || "";
    if (/^https?:\/\/k\.ssp\.qq\.com\/getsdkconfig(?:\?|$)/.test(tsqxUrl)) return tsqxXmlRun(tsqxUrl);
    if (/^https?:\/\/app\.sports\.qq\.com\/(?:init\/config|user\/homePageV2|m\/match\/liveSum|match\/multiUpdate|feeds\/(?:home|list))(?:\?|$)|^https?:\/\/sports\.ssp\.qq\.com\/app(?:\?|$)/.test(tsqxUrl)) return tsqxJsonRun(tsqxUrl);
    if (!/^https?:\/\/config\.ab\.qq\.com\/tab\/GetTabRemoteConfig(?:\?|$)/.test(tsqxUrl)) return {};
    var hs = $request.headers || {}, ua = "", h, raw, b;
    for (h in hs) if (h.toLowerCase() === "user-agent") ua = String(hs[h]);
    if (!/^QQSportsV3\//i.test(ua)) return {};
    var respStatus = $response.status || $response.statusCode; if (respStatus && respStatus !== 200) return {};
    raw = $response.bodyBytes || $response.body;
    if (!raw) return {};
    if (Object.prototype.toString.call(raw) === "[object ArrayBuffer]") {
      b = new Uint8Array(raw);
    } else if (ArrayBuffer.isView(raw)) {
      b = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    } else {
      return {};
    }
    if (!b.length || b.length > 2097152) return {};
    var values = { iqad_splash_forbid_splash: "1", teenager_guide_show_interval: "36500" };
    var fs = tsqxFields(b), code = null, maps = 0, i, f, sub, ef, key, next;
    var seen = {}, chunks = [], changed = false;
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.n === 1 && f.w === 0) code = tsqxVarint(b, f.a).n;
      if (f.n === 3 && f.w === 2) maps++;
    }
    if (code !== 100 || !maps) return {};
    for (i = 0; i < fs.length; i++) {
      f = fs[i];
      if (f.n === 3 && f.w === 2) {
        sub = b.subarray(f.a, f.z); ef = tsqxFields(sub); key = tsqxKey(sub, ef);
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          seen[key] = true; next = tsqxEntry(sub, ef, key, values[key]);
          if (next !== sub) {
            chunks.push(tsqxPack(3, next)); changed = true;
            continue;
          }
        }
      }
      chunks.push(b.subarray(f.s, f.e));
    }
    for (key in values) {
      if (!seen[key]) {
        chunks.push(tsqxNewEntry(key, values[key])); changed = true;
      }
    }
    return changed ? { body: tsqxJoin(chunks) } : {};
  }
  var tsqxOutput = {};
  try { tsqxOutput = tsqxRun(); } catch (tsqxError) {}
  $done(tsqxOutput);
})();
