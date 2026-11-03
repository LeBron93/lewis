// 航旅纵横净化：Loon 原生版（离线组装，未经真机验证）。
// 外壳来源：shengrui123/Loon-YouTube-Plugin《Umetrip.Clean.Loon.js》
//   （2026-09-11，基于上游 V1.0.1）：Loon 二进制接口——$response.body 须为
//   Uint8Array（规则须加 binary-body-mode=true），修改后以新 body 字节返回；
//   未修改及异常时 $done({}) 放行；其保守扩展层 cleanExtraPayload 原样保留。
// 净化算法来源：ddgksf2013 UmetripAds.conf V1.0.3（2026-10-05），本地文件
//   Scripts/umetrip.ads.js（镜像副本，upstream SHA-256
//   b7cae9ecfe5285236e35790bbd81527449b8e95408f17eea7be21a712cb5e112）：
//   cleanHome/Waterfall/TripBanner/Family/History/Mine/FlightPayload、
//   MINE_PROMOTION_NAMES/GROUP_IDS、rewriteJsonFields、isHomePromotionCard/Group、
//   isMinePromotionGroup、directCardNameMatches、directCardJsonMatches 及 JSON
//   文档净化 cleanDocument/transformText 均逐字移植。
// 删去的 QX 专属部分：umetripProtobuf（QX 分发器）与 runQuantumultX（QX 文本入口）。
// 新增：JSON 文档分支——载荷首个非空白字符为 { 或 [ 时走 transformText，
//   以 $done({body}) 返回重编码后的 UTF-8 字节；否则走 Protobuf 路径。
// 本文件只用 Loon 的 Uint8Array body 与 $done({body})，不含 QX 专属入口。
// 状态：UNTESTED ON A REAL DEVICE（仅 Node 离线 harness 验证）。

