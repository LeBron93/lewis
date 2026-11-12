/**
 * 网络诊断雷达 · Loon 版
 * 由 Surge 版移植：去掉 Surge 专有 API，改为 Loon 定时/按需诊断，
 * 产出统一的 JSON 快照（$persistentStore + 可选同步到你的 URL），并推送一条汇总通知。
 * 小组件（Scripting「网络诊断雷达」）可直接读取同一份快照结构。
 *
 * 参数（插件 argument= 或 Loon 脚本参数，query 形式 a=1&b=2）：
 *   POLICY=策略名        最高优先级，出口/延迟/UDP/流媒体/AI 全部走该策略
 *   LMT=策略组名         流媒体专用策略（POLICY 为空时生效）
 *   AI=策略组名          AI 专用策略（POLICY 为空时生效）
 *   YS=1                 输出中对 IP 打码（123.123.123.123 → 123.123.*.*）
 *   XY=VLESS             手动指定协议（不填则从策略组/节点名推断）
 *   NOTIFY=0             关闭通知（默认发通知）
 *   SYNC=https://...     把快照 POST 到该地址（任意接受 JSON 的 KV / Worker / NAS）
 *   DEBUG=1              输出详细日志
 *
 * 用法（见 loon/网络诊断雷达.plugin）：
 *   [Script]
 *   cron "*\/15 * * * *" script-path=..., tag=radar, timeout=60, argument="YS=0&NOTIFY=1"
 *   generic script-path=..., tag=radar-manual, timeout=60, argument="YS=0&NOTIFY=1&DEBUG=1"
 *
 * 手动跑：Loon → 脚本 → 点 radar-manual → 运行。
 * 注意：Loon 没有 Surge 的 wake-system 唤醒，定时任务依赖 Loon 在后台存活，
 * 锁屏久了可能跳过某次执行，属 Loon 平台限制。
 *
 * 与 Surge 版的差异（只改平台垫片，诊断逻辑不变）：
 *   - $httpClient 的 policy 选项 → Loon 的 node 选项（DIRECT / 节点名 / 策略组名）
 *   - $httpClient 超时单位：Surge 是秒，Loon 是毫秒（这里统一按秒写，调用处 ×1000）
 *   - $surge.selectGroupDetails() → $config.getConfig() + $config.getSelectedPolicy()
 *     （读出站模式、策略组列表、当前选中节点；协议仍从节点名推断）
 *   - $network 不存在于 Loon：本地 IP / 网关 / DNS 取不到，快照里留空，
 *     WiFi SSID 从 $config.getConfig() 的 ssid 字段读；本地卡片以小组件自测为准
 *   - 快照 src 由 "surge" 改为 "loon"，loon 字段取代 surge 字段
 */

const KEY_SNAPSHOT = "radar.snapshot.v1";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const TIMEOUT = 8;          // 单请求超时（秒）
const PROBE_TIMEOUT = 3;    // 策略探测超时（秒）
const CONCURRENCY = 6;

const RAW_ARG = typeof $argument === "string" && $argument ? $argument : "";
const ARG = parseArgument(RAW_ARG);

const POLICY = clean(ARG.POLICY);
const LMT = clean(ARG.LMT);
const AI = clean(ARG.AI);
const MASK = clean(ARG.YS) === "1";
const FORCE_PROTOCOL = clean(ARG.XY);
const NOTIFY = clean(ARG.NOTIFY) !== "0";
const SYNC = clean(ARG.SYNC);
const DEBUG = clean(ARG.DEBUG) === "1";

const MAINLAND_LATENCY_URLS = [
  "http://connect.rom.miui.com/generate_204",
  "http://wifi.vivo.com.cn/generate_204",
  "https://www.baidu.com/favicon.ico",
  "https://www.qq.com/favicon.ico"
];

const GLOBAL_LATENCY_URLS = [
  "https://cp.cloudflare.com/generate_204",
  "https://www.gstatic.com/generate_204",
  "https://www.google.com/generate_204"
];

const QUIC_TRACE_URLS = [
  "https://cloudflare-quic.com/cdn-cgi/trace",
  "https://cloudflare.com/cdn-cgi/trace"
];