const EMPTY_RPIDS=new Set(["1000019","1420002","1120000"]),HOME_RPID="1000002",WATERFALL_RPID="1000029",TRIP_BANNER_RPID="1370126",FAMILY_RPID="1370279",HISTORY_RPID="1011058",MINE_RPID="1100001",FLIGHT_RPID="1060060",EMPTY_PAYLOAD=new Uint8Array([10,0,16,0,32,0]),MINE_PROMOTION_NAMES=["我的页面-会员卡片V3","我的页-腰部banner第四帧","礼金中心","票券权益","特价专区-个人中心","机票-31-推荐管",],MINE_PROMOTION_GROUP_IDS=new Set([111402,111403,111404]);function readVarint(e,t){let r=0,n=0;for(;t<e.length&&n<=56;){let o=e[t++];if(r+=(127&o)*Math.pow(2,n),(128&o)==0)return{value:r,pos:t};n+=7}return null}function encodeVarint(e){let t=[],r=e;for(;r>=128;)t.push(r%128|128),r=Math.floor(r/128);return t.push(r),new Uint8Array(t)}function concatBytes(e){let t=0;for(let r of e)t+=r.length;let n=new Uint8Array(t),o=0;for(let i of e)n.set(i,o),o+=i.length;return n}function parseMessage(e){try{let t=0,r=[];for(;t<e.length;){let n=t,o=readVarint(e,t);if(!o)return null;let i=o.value;t=o.pos;let a=Math.floor(i/8),s=7&i;if(0===a||![0,1,2,5].includes(s))return null;if(0===s){let l=readVarint(e,t);if(!l)return null;t=l.pos,r.push({field:a,wire:s,raw:e.slice(n,t)});continue}if(1===s){if(t+8>e.length)return null;t+=8,r.push({field:a,wire:s,raw:e.slice(n,t)});continue}if(5===s){if(t+4>e.length)return null;t+=4,r.push({field:a,wire:s,raw:e.slice(n,t)});continue}let c=readVarint(e,t);if(!c)return null;let u=c.value;if(t=c.pos,u<0||t+u>e.length)return null;let d=e.slice(t,t+u);t+=u,r.push({field:a,wire:s,raw:e.slice(n,t),data:d,dirty:!1})}return r}catch(f){return null}}function encodeMessage(e){let t=[];for(let r of e)2===r.wire&&r.dirty?(t.push(encodeVarint(8*r.field+2)),t.push(encodeVarint(r.data.length)),t.push(r.data)):t.push(r.raw);return concatBytes(t)}function utf8Bytes(e){let t=[];for(let r=0;r<e.length;r++){let n=e.charCodeAt(r);n<128?t.push(n):n<2048?(t.push(192|n>>6),t.push(128|63&n)):n>=55296&&n<=56319&&r+1<e.length?(n=65536+(n-55296<<10)+(e.charCodeAt(++r)-56320),t.push(240|n>>18),t.push(128|n>>12&63),t.push(128|n>>6&63),t.push(128|63&n)):(t.push(224|n>>12),t.push(128|n>>6&63),t.push(128|63&n))}return new Uint8Array(t)}function bytesContains(e,t){let r="string"==typeof t?utf8Bytes(t):t;if(!r.length||r.length>e.length)return!1;outer:for(let n=0;n<=e.length-r.length;n++){for(let o=0;o<r.length;o++)if(e[n+o]!==r[o])continue outer;return!0}return!1}function containsAny(e,t){for(let r of t)if(bytesContains(e,r))return!0;return!1}function bytesEqualAscii(e,t){if(!e||e.length!==t.length)return!1;for(let r=0;r<t.length;r++)if(e[r]!==t.charCodeAt(r))return!1;return!0}function directFieldEqualsAscii(e,t,r){return!!e&&e.some(e=>e.field===t&&2===e.wire&&bytesEqualAscii(e.data,r))}function directFieldAscii(e,t){if(!e)return null;for(let r of e){if(r.field!==t||2!==r.wire)continue;let n="";for(let o of r.data){if(o<32||o>126)return null;n+=String.fromCharCode(o)}return n}return null}function bytesToUtf8(e){if("undefined"!=typeof TextDecoder)try{return new TextDecoder("utf-8").decode(e)}catch(t){}let r="",n=0;for(;n<e.length;){let o=e[n++];if(o<128)r+=String.fromCharCode(o);else if((224&o)==192){if(n>=e.length)return null;r+=String.fromCharCode((31&o)<<6|63&e[n++])}else if((240&o)==224){if(n+1>=e.length)return null;let i;r+=String.fromCharCode((15&o)<<12|(63&e[n++])<<6|63&e[n++])}else{if((248&o)!=240||n+2>=e.length)return null;let a=e[n++],s,l=(7&o)<<18|(63&a)<<12|(63&e[n++])<<6|63&e[n++];l-=65536,r+=String.fromCharCode(55296+(l>>10),56320+(1023&l))}}return r}function replaceTopField7(e,t){let r=parseMessage(e);if(!r)return{bytes:e,count:0};let n=!1;for(let o of r)7===o.field&&2===o.wire&&(o.data=t,o.dirty=!0,n=!0);return{bytes:n?encodeMessage(r):e,count:n?1:0}}function removeMatchingNodes(e,t,r=0){if(r>12)return{bytes:e,count:0};let n=parseMessage(e);if(!n)return{bytes:e,count:0};let o=[],i=0,a=!1;for(let s of n){let l=s;if(2===l.wire){let c=parseMessage(l.data);if(t(l.field,l.data,c)){i++,a=!0;continue}if(c){let u=removeMatchingNodes(l.data,t,r+1);u.count>0&&(l={...l,data:u.bytes,dirty:!0},i+=u.count,a=!0)}}o.push(l)}return{bytes:a?encodeMessage(o):e,count:i}}function transformTopField7(e,t){let r=parseMessage(e);if(!r)return{bytes:e,count:0};let n=!1,o=0;for(let i of r){if(7!==i.field||2!==i.wire)continue;let a=t(i.data);(a.count>0||a.bytes!==i.data)&&(i.data=a.bytes,i.dirty=!0,o+=a.count,n=!0)}return{bytes:n?encodeMessage(r):e,count:o}}function jsonFromBytes(e){let t=bytesToUtf8(e);if(!t||"{"!==t[0]&&"["!==t[0])return null;try{return JSON.parse(t)}catch(r){return null}}function directCardNameMatches(e,t){if(!e)return!1;for(let r of e){if(8!==r.field||2!==r.wire)continue;let n=parseMessage(r.data);if(n)for(let o of n){if(3!==o.field||2!==o.wire)continue;let i=bytesToUtf8(o.data);if(i&&-1!==t.indexOf(i))return!0}}return!1}function directCardJsonMatches(e,t){if(!e)return!1;for(let r of e){if(8!==r.field||2!==r.wire)continue;let n=parseMessage(r.data);if(n)for(let o of n){if(7!==o.field||2!==o.wire)continue;let i=jsonFromBytes(o.data);if(i&&t(i))return!0}}return!1}function isHomePromotionCard(e){if(!e||"object"!=typeof e)return!1;let t=String(e.serviceTrack||""),r=String(e.serviceName||""),n="";try{n=JSON.stringify(e)}catch(o){}return/^advert_/i.test(t)||/\/fs\/advert\//i.test(n)||/"advertId"\s*:/i.test(n)||r.includes("广告位-")||r.includes("娱乐运营活动")}function isHomePromotionGroup(e){if(!e||"object"!=typeof e)return!1;let t=Number(e.groupStyle),r=String(e.dataSource||"").toUpperCase(),n=String(e.groupTitle||e.title||"");return"ADVERT"===r||1009===t||"中秋国庆活动"===n}function cleanHomeJsonObject(e){let t=!1;if(Array.isArray(e)){for(let r of e)t=cleanHomeJsonObject(r)||t;return t}if(!e||"object"!=typeof e)return!1;if(Array.isArray(e.groupList)){let n=e.groupList.length;e.groupList=e.groupList.filter(e=>!isHomePromotionGroup(e)),t=e.groupList.length!==n||t}if(Array.isArray(e.cardList)){let o=e.cardList.length;e.cardList=e.cardList.filter(e=>!isHomePromotionCard(e)),t=e.cardList.length!==o||t}for(let i of Object.keys(e))t=cleanHomeJsonObject(e[i])||t;return t}function rewriteJsonFields(e,t,r=0){if(r>12)return{bytes:e,count:0};let n=parseMessage(e);if(!n)return{bytes:e,count:0};let o=!1,i=0;for(let a of n){if(2!==a.wire)continue;let s=!1;if(a.data.length>=2&&(123===a.data[0]||91===a.data[0])){let l=bytesToUtf8(a.data);if(l)try{let c=JSON.parse(l);t(c)&&(a.data=utf8Bytes(JSON.stringify(c)),a.dirty=!0,o=!0,i++,s=!0)}catch(u){}}if(!s&&parseMessage(a.data)){let d=rewriteJsonFields(a.data,t,r+1);d.count>0&&(a.data=d.bytes,a.dirty=!0,o=!0,i+=d.count)}}return{bytes:o?encodeMessage(n):e,count:i}}function cleanHomePayload(e){let t=["机上闭门购虚拟卡片","中秋国庆活动","回归礼包_无行程首页底部条",],r=removeMatchingNodes(e,(e,r,n)=>5===e&&!!n&&(!!(directFieldEqualsAscii(n,37,"ADVERT")||directCardNameMatches(n,t))||directCardJsonMatches(n,e=>e&&111450===Number(e.groupId)))),n=rewriteJsonFields(r.bytes,cleanHomeJsonObject);return{bytes:n.bytes,count:r.count+n.count}}function cleanWaterfallPayload(e){let t=["瀑布流_特价机票","瀑布流_酒店","瀑布流_租车卡片","瀑布流_权益","瀑布流_今日热议","瀑布流_城市攻略","瀑布流_景点攻略","瀑布流_附近底部跳转",];return removeMatchingNodes(e,(e,r)=>8===e&&containsAny(r,t))}function cleanTripBannerPayload(e){return removeMatchingNodes(e,(e,t)=>8===e&&(bytesContains(t,"付费会员")||bytesContains(t,"更早历史行程待解锁")))}function cleanHistoryPayload(e){return removeMatchingNodes(e,(e,t)=>11===e&&bytesContains(t,"历史行程容量剩余")&&bytesContains(t,"付费会员"))}function cleanFlightPayload(e){return removeMatchingNodes(e,(e,t)=>12===e&&bytesContains(t,"付费会员"))}function cleanFamilyMessage(e,t=0){if(t>12)return{bytes:e,count:0};let r=parseMessage(e);if(!r)return{bytes:e,count:0};let n=r.some(e=>1===e.field&&2===e.wire&&bytesContains(e.data,"可免费试用30天")&&bytesContains(e.data,"payMember")),o=r.some(e=>2===e.field&&2===e.wire&&bytesContains(e.data,"添加家人并开启守护")&&bytesContains(e.data,"payMember"));if(n&&o){let i=[],a=0;for(let s of r){let l=1===s.field&&2===s.wire&&bytesContains(s.data,"可免费试用30天")&&bytesContains(s.data,"payMember"),c=2===s.field&&2===s.wire&&bytesContains(s.data,"添加家人并开启守护")&&bytesContains(s.data,"payMember");if(l||c){a++;continue}i.push(s)}return{bytes:encodeMessage(i),count:a}}let u=!1,d=0;for(let f of r){if(2!==f.wire||!parseMessage(f.data))continue;let p=cleanFamilyMessage(f.data,t+1);p.count>0&&(f.data=p.bytes,f.dirty=!0,d+=p.count,u=!0)}return{bytes:u?encodeMessage(r):e,count:d}}function refreshChildrenIndex(e){if(!e||!Array.isArray(e.children)||!e.childrenIndex)return;let t={};e.children.forEach((e,r)=>{e&&void 0!==e.cardId&&null!==e.cardId&&(t[String(e.cardId)]=r)}),e.childrenIndex=t}function cleanMineJsonObject(e){let t=!1;if(Array.isArray(e)){for(let r of e)cleanMineJsonObject(r)&&(t=!0);return t}if(!e||"object"!=typeof e)return!1;if(111402===e.groupId&&Array.isArray(e.children)){let n=e.children.length;e.children=e.children.filter(e=>{if(!e||"object"!=typeof e)return!0;let t=e.sensorParam&&"object"==typeof e.sensorParam?e.sensorParam:{},r=String(e.title||""),n=String(t.service_name||""),o=String(t.service_label||"");return!(r.includes("会员月卡")||o.includes("会员月卡")||/^商品\d+$/.test(n))}),e.children.length!==n&&(refreshChildrenIndex(e),t=!0)}if(111403===e.groupId&&Array.isArray(e.children)){let o=e.children.length;e.children=e.children.filter(e=>!e||"object"!=typeof e||"PRODUCT"!==String(e.cardType||"")),e.children.length!==o&&(refreshChildrenIndex(e),t=!0)}if(111404===e.groupId&&Array.isArray(e.children))for(let i of e.children){if(!i||!Array.isArray(i.medias))continue;let a=i.medias.length;i.medias=i.medias.filter(e=>{if(!e||"object"!=typeof e)return!0;let t=String(e.caption||""),r=String(e.subCaption||"");return!("买三送一"===t||"全民推荐官"===t||r.includes("视频会员")||r.includes("返现"))}),i.medias.length!==a&&(t=!0)}for(let s of Object.keys(e))cleanMineJsonObject(e[s])&&(t=!0);return t}function rewriteMineJsonFields(e,t=0){if(t>12)return{bytes:e,count:0};let r=parseMessage(e);if(!r)return{bytes:e,count:0};let n=!1,o=0;for(let i of r){if(2!==i.wire)continue;let a=!1;if(i.data.length>=2&&(123===i.data[0]||91===i.data[0])){let s=bytesToUtf8(i.data);if(s)try{let l=JSON.parse(s);cleanMineJsonObject(l)&&(i.data=utf8Bytes(JSON.stringify(l)),i.dirty=!0,n=!0,o++,a=!0)}catch(c){}}if(!a&&parseMessage(i.data)){let u=rewriteMineJsonFields(i.data,t+1);u.count>0&&(i.data=u.bytes,i.dirty=!0,n=!0,o+=u.count)}}return{bytes:n?encodeMessage(r):e,count:o}}function isMinePromotionGroup(e){return!!e&&(!!directCardNameMatches(e,MINE_PROMOTION_NAMES)||directCardJsonMatches(e,e=>{if(!e||"object"!=typeof e)return!1;let t=Number(e.groupId);return!!MINE_PROMOTION_GROUP_IDS.has(t)||"advert"===String((e.trackParam&&"object"==typeof e.trackParam?e.trackParam:{}).department||"").toLowerCase()}))}function cleanMinePayload(e){return removeMatchingNodes(e,(e,t,r)=>5===e&&isMinePromotionGroup(r))}function getHeader(e){let t=$request&&$request.headers||{},r=e.toLowerCase();for(let n of Object.keys(t))if(n.toLowerCase()===r)return String(t[n]);return null}function getRpid(e){return getHeader("rpid")||directFieldAscii(parseMessage(e),5)}"use strict";var PROMOTION_GROUP_STYLES={1009:!0,1040:!0,1077:!0,3021:!0},PROMOTION_PAYLOAD_MARKERS=["/fs/advert/",'"serviceTrack":"advert_','"advertiser"','"advertId"','"adBannerImg"','"adTopImg"','"midBannerImg"','"inBannerImg"','"impressionUrlList"','"clickUrlList"',"/commonModal/",'"weexName":"commonModal"',"/payMember/",'"weexName":"payMember"',"/home-Equity/","historyTripUnlock","dutyfreeNew","免税会员购",];function isObject(e){return null!==e&&"object"==typeof e&&!Array.isArray(e)}function parseObject(e){if(isObject(e))return e;if("string"!=typeof e||0===e.length)return null;try{var t=JSON.parse(e);return isObject(t)?t:null}catch(r){return null}}function payloadText(e){if(!isObject(e))return"";if("string"==typeof e.cardResult)return e.cardResult;if(isObject(e.cardResult))try{return JSON.stringify(e.cardResult)}catch(t){}return""}function hasPromotionMarker(e){if("string"!=typeof e||0===e.length)return!1;for(var t=0;t<PROMOTION_PAYLOAD_MARKERS.length;t+=1)if(-1!==e.indexOf(PROMOTION_PAYLOAD_MARKERS[t]))return!0;return -1!==e.indexOf("memberCardbag")&&-1!==e.indexOf("buyPage")}function isPromotionCard(e){if(!isObject(e))return!1;if(hasPromotionMarker(payloadText(e)))return!0;var t=parseObject(e.cardResult);return!!t&&(!!("string"==typeof t.serviceTrack&&/^advert_/i.test(t.serviceTrack))||void 0!==t.advertId||void 0!==t.advertiser)}function isPromotionGroup(e){return!!isObject(e)&&!!(PROMOTION_GROUP_STYLES[String(e.groupStyle)]||"string"==typeof e.dataSource&&"ADVERT"===e.dataSource.toUpperCase()||"string"==typeof e.businessType&&/(?:advert|marketing|promotion|paymember|member|vip)/i.test(e.businessType)||hasDropTitle(itemLabels(e))||itemLabels(e).some(function(l){return RANK_LABELS.has(l)})||isAirportDeparturesGroup(e))}function cleanGroupList(e,t){if(!Array.isArray(e))return e;for(var r=[],n=0;n<e.length;n+=1){var o=e[n];if(!isObject(o)){r.push(o);continue}if(isPromotionGroup(o)){t.groupsRemoved+=1;continue}if(Array.isArray(o.subGroupList)&&(o.subGroupList=cleanGroupList(o.subGroupList,t)),Array.isArray(o.cardList)){for(var i=o.cardList.length,a=[],s=0;s<o.cardList.length;s+=1)isPromotionCard(o.cardList[s])?t.cardsRemoved+=1:a.push(o.cardList[s]);if(o.cardList=a,i>0&&0===a.length&&(!Array.isArray(o.subGroupList)||0===o.subGroupList.length)){t.groupsRemoved+=1;continue}}r.push(o)}return r}function clearOpenAdvert(e,t){(Array.isArray(e.advertPageInfo)||Object.prototype.hasOwnProperty.call(e,"advertTotalTimeout")||Object.prototype.hasOwnProperty.call(e,"warmStartInterval"))&&(Array.isArray(e.advertPageInfo)&&(t.openAdvertItemsRemoved+=e.advertPageInfo.length,e.advertPageInfo=[]),isObject(e.page)&&Array.isArray(e.page.groupList)&&(t.openAdvertItemsRemoved+=e.page.groupList.length,e.page.groupList=[]),Array.isArray(e.pageIdBlackList)&&(e.pageIdBlackList=[]),"number"==typeof e.advertTotalTimeout&&(e.advertTotalTimeout=0))}function cleanKnownBody(e,t){isObject(e)&&(clearOpenAdvert(e,t),isObject(e.templateService)&&Array.isArray(e.templateService.groupList)&&(e.templateService.groupList=cleanGroupList(e.templateService.groupList,t)),isObject(e.page)&&Array.isArray(e.page.groupList)&&(e.page.groupList=cleanGroupList(e.page.groupList,t)),Object.prototype.hasOwnProperty.call(e,"isShowPop")&&isObject(e.page)&&(e.isShowPop=0),Array.isArray(e.advertDataList)&&(t.advertDataItemsRemoved+=e.advertDataList.length,e.advertDataList=[]),Array.isArray(e.cardCollections)&&Object.prototype.hasOwnProperty.call(e,"isLastPage")&&Object.prototype.hasOwnProperty.call(e,"lastParam")&&(t.waterfallItemsRemoved+=e.cardCollections.length,e.cardCollections=[],e.isLastPage=!0,e.lastParam=""),isObject(e.historyTripCapacity)&&Object.prototype.hasOwnProperty.call(e.historyTripCapacity,"showTripCapacityBar")&&(e.historyTripCapacity.showTripCapacityBar=0,t.capacityBarsHidden+=1),Array.isArray(e.vipShowInfoList)&&(t.vipMarketingItemsRemoved+=e.vipShowInfoList.length,e.vipShowInfoList=[]))}function collectKnownBodies(e){var t=[];return isObject(e)&&(t.push(e),isObject(e.s2cRspBodyWrapPB)&&(isObject(e.s2cRspBodyWrapPB.responsebody)&&t.push(e.s2cRspBodyWrapPB.responsebody),isObject(e.s2cRspBodyWrapPB.responseBody)&&t.push(e.s2cRspBodyWrapPB.responseBody)),isObject(e.presp)&&isObject(e.presp.pdata)&&t.push(e.presp.pdata),isObject(e.responsebody)&&t.push(e.responsebody),isObject(e.responseBody)&&t.push(e.responseBody)),t}function cleanDocument(e){for(var t={groupsRemoved:0,cardsRemoved:0,openAdvertItemsRemoved:0,advertDataItemsRemoved:0,waterfallItemsRemoved:0,capacityBarsHidden:0,vipMarketingItemsRemoved:0},r=collectKnownBodies(e),n=0;n<r.length;n+=1)cleanKnownBody(r[n],t);return{document:e,stats:t}}function transformText(e){try{var t=JSON.parse(e),r=cleanDocument(t);return{ok:!0,body:JSON.stringify(r.document),stats:r.stats}}catch(n){return{ok:!1,body:e,error:String(n)}}}"undefined"!=typeof module&&module.exports&&(module.exports={cleanDocument:cleanDocument,transformText:transformText,isPromotionCard:isPromotionCard,isPromotionGroup:isPromotionGroup});

// 2026-09-11：截图所示界面的保守扩展；未取得真实响应 schema。
// 只删除结构化列表项，绝不按整个响应是否包含关键词来清空页面。
const MINE_LABELS = new Set(['礼金中心', '票券权益', '特价专区']);
const RANK_LABELS = new Set(['风景榜', '盘旋榜', '延误榜', '准点榜', '到达榜']);
const NAV_LABELS = new Set(['首页', '行程', '经验', '动态', '我', '我的']);
const DROP_TITLES = ['民航官方直销', '发现目的地'];
const AIRPORT_DEPARTURES = '__AIRPORT_DEPARTURES__';
function hasDropTitle(labels) {
  return labels.some(label => DROP_TITLES.some(title => label.includes(title)));
}
function hasAirportTitle(labels) {
  return labels.some(label => label.length > 2 && label.endsWith('机场'));
}
function hasFlightMarker(text) {
  return /[A-Z]{2}\d{3,4}/.test(text) || text.includes('起飞');
}
function isAirportDeparturesGroup(group) {
  if (!group || typeof group !== 'object') return false;
  const titles = [group.groupTitle, group.title, group.name].filter(v => typeof v === 'string');
  if (!hasAirportTitle(titles)) return false;
  try { return hasFlightMarker(JSON.stringify(group)); } catch (e) { return false; }
}
const LABEL_KEYS = ['title', 'name', 'caption', 'tabName', 'tabTitle', 'displayName', 'text', 'groupTitle', 'headerTitle', 'moduleName', 'moduleTitle', 'subTitle', 'headTitle', 'cardTitle', 'sectionTitle', 'bannerTitle'];
function itemLabels(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
  const labels = [];
  const collect = (obj, depth) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 2) return;
    for (const key of LABEL_KEYS) if (typeof obj[key] === 'string') labels.push(obj[key]);
    if (depth < 2) for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) collect(v, depth + 1);
    }
  };
  collect(item, 0);
  for (const key of ['tabs', 'tabList']) {
    if (Array.isArray(item[key])) {
      for (const tab of item[key]) {
        if (tab && typeof tab === 'object') {
          for (const k of LABEL_KEYS) if (typeof tab[k] === 'string') labels.push(tab[k]);
        }
      }
    }
  }
  return labels;
}
function navigationList(labels) {
  const present = new Set(labels.flat());
  return present.has('经验') && [...present].filter(label => NAV_LABELS.has(label) && label !== '经验').length >= 2;
}
function removeUIItem(labels, mine, nav, advert) {
  return labels.some(label => RANK_LABELS.has(label)) ||
    hasDropTitle(labels) ||
    labels.includes(AIRPORT_DEPARTURES) ||
    (mine && (advert || labels.some(label => MINE_LABELS.has(label)))) ||
    (nav && labels.includes('经验'));
}
function cleanExtraJson(root, mine) {
  let changed = false;
  // 只回收本次净化造成的空容器；保留原本为空的正常占位。
  function walk(value, depth) {
    if (!value || typeof value !== 'object' || depth > 24) return false;
    if (Array.isArray(value)) {
      const before = value.length;
      const nav = navigationList(value.map(itemLabels));
      for (let i = value.length - 1; i >= 0; i--) {
        const item = value[i];
        if (typeof item === 'string') {
          const trimmed = item.replace(/^\s+/, '');
          if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
            try {
              const parsed = JSON.parse(item);
              if (parsed && typeof parsed === 'object') {
                const before = JSON.stringify(parsed);
                walk(parsed, depth + 1);
                if (JSON.stringify(parsed) !== before) { value[i] = JSON.stringify(parsed); changed = true; }
              }
            } catch (e) {}
          }
          continue;
        }
        const advert = item && ['ADVERT', 'ADVERTISEMENT'].includes(item.cardType);
        const labels = itemLabels(item);
        const matched = removeUIItem(labels, mine, nav, advert) ||
          (hasAirportTitle(labels) && (() => { try { return hasFlightMarker(JSON.stringify(item)); } catch (e) { return false; } })());
        const emptied = !matched && walk(item, depth + 1);
        if (matched || (mine && emptied)) {
          value.splice(i, 1);
          changed = true;
        }
      }
      return before > 0 && value.length === 0;
    }
    let emptiedLayout = false;
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (typeof child === 'string') {
        const trimmed = child.replace(/^\s+/, '');
        if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
          try {
            const parsed = JSON.parse(child);
            if (parsed && typeof parsed === 'object') {
              const before = JSON.stringify(parsed);
              walk(parsed, depth + 1);
              if (JSON.stringify(parsed) !== before) { value[key] = JSON.stringify(parsed); changed = true; }
            }
          } catch (e) {}
          continue;
        }
      }
      const emptied = walk(child, depth + 1);
      if (['children', 'medias'].includes(key) && emptied) emptiedLayout = true;
    }
    if (changed) refreshChildrenIndex(value);
    // 带其他可见内容的混合卡片保留；纯布局属性（背景、圆角、箭头）不保留空壳。
    const hasItems = ['children', 'medias'].some(key => Array.isArray(value[key]) && value[key].length);
    const hasContent = [...LABEL_KEYS, 'image', 'imageUrl', 'icon', 'iconUrl', 'content', 'subTitle', 'subCaption']
      .some(key => typeof value[key] === 'string' && value[key].trim());
    return mine && emptiedLayout && !hasItems && !hasContent;
  }
  walk(root, 0);
  return changed;
}
function directProtoLabels(fields) {
  if (!fields) return [];
  const texts = [];
  for (const field of fields) {
    if (field.wire !== 2) continue;
    const text = bytesToUtf8(field.data);
    if (typeof text === 'string') texts.push(text);
    const nested = parseMessage(field.data);
    if (nested) {
      for (const sub of nested) {
        if (sub.wire !== 2) continue;
        const subText = bytesToUtf8(sub.data);
        if (typeof subText === 'string') texts.push(subText);
      }
    }
  }
  const labels = texts.filter(text =>
    MINE_LABELS.has(text) || RANK_LABELS.has(text) || NAV_LABELS.has(text) || text === 'ADVERT' || hasDropTitle([text]));
  if (hasAirportTitle(texts) && texts.some(hasFlightMarker)) labels.push(AIRPORT_DEPARTURES);
  return labels;
}
function cleanExtraProto(bytes, mine, depth = 0) {
  if (depth > 12) return {bytes, count: 0};
  const fields = parseMessage(bytes);
  if (!fields) return {bytes, count: 0};
  const groups = new Map();
  for (const field of fields) {
    if (field.wire !== 2) continue;
    if (!groups.has(field.field)) groups.set(field.field, []);
    groups.get(field.field).push(field);
  }
  const drop = new Set();
  for (const siblings of groups.values()) {
    // 未知 Protobuf schema 下只处理重复的 message 列表；不删单值字段。
    if (siblings.length < 2) continue;
    const labels = siblings.map(field => directProtoLabels(parseMessage(field.data)));
    const nav = navigationList(labels);
    siblings.forEach((field, index) => {
      if (removeUIItem(labels[index], mine, nav, labels[index].includes('ADVERT'))) drop.add(field);
    });
  }
  let count = drop.size;
  const kept = [];
  for (const field of fields) {
    if (drop.has(field)) continue;
    if (field.wire === 2) {
      const result = cleanExtraProto(field.data, mine, depth + 1);
      if (result.count) {
        count += result.count;
        // 递归净化后完全为空的消息不再写回父级，避免保留空消息外壳。
        if (mine && result.bytes.length === 0) continue;
        field.data = result.bytes;
        field.dirty = true;
      }
    }
    kept.push(field);
  }
  return {bytes: count ? encodeMessage(kept) : bytes, count};
}
function cleanExtraPayload(bytes, mine) {
  const json = rewriteJsonFields(bytes, object => cleanExtraJson(object, mine));
  const proto = cleanExtraProto(json.bytes, mine);
  return {bytes: proto.bytes, count: json.count + proto.count};
}

// TEMPORARY DIAGNOSTIC v3 (2026-11-04): log the exact key-paths of promo titles
// inside embedded JSON docs + strict-vs-trimmed JSON counts. REMOVE before final.
function jsonPathsFingerprint(bytes) {
  try {
    const paths = [];
    let strict = 0, trimmed = 0;
    const TITLE_RE = /礼金中心|票券权益|特价专区|会员月卡|民航官方直销|发现目的地|风景榜|延误榜|准点榜|到达榜|盘旋榜/;
    const scan = (buf, depth) => {
      if (depth > 5 || paths.length >= 8) return;
      const fs = parseMessage(buf);
      if (!fs) return;
      for (const f of fs) {
        if (f.wire !== 2) continue;
        const t = bytesToUtf8(f.data);
        if (typeof t !== 'string') continue;
        const s = t.replace(/^\uFEFF/, '').replace(/^\s+/, '');
        if (s.charAt(0) === '{' || s.charAt(0) === '[') {
          trimmed++;
          if (t.charAt(0) === '{' || t.charAt(0) === '[') strict++;
          try {
            const doc = JSON.parse(s);
            const walkJ = (v, path, d) => {
              if (paths.length >= 8 || !v || typeof v !== 'object' || d > 6) return;
              if (Array.isArray(v)) { v.forEach((x, i) => walkJ(x, path + '[' + i + ']', d + 1)); return; }
              for (const k of Object.keys(v)) {
                const val = v[k];
                if (typeof val === 'string' && TITLE_RE.test(val)) paths.push(path + '.' + k + '=' + val.slice(0, 12));
                else walkJ(val, path + '.' + k, d + 1);
              }
            };
            walkJ(doc, 'doc', 0);
          } catch (e) {}
        }
        scan(f.data, depth + 1);
      }
    };
    scan(bytes, 0);
    return 'jsonStrict=' + strict + ' jsonTrimmed=' + trimmed + ' paths=[' + paths.join(' | ') + ']';
  } catch (e) { return 'paths-error'; }
}