const MEDIA_SERVICES = [
  { id: "netflix", name: "Netflix", url: "https://www.netflix.com/title/81215567" },
  { id: "disney", name: "Disney+", url: "https://www.disneyplus.com/" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/" },
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/" },
  { id: "prime", name: "Prime", url: "https://www.primevideo.com/" }
];

const AI_SERVICES = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "claude", name: "Claude", url: "https://claude.ai/" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/" },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/" },
  { id: "grok", name: "Grok", url: "https://grok.com/" },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/" }
];

const MEDIA_POLICY_CANDIDATES = [
  "流媒体", "流媒体解锁", "Netflix", "媒体", "国际媒体", "Streaming", "Media", "解锁", "外网媒体"
];

const AI_POLICY_CANDIDATES = [
  "AI", "AI服务", "人工智能", "ChatGPT", "OpenAI", "智能", "AI 服务"
];

const DNS_PROVIDERS = [
  { key: ["1.1.1.1", "1.0.0.1"], full: "Cloudflare", short: "CF" },
  { key: ["8.8.8.8", "8.8.4.4"], full: "Google", short: "GOOG" },
  { key: ["223.5.5.5", "223.6.6.6"], full: "阿里 DNS", short: "ALI" },
  { key: ["119.29.29.29", "182.254.116.116"], full: "腾讯 DNS", short: "TX" },
  { key: ["114.114.114.114", "114.114.115.115"], full: "114 DNS", short: "114" },
  { key: ["180.76.76.76"], full: "百度 DNS", short: "BD" },
  { key: ["9.9.9.9", "149.112.112.112"], full: "Quad9", short: "Q9" },
  { key: ["208.67.222.222", "208.67.220.220"], full: "OpenDNS", short: "ODNS" }
];

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

(async function main() {
  const startedAt = Date.now();

  const net = readNetwork();
  const loonInfo = readLoonInfo();

  const [exitInfo, localExit, proxyLat, localLat, quic] = await Promise.all([
    collectExit(),
    collectLocalExit(),
    measureLatency(GLOBAL_LATENCY_URLS, POLICY),
    measureLatency(MAINLAND_LATENCY_URLS, "DIRECT"),
    detectQuic()
  ]);

  const mediaPolicy = await resolveCategoryPolicy("media");
  const aiPolicy = await resolveCategoryPolicy("ai");

  const [media, ai] = await Promise.all([
    runServices(MEDIA_SERVICES, mediaPolicy),
    runServices(AI_SERVICES, aiPolicy)
  ]);

  const carrier = localExit.carrier || "";
  const netLabel = net.label || (carrier ? "蜂窝 · " + carrier : "未知网络");

  const snapshot = {
    v: 1,
    ts: Date.now(),
    src: "loon",
    masked: MASK,
    exit: {
      ip: displayIP(exitInfo.ip),
      cc: exitInfo.cc,
      country: exitInfo.country,
      region: exitInfo.region,
      city: exitInfo.city,
      isp: exitInfo.isp,
      asn: exitInfo.asn,
      org: exitInfo.org,
      proxy: exitInfo.flags.proxy,
      hosting: exitInfo.flags.hosting || exitInfo.flags.datacenter,
      mobile: exitInfo.flags.mobile,
      kind: exitInfo.kind,
      purity: exitInfo.purity,
      risk: exitInfo.risk
    },
    local: {
      net: netLabel,
      ip: displayIP(net.ip),
      gw: net.gw,
      dns: net.dnsLabel,
      area: localExit.area,
      carrier: carrier,
      nat: detectNAT(net.ip, exitInfo.ip).label,
      vpn: net.vpn,
      v6: net.v6
    },
    lat: { proxy: proxyLat.ms, local: localLat.ms },
    quic: { ok: quic.ok, reachable: quic.reachable },
    media: media,
    ai: ai,
    loon: {
      mode: loonInfo.mode,
      policy: loonInfo.policy,
      protocol: FORCE_PROTOCOL || loonInfo.protocol,
      node: loonInfo.node
    },
    cost: Date.now() - startedAt
  };

  const json = JSON.stringify(snapshot);
  $persistentStore.write(json, KEY_SNAPSHOT);

  if (SYNC) {
    pushSync(SYNC, json);
  }

  if (NOTIFY) {
    notify(snapshot);
  }

  log("done in " + (Date.now() - startedAt) + "ms");
  $done();
})().catch(function (error) {
  log("fatal: " + error);
  if (NOTIFY) {
    $notification.post("网络诊断雷达", "诊断失败", String(error).slice(0, 180));
  }
  $done();
});

/* ------------------------------------------------------------------ */
/* 数据采集                                                            */
/* ------------------------------------------------------------------ */

async function collectExit() {
  const [ipApi, ipWho, ipApiIs, ipInfo] = await Promise.all([
    getJSON("http://ip-api.com/json/?lang=zh-CN&fields=status,message,query,country,countryCode,regionName,city,isp,org,as,asname,proxy,hosting,mobile&_=" + Date.now()),
    getJSON("https://ipwho.is/?lang=zh-CN&_=" + Date.now()),
    getJSON("https://api.ipapi.is/?_=" + Date.now()),
    getJSON("https://ipinfo.io/json?_=" + Date.now())
  ]);

  const flags = {
    proxy: false,
    vpn: false,
    tor: false,
    abuser: false,
    hosting: false,
    datacenter: false,
    mobile: false,
    residential: false
  };

  let ip = "";
  let cc = "";
  let country = "";
  let region = "";
  let city = "";
  let isp = "";
  let asn = "";
  let org = "";

  if (ipApi) {
    ip = ip || clean(ipApi.query);
    country = country || clean(ipApi.country);
    cc = cc || countryCode(ipApi.countryCode);
    region = region || clean(ipApi.regionName);
    city = city || clean(ipApi.city);
    isp = isp || clean(ipApi.isp);
    org = org || clean(ipApi.org);
    asn = asn || clean(ipApi.as);
    flags.proxy = flags.proxy || ipApi.proxy === true;
    flags.hosting = flags.hosting || ipApi.hosting === true;
    flags.mobile = flags.mobile || ipApi.mobile === true;
  }

  if (ipWho && ipWho.success !== false) {
    const conn = ipWho.connection || {};
    ip = ip || clean(ipWho.ip);
    country = country || clean(ipWho.country);
    cc = cc || countryCode(ipWho.country_code);
    region = region || clean(ipWho.region);
    city = city || clean(ipWho.city);
    isp = isp || clean(conn.isp) || clean(conn.org);
    org = org || clean(conn.org);
    asn = asn || (conn.asn ? "AS" + conn.asn : "");
  }

  if (ipApiIs) {
    const asnInfo = ipApiIs.asn || {};
    const loc = ipApiIs.location || {};
    const company = ipApiIs.company || {};
    ip = ip || clean(ipApiIs.ip);
    country = country || clean(loc.country);
    cc = cc || countryCode(loc.country_code);
    region = region || clean(loc.state);
    city = city || clean(loc.city);
    org = org || clean(asnInfo.org) || clean(company.name);
    asn = asn || (asnInfo.asn ? String(asnInfo.asn) : "");
    flags.mobile = flags.mobile || ipApiIs.is_mobile === true;
    flags.datacenter = flags.datacenter || ipApiIs.is_datacenter === true;
    flags.proxy = flags.proxy || ipApiIs.is_proxy === true;
    flags.vpn = flags.vpn || ipApiIs.is_vpn === true;
    flags.tor = flags.tor || ipApiIs.is_tor === true;
    flags.abuser = flags.abuser || ipApiIs.is_abuser === true;
  }

  if (ipInfo) {
    ip = ip || clean(ipInfo.ip);
    cc = cc || countryCode(ipInfo.country);
    city = city || clean(ipInfo.city);
    region = region || clean(ipInfo.region);
    const orgText = clean(ipInfo.org);
    if (orgText && !asn) {
      const matched = orgText.match(/^(AS\d+)\s+(.*)$/);
      if (matched) {
        asn = matched[1];
        org = org || matched[2];
      } else {
        org = org || orgText;
      }
    }
  }

  if (!ip) {
    return {
      ip: "",
      cc: "",
      country: "",
      region: "",
      city: "",
      isp: "",
      asn: "",
      org: "",
      flags: flags,
      kind: "未知网络",
      purity: 0,
      risk: "未知"
    };
  }

  flags.residential = !flags.datacenter && !flags.hosting && !flags.proxy && !flags.vpn && !flags.tor && !flags.mobile;

  const kind = classifyExitKind(flags);
  const purity = purityScore(flags, kind);
  const risk = riskLevel(flags, purity);

  return {
    ip: ip,
    cc: cc,
    country: country,
    region: region,
    city: city,
    isp: isp || org,
    asn: asn.startsWith("AS") || !asn ? asn : "AS" + asn,
    org: org,
    flags: flags,
    kind: kind,
    purity: purity,
    risk: risk
  };
}