try {
  if (!$response || !($response.body instanceof Uint8Array)) {
    $done({});
  } else {
    const original = new Uint8Array($response.body);
    // JSON-document branch (ported from V1.0.3 transformText/cleanDocument).
    // A JSON top-level document is cleaned here; anything else falls through
    // to the Protobuf path below.
    let handled = false;
    const bodyText = bytesToUtf8(original);
    const firstNonWs = bodyText ? bodyText.replace(/^\s+/, "").charAt(0) : "";
    if (firstNonWs === "{" || firstNonWs === "[") {
      const cleaned = transformText(bodyText);
      if (cleaned.ok) {
        handled = true;
        const removed = Object.keys(cleaned.stats).reduce((sum, key) => sum + cleaned.stats[key], 0);
        if (removed > 0) {
          console.log(`[UmetripAds] json cleaned: ${JSON.stringify(cleaned.stats)}`);
          $done({body: utf8Bytes(cleaned.body)});
        } else {
          $done({});
        }
      }
    }
    if (!handled) {
      const rpid = getRpid(original);
      let result = {bytes: original, count: 0};
      if (EMPTY_RPIDS.has(rpid)) result = replaceTopField7(original, EMPTY_PAYLOAD);
      else {
        const cleaners = {
          '1000002': cleanHomePayload,
          '1000029': cleanWaterfallPayload,
          '1370126': cleanTripBannerPayload,
          '1370279': cleanFamilyMessage,
          '1011058': cleanHistoryPayload,
          '1100001': cleanMinePayload,
          '1060060': cleanFlightPayload
        };
        if (cleaners[rpid]) result = transformTopField7(original, cleaners[rpid]);
        const extra = transformTopField7(result.bytes, bytes => cleanExtraPayload(bytes, rpid === MINE_RPID));
        result = {bytes: extra.bytes, count: result.count + extra.count};
      }
      console.log(`[UmetripAds] rpid=${rpid} len=${original.length} removed=${result.count} ${jsonPathsFingerprint(original)}`);
      if (result.count) {
        $done({body: result.bytes});
      } else $done({});
    }
  }
} catch (error) {
  console.log(`[UmetripAds] error: ${error}`);
  $done({});
}