async function collectLocalExit() {
  const [ipip, plainIp] = await Promise.all([
    getText("https://myip.ipip.net", TIMEOUT, "DIRECT"),
    getText("https://ip.3322.net", TIMEOUT, "DIRECT")
  ]);

  let ip = "";
  let area = "";
  let carrier = "";

  const ipMatch = clean(ipip).match(/IP[：:\s]*([0-9]{1,3}(\.[0-9]{1,3}){3})/i);
  if (ipMatch) {
    ip = ipMatch[1];
  }

  const fromMatch = clean(ipip).match(/来自于[：:\s]*(.+)$/m);
  if (fromMatch) {
    const parts = fromMatch[1].trim().split(/\s+/).filter(Boolean);
    if (parts.length > 0) {
      carrier = parts[parts.length - 1];
      area = parts.slice(0, parts.length - 1).join(" ");
    }
  }

  if (!ip) {
    const plain = clean(plainIp);
    const plainMatch = plain.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
    if (plainMatch) ip = plainMatch[1];
  }

  if (ip && (!area || !carrier)) {
    const detail = await getJSON(
      "http://ip-api.com/json/" + ip + "?lang=zh-CN&fields=status,country,regionName,city,isp,org,as&_=" + Date.now(),
      TIMEOUT,
      "DIRECT"
    );
    if (detail) {
      area = area || [clean(detail.country), clean(detail.regionName), clean(detail.city)].filter(Boolean).join(" ");
      carrier = carrier || clean(detail.isp) || clean(detail.org);
    }
  }

  return {
    ip: ip,
    area: area || "中国大陆",
    carrier: shortCarrier(carrier)
  };
}

async function detectQuic() {
  const results = await Promise.all(
    QUIC_TRACE_URLS.map(function (url) {
      return getText(url + "?_=" + Date.now(), TIMEOUT, POLICY);
    })
  );

  let hasH3 = false;
  let reachable = false;

  for (let i = 0; i < results.length; i += 1) {
    const text = results[i];
    if (!text) continue;
    reachable = true;
    const matched = text.match(/^http=(.+)$/m);
    const protocol = matched ? matched[1].trim().toLowerCase() : "";
    if (protocol === "h3" || protocol.indexOf("h3") >= 0 || protocol.indexOf("http/3") >= 0) {
      hasH3 = true;
      break;
    }
  }

  return { ok: hasH3, reachable: reachable };
}

async function measureLatency(urls, policy) {
  const results = await Promise.all(
    urls.map(function (url) {
      const started = Date.now();
      return getStatus(url, TIMEOUT, policy).then(function (status) {
        return {
          ok: status >= 200 && status < 500,
          ms: Math.max(1, Date.now() - started)
        };
      });
    })
  );

  const passed = results.filter(function (item) {
    return item.ok;
  }).sort(function (a, b) {
    return a.ms - b.ms;
  });

  return { ok: passed.length > 0, ms: passed.length ? passed[0].ms : 0 };
}

async function runServices(services, policy) {
  const results = await mapLimit(services, CONCURRENCY, async function (service) {
    const status = await getStatus(
      service.url + (service.url.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now(),
      TIMEOUT,
      policy
    );

    return {
      id: service.id,
      name: service.name,
      ok: status >= 200 && status < 500,
      policy: policy || ""
    };
  });

  return results;
}

async function resolveCategoryPolicy(category) {
  if (POLICY) return POLICY;

  const preset = category === "media" ? LMT : AI;
  if (preset) return preset;

  const candidates = category === "media" ? MEDIA_POLICY_CANDIDATES : AI_POLICY_CANDIDATES;
  const available = listPolicyNames();

  const ordered = available.length
    ? candidates.filter(function (name) {
        return available.indexOf(name) >= 0;
      })
    : candidates;

  for (let i = 0; i < ordered.length; i += 1) {
    const ok = await probePolicy(ordered[i]);
    if (ok) {
      log("policy resolved for " + category + ": " + ordered[i]);
      return ordered[i];
    }
  }

  return "";
}

async function probePolicy(policy) {
  const status = await getStatus(
    "https://cp.cloudflare.com/generate_204?_=" + Date.now(),
    PROBE_TIMEOUT,
    policy
  );
  return status >= 200 && status < 500;
}

/* ------------------------------------------------------------------ */
/* Loon 环境                                                           */
/* ------------------------------------------------------------------ */

function readNetwork() {
  const result = {
    label: "",
    ip: "",
    gw: "",
    dnsLabel: "系统 DNS",
    vpn: false,
    v6: false
  };

  // Loon 脚本没有 $network：本地 IP / 网关 / DNS / 运营商都取不到，留空。
  // 只有 WiFi SSID 能从 $config.getConfig() 的 ssid 字段读到。
  // 本地卡片（内网 IP / 网关 / DNS）以 Scripting 小组件自测为准。
  let ssid = "";
  try {
    if (typeof $config === "object" && $config && typeof $config.getConfig === "function") {
      const config = JSON.parse($config.getConfig() || "{}") || {};
      ssid = clean(config.ssid);
    }
  } catch (_) {}

  if (ssid) {
    result.label = "WiFi · " + ssid;
  } else {
    result.label = "未知网络";
  }

  return result;
}

function readLoonInfo() {
  const info = { mode: "", policy: "", protocol: "", node: "" };

  try {
    if (typeof $config !== "object" || !$config || typeof $config.getConfig !== "function") return info;

    const config = JSON.parse($config.getConfig() || "{}") || {};
    const model = Number(config.running_model);
    // running_model: 0 全部直连 / 1 规则分流 / 2 全局代理
    info.mode = model === 0 ? "全部直连" : model === 2 ? "全局代理" : model === 1 ? "规则分流" : "";

    if (model === 0) {
      info.node = "直连出口";
      return info;
    }

    const groupNames = listPolicyNames();
    if (!groupNames.length) return info;

    // 优先找主策略组（与 Surge 版同一份偏好顺序）
    const preferred = ["节点", "代理", "机场", "手动", "主策略", "Proxy", "PROXY", "选择"];
    let groupName = "";
    for (let i = 0; i < preferred.length && !groupName; i += 1) {
      for (let j = 0; j < groupNames.length; j += 1) {
        if (groupNames[j].indexOf(preferred[i]) >= 0) {
          groupName = groupNames[j];
          break;
        }
      }
    }
    if (!groupName) groupName = groupNames[0];

    // 顺着策略组往下钻到真正的节点（getSelectedPolicy 是同步 API）
    const resolved = resolveLoonNode(groupName, groupNames);
    info.policy = resolved.group || groupName;
    info.node = resolved.node;
    info.protocol = protocolFromName(info.node);
  } catch (error) {
    log("readLoonInfo unavailable: " + error);
  }

  return info;
}

/** 沿策略组链下钻：每层用 getSelectedPolicy 取当前选中，直到选中项不是策略组本身 */
function resolveLoonNode(start, groupNames) {
  let current = start;
  let group = "";
  const visited = new Set();

  for (let hop = 0; hop < 6; hop += 1) {
    if (groupNames.indexOf(current) < 0) return { node: current, group: group };
    if (!group) group = current;
    let next = "";
    try {
      next = clean($config.getSelectedPolicy(current));
    } catch (_) {}
    if (!next || visited.has(next)) break;
    visited.add(next);
    current = next;
  }

  if (groupNames.indexOf(current) >= 0) return { node: "", group: group };
  return { node: current, group: group };
}

function protocolFromName(name) {
  const text = clean(name).toLowerCase();
  if (!text) return "";

  const table = [
    ["vless", "VLESS"],
    ["vmess", "VMess"],
    ["trojan", "Trojan"],
    ["hysteria2", "HY2"],
    ["hy2", "HY2"],
    ["tuic", "TUIC"],
    ["ss2022", "SS"],
    ["shadowsocks", "SS"],
    ["anytls", "AnyTLS"],
    ["snell", "Snell"],
    ["wireguard", "WG"],
    ["ssh", "SSH"]
  ];

  for (let i = 0; i < table.length; i += 1) {
    if (text.indexOf(table[i][0]) >= 0) return table[i][1];
  }

  return "";
}

function listPolicyNames() {
  try {
    if (typeof $config === "object" && $config && typeof $config.getConfig === "function") {
      const config = JSON.parse($config.getConfig() || "{}") || {};
      const raw = config.all_policy_groups || [];
      if (!Array.isArray(raw)) return [];
      const names = [];
      for (let i = 0; i < raw.length; i += 1) {
        const item = raw[i];
        const name = clean(typeof item === "string" ? item : item && (item.name || item.policy || item.title));
        if (name && names.indexOf(name) < 0) names.push(name);
      }
      return names;
    }
  } catch (_) {}
  return [];
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function get(url, timeout, policy) {
  return new Promise(function (resolve) {
    const options = {
      url: url,
      // Loon 的 $httpClient 超时单位是毫秒（Surge 是秒），这里统一按秒写，调用处 ×1000
      timeout: (timeout || TIMEOUT) * 1000,
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain,text/html,*/*",
        "Cache-Control": "no-cache"
      }
    };

    if (policy) options.node = policy; // Loon 用 node 指定 DIRECT / 节点名 / 策略组名

    const started = Date.now();

    $httpClient.get(options, function (error, response, data) {
      resolve({
        error: error || null,
        status: response ? response.status : 0,
        text: typeof data === "string" ? data : "",
        ms: Math.max(1, Date.now() - started)
      });
    });
  });
}

async function getText(url, timeout, policy) {
  const result = await get(url, timeout, policy);
  if (result.error || result.status < 200 || result.status >= 500) return "";
  return result.text || "";
}

async function getStatus(url, timeout, policy) {
  const result = await get(url, timeout, policy);
  if (result.error) return 0;
  return result.status || 0;
}

async function getJSON(url, timeout, policy) {
  const text = await getText(url, timeout, policy);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function pushSync(url, body) {
  try {
    $httpClient.post(
      {
        url: url,
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Loon-Radar/1.0"
        },
        body: body
      },
      function (error) {
        if (error) log("sync failed: " + error);
        else log("sync ok");
      }
    );
  } catch (error) {
    log("sync error: " + error);
  }
}

/* ------------------------------------------------------------------ */
/* 通知 & 日志                                                         */
/* ------------------------------------------------------------------ */

function notify(snapshot) {
  const exit = snapshot.exit;
  const mediaOk = snapshot.media.filter(function (item) { return item.ok; }).length;
  const aiOk = snapshot.ai.filter(function (item) { return item.ok; }).length;

  const locationText = [flagEmoji(exit.cc), exit.cc, exit.city].filter(Boolean).join(" ");
  const subtitle = [locationText, exit.ip].filter(Boolean).join(" · ");
  const body = [
    "代理 " + (snapshot.lat.proxy || "—") + "ms / 直连 " + (snapshot.lat.local || "—") + "ms / QUIC " + (snapshot.quic.ok ? "✓" : "✗"),
    "纯净 " + exit.purity + " · " + exit.risk + " · " + (exit.kind || "未知"),
    "媒体 " + mediaOk + "/" + snapshot.media.length + " · AI " + aiOk + "/" + snapshot.ai.length
  ].join("\n");

  $notification.post("网络诊断雷达", subtitle, body);
}

function log(message) {
  if (DEBUG) console.log("[radar] " + message);
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

function parseArgument(raw) {
  const out = {};
  clean(raw).split("&").forEach(function (pair) {
    if (!pair) return;
    const index = pair.indexOf("=");
    if (index < 0) {
      out[pair.trim()] = "1";
      return;
    }
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function countryCode(value) {
  const text = clean(value).toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : "";
}

function flagEmoji(cc) {
  const code = countryCode(cc);
  if (!code) return "";
  return String.fromCodePoint.apply(null, code.split("").map(function (char) {
    return 127397 + char.charCodeAt(0);
  }));
}

function displayIP(ip) {
  const value = clean(ip);
  if (!MASK || !value) return value;
  const parts = value.split(".");
  if (parts.length === 4) return parts[0] + "." + parts[1] + ".*.*";
  const groups = value.split(":");
  if (groups.length > 2) return groups.slice(0, 2).join(":") + ":***";
  return value;
}

function shortCarrier(value) {
  const text = clean(value);
  if (!text) return "";
  if (/移动|cmcc|china mobile/i.test(text)) return "中国移动";
  if (/联通|unicom/i.test(text)) return "中国联通";
  if (/电信|telecom|chinanet/i.test(text)) return "中国电信";
  if (/广电|broadnet/i.test(text)) return "中国广电";
  if (/教育|edu/i.test(text)) return "教育网";
  if (/阿里|alibaba|aliyun/i.test(text)) return "阿里云";
  if (/腾讯|tencent/i.test(text)) return "腾讯云";
  return text.length > 12 ? text.slice(0, 12) : text;
}

function dnsLabel(servers) {
  const list = Array.isArray(servers) ? servers.map(clean).filter(Boolean) : [];
  if (!list.length) return "系统 DNS";

  for (let i = 0; i < DNS_PROVIDERS.length; i += 1) {
    for (let j = 0; j < list.length; j += 1) {
      if (DNS_PROVIDERS[i].key.indexOf(list[j]) >= 0) return DNS_PROVIDERS[i].full;
    }
  }

  const first = list[0];
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(first)) return "路由器 " + first;
  return first;
}

function classifyExitKind(flags) {
  if (flags.mobile) return "移动网络";
  if (flags.residential) return "住宅 IP";
  if (flags.datacenter || flags.hosting) return "商业机房";
  if (flags.proxy || flags.vpn) return "住宅 IP";
  return "未知网络";
}

function purityScore(flags, kind) {
  let score;

  if (kind === "住宅 IP" || kind === "移动网络") score = 92;
  else if (kind === "商业机房") score = 78;
  else score = 72;

  const proxyVpnCount = (flags.proxy ? 1 : 0) + (flags.vpn ? 1 : 0);

  if (flags.tor) score -= 55;
  if (flags.abuser) score -= 35;
  if (proxyVpnCount >= 2) score -= 30;
  else if (proxyVpnCount === 1) score -= 16;
  if (kind === "商业机房" || flags.datacenter || flags.hosting) score -= 8;

  if ((kind === "住宅 IP" || kind === "移动网络") && !flags.proxy && !flags.vpn && !flags.tor && !flags.abuser) {
    score += 3;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function riskLevel(flags, score) {
  const proxyVpnCount = (flags.proxy ? 1 : 0) + (flags.vpn ? 1 : 0);

  if (flags.tor || flags.abuser || score < 45 || (proxyVpnCount >= 2 && score < 60)) return "高风险";
  if (score < 75 || flags.datacenter || flags.hosting || proxyVpnCount > 0) return "中风险";
  return "低风险";
}

function detectNAT(localIP, exitIP) {
  if (isCGNATIPv4(localIP)) return { label: "CGNAT", tone: "amber" };
  if (isPrivateIPv4(localIP) && isPublicIPv4(exitIP)) return { label: "Open", tone: "green" };
  if (isPublicIPv4(localIP)) return { label: "Open", tone: "green" };
  if (isPrivateIPv4(localIP)) return { label: "NAT", tone: "amber" };
  return { label: "未知", tone: "red" };
}

function parseIPv4(ip) {
  const parts = clean(ip).split(".");
  if (parts.length !== 4) return null;

  const values = parts.map(Number);

  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isInteger(values[i]) || values[i] < 0 || values[i] > 255) return null;
  }

  return values;
}

function isPrivateIPv4(ip) {
  const parts = parseIPv4(ip);
  if (!parts) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isCGNATIPv4(ip) {
  const parts = parseIPv4(ip);
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function isPublicIPv4(ip) {
  const parts = parseIPv4(ip);
  if (!parts) return false;
  return (
    !isPrivateIPv4(ip) &&
    !isCGNATIPv4(ip) &&
    parts[0] !== 0 &&
    parts[0] !== 127 &&
    parts[0] < 224 &&
    !(parts[0] === 169 && parts[1] === 254)
  );
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = [];
  const size = Math.min(limit || 1, items.length || 1);

  for (let i = 0; i < size; i += 1) runners.push(run());

  await Promise.all(runners);
  return results;
}
