// hdhub4u.js - HDHub4U for Nuvio (ported from the CloudStream smali)
// Ported: search, page link collection (movie + series), Hubdrive, Hblinks, HUBCDN, HubCloud.
// Added from the extra smali files: getRedirectLinks / cleanTitle / pen (UtilsKt), PixelDrain + PixelDrainDev,
// VidStack (with a pure-JS AES), the search + Cinemeta data models (Search, RequestParams, TextMatchInfo,
// ResponseDataLocal, VideoLocal). Parts marked [NEW] below.
// NOT in the uploaded files (so reconstructed or skipped): see notes marked [RECONSTRUCTED] / [SKIPPED].
"use strict";

// ====== EDIT IF NEEDED ======
//var MAIN_URL = "https://new1.hdhub4u.free";   // default found in the smali; the live domain changes often
var DOMAINS_URL = "";                         // optional: JSON with {"HDHUB4u":"https://...","hubcloud":"https://..."}
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
// =============================

var TMDB_BASE = "https://api.themoviedb.org/3";
var MAIN_URL = "https://new17.hdhub4u.cl";
var UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
var SITE_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.7",
  "Cookie": "xla=s4t",
  "Sec-GPC": "1",
  "sec-ch-ua-platform": '"Android"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua": '"Not-A.Brand";v="99", "Brave";v="157", "Chromium";v="157"'
};
var SEARCH_API = "https://search.pingora.fyi/collections/post/documents/search?q="; // kept for compatibility; full URL built in searchSiteFull
//var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
//var SITE_HEADERS = { "User-Agent": UA, "Cookie": "xla=s4t" };
var HUBCLOUD_BASE = null;

function log(m) { console.log("[HDHub4U] " + m); }

// =========================================================================
// Mini HTML parser + selector engine (QuickJS has no DOM / jsoup)
// =========================================================================
var VOID = { area:1, base:1, br:1, col:1, embed:1, hr:1, img:1, input:1, link:1, meta:1, param:1, source:1, track:1, wbr:1 };

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(m, e) {
    if (e[0] === "#") {
      var n = (e[1] === "x" || e[1] === "X") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return isNaN(n) ? m : String.fromCodePoint(n);
    }
    var map = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" " };
    return map[e] !== undefined ? map[e] : m;
  });
}

function parseHtml(html) {
  var root = { tag: "#root", attrs: {}, children: [], parent: null };
  var cur = root;
  var re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)|</gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (m[4] !== undefined) { cur.children.push({ text: m[4], parent: cur }); continue; }
    if (!m[2]) continue;
    var tag = m[2].toLowerCase();
    if (m[1] === "/") {
      var n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    var attrs = {};
    var ar = /([^\s=\/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, am;
    while ((am = ar.exec(m[3] || "")) !== null) {
      var v = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ""));
      attrs[am[1].toLowerCase()] = decodeEntities(v);
    }
    var el = { tag: tag, attrs: attrs, children: [], parent: cur };
    cur.children.push(el);
    if (tag === "script" || tag === "style") {
      var end = html.toLowerCase().indexOf("</" + tag, re.lastIndex);
      if (end < 0) end = html.length;
      el.children.push({ text: html.slice(re.lastIndex, end), parent: el, raw: true });
      var close = html.indexOf(">", end);
      re.lastIndex = close < 0 ? html.length : close + 1;
      continue;
    }
    var selfClose = /\/\s*$/.test(m[3] || "");
    if (!VOID[tag] && !selfClose) cur = el;
  }
  return root;
}

function elementChildren(el) { return el.children.filter(function(c) { return c.tag; }); }
function textOf(n) {
  if (n.text !== undefined) return n.raw ? "" : n.text;
  return n.children.map(textOf).join("");
}
function text(el) { return decodeEntities(textOf(el)).replace(/\s+/g, " ").trim(); }
function dataOf(el) { return el.children.map(function(c) { return c.text || ""; }).join(""); }
function attr(el, name) { return (el && el.attrs && el.attrs[name]) || ""; }
function nextElementSibling(el) {
  var sibs = elementChildren(el.parent);
  var i = sibs.indexOf(el);
  return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
}

function splitTop(s, sep) {
  var out = [], depth = 0, q = "", buf = "";
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (q) { buf += c; if (c === q) q = ""; continue; }
    if (c === "'" || c === '"') { q = c; buf += c; continue; }
    if (c === "[") depth++;
    if (c === "]") depth--;
    if (depth === 0 && ((sep === "," && c === ",") || (sep === " " && /\s/.test(c)))) {
      if (buf.trim()) out.push(buf.trim());
      buf = ""; continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseCompound(s) {
  var c = { tag: null, id: null, classes: [], attrs: [] };
  var re = /^([a-zA-Z][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:'([^']*)'|"([^"]*)"|([^\]\s]*)))?\s*\]/g, m;
  while ((m = re.exec(s)) !== null) {
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, val: m[6] !== undefined ? m[6] : (m[7] !== undefined ? m[7] : (m[8] || "")) });
  }
  return c;
}

function compoundMatches(el, c) {
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id && attr(el, "id") !== c.id) return false;
  if (c.classes.length) {
    var have = attr(el, "class").split(/\s+/);
    for (var i = 0; i < c.classes.length; i++) if (have.indexOf(c.classes[i]) < 0) return false;
  }
  for (var j = 0; j < c.attrs.length; j++) {
    var a = c.attrs[j];
    if (!(a.name in el.attrs)) return false;
    var v = el.attrs[a.name];
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "*=" && v.indexOf(a.val) < 0) return false;
    if (a.op === "^=" && v.indexOf(a.val) !== 0) return false;
    if (a.op === "$=" && (v.length < a.val.length || v.slice(v.length - a.val.length) !== a.val)) return false;
  }
  return true;
}

function groupMatches(el, comps) {
  var i = comps.length - 1;
  if (!compoundMatches(el, comps[i])) return false;
  var node = el.parent;
  i--;
  while (i >= 0) {
    while (node && node.tag && !compoundMatches(node, comps[i])) node = node.parent;
    if (!node || !node.tag) return false;
    node = node.parent;
    i--;
  }
  return true;
}

function selectAll(root, selector) {
  var groups = splitTop(selector, ",").map(function(g) { return splitTop(g, " ").map(parseCompound); });
  var out = [];
  (function walk(n) {
    for (var i = 0; i < n.children.length; i++) {
      var ch = n.children[i];
      if (!ch.tag) continue;
      for (var g = 0; g < groups.length; g++) {
        if (groupMatches(ch, groups[g])) { out.push(ch); break; }
      }
      walk(ch);
    }
  })(root);
  return out;
}
function selectFirst(root, selector) { var r = selectAll(root, selector); return r.length ? r[0] : null; }

function absUrl(base, href) {
  href = String(href || "").trim();
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  var m = /^(https?:\/\/[^\/?#]+)([^?#]*)/i.exec(base || "");
  if (!m) return href;
  if (href.indexOf("//") === 0) return base.split(":")[0] + ":" + href;
  if (href[0] === "/") return m[1] + href;
  var dir = m[2].replace(/[^\/]*$/, "");
  return m[1] + (dir || "/") + href;
}

// =========================================================================
// HTTP helpers
// =========================================================================
async function getText(url, headers, extra) {
  var opts = Object.assign({ headers: headers || {} }, extra || {});
  var res = await fetch(url, opts);
  return { res: res, body: await res.text(), status: res.status };
}
async function getDoc(url, headers) {
  var r = await getText(url, headers);
  return parseHtml(r.body);
}
function hostOf(u) { var m = /^(https?:\/\/[^\/?#]+)/i.exec(u || ""); return m ? m[1] : ""; }
function b64decode(s) {
  try { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); }
  catch (e) { return null; }
}
function substringAfter(s, d) { var i = s.indexOf(d); return i < 0 ? s : s.slice(i + d.length); }
function substringAfterLast(s, d) { var i = s.lastIndexOf(d); return i < 0 ? s : s.slice(i + d.length); }
function substringBefore(s, d) { var i = s.indexOf(d); return i < 0 ? s : s.slice(0, i); }

async function loadDomains() {
  if (!DOMAINS_URL) return;
  try {
    var r = await fetch(DOMAINS_URL);
    if (!r.ok) return;
    var d = await r.json();
    var site = d.HDHUB4u || d.hdhub4u || d.HDHub4u;
    if (site) MAIN_URL = String(site).trim().replace(/\/+$/, "");
    var hc = d.hubcloud || d.Hubcloud || d.HubCloud;
    if (hc) HUBCLOUD_BASE = String(hc).trim().replace(/\/+$/, "");
  } catch (e) { log("domains failed: " + e.message); }
}

// =========================================================================
// Extractors
// =========================================================================
function qualityOf(s) {
  var m = /(\d{3,4})\s*[pP]/.exec(s || "");
  if (m) return m[1] + "p";
  if (/4k|2160/i.test(s || "")) return "2160p";
  return "Auto";
}

function pushLink(out, name, title, url, referer, quality, subtitles) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  for (var i = 0; i < out.length; i++) if (out[i].url === url) return;
  out.push({
    name: name,
    title: title,
    url: url,
    quality: quality || "Auto",
    headers: { "User-Agent": UA, "Referer": referer || (hostOf(url) + "/") },
    subtitles: subtitles || []
  });
}

// ExtractorsKt.resolveFinalUrl: follow Location redirects with HEAD
async function resolveFinalUrl(url) {
  var cur = url;
  for (var i = 0; i < 5; i++) {
    var res;
    try { res = await fetch(cur, { method: "HEAD", redirect: "manual", headers: { "User-Agent": UA } }); }
    catch (e) { return cur; }
    if (res.status === 200) return cur;
    if (res.status >= 300 && res.status < 400) {
      var loc = res.headers.get("location");
      if (!loc) return cur;
      cur = absUrl(cur, loc);
    } else return cur;
  }
  return cur;
}

// ---- Hubdrive ----
async function hubdrive(url, referer, out, depth) {
  var doc = await getDoc(url, { "User-Agent": UA });
  var btn = selectFirst(doc, ".btn.btn-primary.btn-user.btn-success1.m-1");
  var href = btn ? attr(btn, "href") : "";
  if (!href.trim()) return;
  href = absUrl(url, href);
  if (/hubcloud/i.test(href)) await hubcloud(href, url, out, depth);
  else await resolveLink(href, url, out, depth + 1);
}

// ---- Hblinks ----
async function hblinks(url, referer, out, depth) {
  var doc = await getDoc(url, { "User-Agent": UA, "Referer": referer || url });
  var links = [];
  selectAll(doc, "h3 a,h5 a,div.entry-content p a,div.entry-content a").forEach(function(a) {
    var h = absUrl(url, attr(a, "href"));
    if (h && links.indexOf(h) < 0) links.push(h);
  });
  await Promise.all(links.map(function(l) {
    return resolveLink(l, url, out, depth + 1).catch(function(e) { log("hblinks link failed: " + e.message); });
  }));
}

// ---- HUBCDN ----
async function hubcdn(url, referer, out, depth) {
  var r = await getText(url, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
  var doc = parseHtml(r.body);
  var scripts = selectAll(doc, "script");
  var data = "";
  for (var i = 0; i < scripts.length; i++) {
    var d = dataOf(scripts[i]);
    if (d.indexOf("var reurl") >= 0) { data = d; break; }
  }
  if (!data) {
    for (var j = 0; j < scripts.length; j++) {
      var d2 = dataOf(scripts[j]);
      if (d2.indexOf("reurl") >= 0) { data = d2; break; }
    }
  }
  var m = /reurl\s*=\s*["']([^"']+)["']/.exec(data);
  var reurl = m ? m[1] : "";
  var final = null;
  if (reurl) {
    if (reurl.indexOf("link=http") >= 0) {
      final = substringAfter(reurl, "link=");
    } else if (reurl.indexOf("?r=") >= 0 || reurl.indexOf("&r=") >= 0) {
      var dec = b64decode(substringBefore(substringAfter(reurl, "r="), "&"));
      if (dec) final = dec.indexOf("link=") >= 0 ? substringAfter(dec, "link=") : dec;
    } else if (reurl.indexOf("link=") >= 0) {
      var v = substringAfter(reurl, "link=");
      final = /^http/i.test(v) ? v : b64decode(v);
    } else {
      final = /^http/i.test(reurl) ? reurl : b64decode(reurl);
    }
    if (!final) {
      var rm = /r=([A-Za-z0-9+\/=]+)/.exec(reurl);
      if (rm && rm[1]) {
        var d3 = b64decode(rm[1]);
        if (d3) final = d3.indexOf("link=") >= 0 ? substringAfterLast(d3, "link=") : d3;
      }
    }
  }
  if (!final) return;
  pushLink(out, "HUBCDN", "HUBCDN", final, url, "Auto");
}

// ---- HubCloud ----
// The page steps are ported from HubCloud.smali. The per-button handler (HubCloud$getUrl$2)
// was not in the upload, so the button handling below is [RECONSTRUCTED] from the known behaviour
// of this extractor (FSL / Download File / BuzzServer / PixelDrain / 10Gbps-S3).
async function hubcloud(url, referer, out, depth) {
  depth = depth || 0;
  if (HUBCLOUD_BASE) url = url.replace(/^https?:\/\/[^\/]+/i, HUBCLOUD_BASE);
  var base = hostOf(url);
  var realUrl = url;
  if (url.indexOf("hubcloud.php") < 0) {
    var d0 = await getDoc(url, { "User-Agent": UA });
    var a0 = selectFirst(d0, "a[href*='hubcloud.php']");
    var h0 = a0 ? attr(a0, "href").trim() : "";
    if (h0) realUrl = /^http/i.test(h0) ? h0 : base + "/" + h0.replace(/^\/+/, "");
  }
  var doc = await getDoc(realUrl, { "User-Agent": UA, "Referer": url });
  var sizeEl = selectFirst(doc, "i#size");
  var size = sizeEl ? text(sizeEl) : "";
  var headEl = selectFirst(doc, "div.card-header");
  var header = headEl ? text(headEl) : "";
  var quality = qualityOf(header);
  var label = "HubCloud" + (size ? " [" + size + "]" : "");
  var buttons = selectAll(doc, "a.btn");
  await Promise.all(buttons.map(async function(b) {
    var link = attr(b, "href").trim();
    var t = text(b);
    if (!link) return;
    link = absUrl(realUrl, link);
    try {
      if (/BuzzServer/i.test(t)) {
        var res = await fetch(link + "/download", { redirect: "manual", headers: { "User-Agent": UA, "Referer": link } });
        var hx = res.headers.get("hx-redirect") || res.headers.get("location");
        if (hx) pushLink(out, "HubCloud", label + " BuzzServer", absUrl(link, hx), link, quality);
      } else if (/pixeldra|PixelServer/i.test(t) || /pixeldrain/i.test(link)) {
        var id = (/\/(?:u|file)\/([A-Za-z0-9]+)/.exec(link) || [])[1];
        var dl = id ? hostOf(link) + "/api/file/" + id + "?download" : link;
        pushLink(out, "HubCloud", label + " PixelDrain", dl, link, quality);
      } else if (/10\s*Gbps|S3 Server/i.test(t)) {
        var cur = link;
        for (var i = 0; i < 6; i++) {
          var r2 = await fetch(cur, { redirect: "manual", headers: { "User-Agent": UA } });
          var loc = r2.headers.get("location");
          if (!loc) break;
          if (loc.indexOf("link=") >= 0) { cur = substringAfter(loc, "link="); break; }
          cur = absUrl(cur, loc);
        }
        pushLink(out, "HubCloud", label + " 10Gbps", cur, link, quality);
      } else if (/FSL|Download File/i.test(t)) {
        pushLink(out, "HubCloud", label + " " + t, link, realUrl, quality);
      } else if (depth < 2) {
        await resolveLink(link, realUrl, out, depth + 1);
      }
    } catch (e) { log("hubcloud button failed (" + t + "): " + e.message); }
  }));
}

// =========================================================================
// [NEW] Ported from the extra smali files
//   UtilsKt (getRedirectLinks, cleanTitle, pen, encode, loadSourceNameExtractor),
//   PixelDrainDev, VidStack, Search / RequestParams / TextMatchInfo / ResponseDataLocal / VideoLocal
// =========================================================================

var QUALITY_HINTS = {};   // link url -> "1080p" taken from the text of the page link

// ---- base64 / UTF-8 / rot13 (UtilsKt.encode + pen) ----
var B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+\/]/g, "");
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    buf = (buf << 6) | B64CHARS.indexOf(s.charAt(i));
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); buf &= (1 << bits) - 1; }
  }
  return out;
}

function utf8Decode(b) {
  var s = "", i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c >= 0xc0 && c < 0xe0 && i < b.length) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) { s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i] & 0x3f) << 6) | (b[i + 1] & 0x3f)); i += 2; }
    else if (c >= 0xf0 && i + 2 < b.length) { s += String.fromCodePoint(((c & 0x07) << 18) | ((b[i] & 0x3f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f)); i += 3; }
    else s += String.fromCharCode(c);
  }
  return s;
}

// CloudStream base64Decode(): base64 text -> UTF-8 string
function base64Decode(s) { return utf8Decode(base64Bytes(s)); }

// UtilsKt.encode(): despite the name it just base64-decodes
function encode(value) { return base64Decode(value); }

// UtilsKt.pen(): ROT13
function pen(value) {
  return String(value).replace(/[A-Za-z]/g, function(ch) {
    var base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode((ch.charCodeAt(0) - base + 13) % 26 + base);
  });
}

// ---- UtilsKt.getRedirectLinks: decode the "?id=" shortener pages ----
async function getRedirectLinks(url) {
  try {
    var r = await getText(url, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
    var re = /s\('o','([A-Za-z0-9+\/=]+)'|ck\('_wp_http_\d+','([^']+)'/g;
    var m, combined = "";
    while ((m = re.exec(r.body)) !== null) {
      var v = m[1] || m[2];
      if (v) combined += v;
    }
    var decoded = base64Decode(pen(base64Decode(base64Decode(combined))));
    var json = JSON.parse(decoded);
    var encodedUrl = base64Decode(String(json.o || "")).trim();
    if (encodedUrl) return encodedUrl;

    // fallback of the original: fetch "<blog_url>?re=<data>" and read the body text
    var data = encode(String(json.data || "")).trim();
    var blog = String(json.blog_url || "").trim();
    var direct = "";
    try {
      var d = await getText((blog + "?re=" + data).trim(), { "User-Agent": UA });
      var body = selectFirst(parseHtml(d.body), "body");
      direct = (body ? text(body) : String(d.body)).trim();
    } catch (e2) { /* runCatching in the original */ }
    return direct;
  } catch (e) {
    log("Error processing links " + e.message);
    return "";
  }
}

// ---- UtilsKt.cleanTitle: "Dune Part Two (2024) Hindi 1080p" -> "Dune Part Two (2024)" ----
function cleanTitle(title) {
  var cleaned = String(title || "").replace(/[^\x20-\x7E\p{L}\p{N}]/gu, " ").trim();
  var base = cleaned.split("(")[0].trim().replace(/\s+/g, " ");
  if (base.length > 0 && base.charAt(0) !== base.charAt(0).toUpperCase()) base = base.charAt(0).toUpperCase() + base.slice(1);
  var sm = /Season\s*\d+/i.exec(cleaned);
  var season = sm ? sm[0].charAt(0).toUpperCase() + sm[0].slice(1) : null;
  var ym = /\b(19|20)\d{2}\b/.exec(cleaned);
  var extras = [];
  if (season) extras.push(season);
  if (ym) extras.push(ym[0]);
  return extras.length ? base + extras.map(function(e) { return " (" + e + ")"; }).join("") : base;
}

// ---- PixelDrain / PixelDrainDev (Extractors.kt) ----
// PixelDrain mainUrl = https://pixeldrain.com, PixelDrainDev mainUrl = https://pixeldrain.dev
function pixelDrainDownloadUrl(url) {
  var host = hostOf(url);
  var mainUrl = /pixeldrain\.dev/i.test(host) ? "https://pixeldrain.dev"
              : (/pixeldrain\./i.test(host) ? host : "https://pixeldrain.com");
  if (/download/.test(url)) return url;                       // already a direct download url
  var clean = String(url).split("#")[0].split("?")[0];
  var m = /\/([^\/]+)$/.exec(clean);
  var id = m ? m[1] : "";
  if (!id) return url;
  return mainUrl + "/api/file/" + id + "?download";
}

function pixelDrain(url, referer, out) {
  pushLink(out, "PixelDrain", "PixelDrain", pixelDrainDownloadUrl(url), url, "Auto");
}

// ---- pure-JS AES (decrypt only, 128/192/256, CBC + PKCS7) for VidStack ----
// [RECONSTRUCTED] AesHelper.decryptAES was not in the upload: hex ciphertext, UTF-8 key and IV, AES/CBC/PKCS5.
var AES_TABLES = null;

function aesTables() {
  if (AES_TABLES) return AES_TABLES;
  var sbox = new Array(256), inv = new Array(256);
  var p = 1, q = 1;
  function rotl8(x, s) { return ((x << s) | (x >> (8 - s))) & 0xff; }
  do {
    p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0)) & 0xff;
    q = (q ^ (q << 1)) & 0xff;
    q = (q ^ (q << 2)) & 0xff;
    q = (q ^ (q << 4)) & 0xff;
    if (q & 0x80) q ^= 0x09;
    var x = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
    sbox[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  sbox[0] = 0x63;
  for (var i = 0; i < 256; i++) inv[sbox[i]] = i;
  AES_TABLES = { sbox: sbox, inv: inv };
  return AES_TABLES;
}

function aesExpandKey(key) {
  var t = aesTables();
  var nk = key.length / 4, nr = nk + 6;
  var w = [];
  for (var i = 0; i < nk; i++) w.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
  var rcon = 1;
  for (i = nk; i < 4 * (nr + 1); i++) {
    var tmp = w[i - 1].slice();
    if (i % nk === 0) {
      tmp = [t.sbox[tmp[1]] ^ rcon, t.sbox[tmp[2]], t.sbox[tmp[3]], t.sbox[tmp[0]]];
      rcon = ((rcon << 1) ^ ((rcon & 0x80) ? 0x11b : 0)) & 0xff;
    } else if (nk > 6 && i % nk === 4) {
      tmp = [t.sbox[tmp[0]], t.sbox[tmp[1]], t.sbox[tmp[2]], t.sbox[tmp[3]]];
    }
    w.push([w[i - nk][0] ^ tmp[0], w[i - nk][1] ^ tmp[1], w[i - nk][2] ^ tmp[2], w[i - nk][3] ^ tmp[3]]);
  }
  return { w: w, nr: nr };
}

function gmul(a, b) {
  var r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = ((a << 1) ^ ((a & 0x80) ? 0x11b : 0)) & 0xff;
    b >>= 1;
  }
  return r;
}

function aesDecryptBlock(block, ks) {
  var t = aesTables(), w = ks.w, nr = ks.nr;
  var s = block.slice();
  function addKey(round) {
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) s[4 * c + r] ^= w[round * 4 + c][r];
  }
  function invShiftSub() {
    var n = new Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) n[4 * ((c + r) % 4) + r] = t.inv[s[4 * c + r]];
    s = n;
  }
  function invMix() {
    for (var c = 0; c < 4; c++) {
      var a0 = s[4 * c], a1 = s[4 * c + 1], a2 = s[4 * c + 2], a3 = s[4 * c + 3];
      s[4 * c]     = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
      s[4 * c + 1] = gmul(a0, 9)  ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
      s[4 * c + 2] = gmul(a0, 13) ^ gmul(a1, 9)  ^ gmul(a2, 14) ^ gmul(a3, 11);
      s[4 * c + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9)  ^ gmul(a3, 14);
    }
  }
  addKey(nr);
  for (var round = nr - 1; round >= 1; round--) { invShiftSub(); addKey(round); invMix(); }
  invShiftSub();
  addKey(0);
  return s;
}

function strBytes(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);   // key/iv are ASCII
  return out;
}

function hexBytes(h) {
  h = String(h || "").replace(/\s+/g, "");
  if (!h || h.length % 2 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  var out = [];
  for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
}

// -> decrypted UTF-8 string, or null when the data / padding is not valid
function aesCbcDecrypt(cipherText, keyStr, ivStr) {
  try {
    var data = hexBytes(cipherText) || base64Bytes(cipherText);
    var key = strBytes(keyStr), iv = strBytes(ivStr);
    if (!data.length || data.length % 16 || iv.length !== 16 || [16, 24, 32].indexOf(key.length) < 0) return null;
    var ks = aesExpandKey(key);
    var out = [], prev = iv;
    for (var i = 0; i < data.length; i += 16) {
      var blk = data.slice(i, i + 16);
      var dec = aesDecryptBlock(blk, ks);
      for (var j = 0; j < 16; j++) out.push(dec[j] ^ prev[j]);
      prev = blk;
    }
    var pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (var k = 1; k <= pad; k++) if (out[out.length - k] !== pad) return null;
    return utf8Decode(out.slice(0, out.length - pad));
  } catch (e) { return null; }
}

// ---- VidStack (Extractors.kt) : hubstream / hdstream4u embeds ----
var VIDSTACK_KEY = "kiemtienmua911ca";
var VIDSTACK_IVS = ["1234567890oiuytr", "0123456789abcdef"];
var VIDSTACK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0";

function vidstackBaseUrl(url, fallback) {
  var m = /^(https?):\/\/([^\/?#:]+)/i.exec(url || "");
  return m ? m[1].toLowerCase() + "://" + m[2] : fallback;     // protocol://host (no port), like ktor
}

async function vidstack(url, referer, out, opts) {
  opts = opts || {};
  var name = opts.name || "Vidstack";
  var mainUrl = opts.mainUrl || "https://vidstack.io";

  var hash = substringAfter(substringAfterLast(url, "#"), "/");
  var base = vidstackBaseUrl(url, mainUrl);
  var r = await getText(base + "/api/v1/video?id=" + hash, { "User-Agent": VIDSTACK_UA });
  var encoded = r.body.trim();

  // The original takes the first IV that decrypts. A wrong IV only garbles the first 16 bytes, so
  // prefer the IV whose plaintext really contains "source" and fall back to the first one that decrypts.
  var plain = null, firstOk = null;
  for (var i = 0; i < VIDSTACK_IVS.length; i++) {
    var p = aesCbcDecrypt(encoded, VIDSTACK_KEY, VIDSTACK_IVS[i]);
    if (p === null) continue;
    if (firstOk === null) firstOk = p;
    if (/"source"\s*:/.test(p)) { plain = p; break; }
  }
  if (plain === null) plain = firstOk;
  if (plain === null) throw new Error("Failed to decrypt with all IVs");

  var sm = /"source":"(.*?)"/.exec(plain);
  var m3u8 = sm ? sm[1].replace(/\\\//g, "/") : "";

  var subs = [];
  var sec = /"subtitle":\{(.*?)\}/.exec(plain);
  if (sec) {
    var pr = /"([^"]+)":\s*"([^"]+)"/g, mm;
    while ((mm = pr.exec(sec[1])) !== null) {
      var rawPath = mm[2].split("#")[0];
      if (rawPath.length > 0) {
        // the original builds mainUrl + path; the embed's own host is the right base for hubstream / hdstream4u
        subs.push({ language: mm[1], url: absUrl(base, rawPath.replace(/\\\//g, "/")) });
      }
    }
  }
  if (!m3u8) { log("vidstack: no source in the decrypted data"); return; }

  // the original sends the link with https -> http; keep that first and the untouched https url as a backup
  var asHttp = m3u8.replace(/https/g, "http");
  pushLink(out, name, name, asHttp, url, "Auto", subs);
  if (asHttp !== m3u8) pushLink(out, name, name + " (https)", m3u8, url, "Auto", subs);
}

// ---- data models: Search / RequestParams / TextMatchInfo (typesense search api) ----
function pickField(o, snake, camel, def) {
  if (!o) return def;
  if (o[snake] !== undefined && o[snake] !== null) return o[snake];
  if (o[camel] !== undefined && o[camel] !== null) return o[camel];
  return def;
}
function toNum(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

function parseTextMatchInfo(j) {
  return {
    bestFieldScore: String(pickField(j, "best_field_score", "bestFieldScore", "")),
    bestFieldWeight: toNum(pickField(j, "best_field_weight", "bestFieldWeight", 0)),
    fieldsMatched: toNum(pickField(j, "fields_matched", "fieldsMatched", 0)),
    numTokensDropped: toNum(pickField(j, "num_tokens_dropped", "numTokensDropped", 0)),
    score: String(pickField(j, "score", "score", "")),
    tokensMatched: toNum(pickField(j, "tokens_matched", "tokensMatched", 0)),
    typoPrefixScore: toNum(pickField(j, "typo_prefix_score", "typoPrefixScore", 0))
  };
}

function parseRequestParams(j) {
  return {
    collectionName: String(pickField(j, "collection_name", "collectionName", "")),
    firstQ: String(pickField(j, "first_q", "firstQ", "")),
    perPage: toNum(pickField(j, "per_page", "perPage", 0)),
    q: String(pickField(j, "q", "q", ""))
  };
}

// [RECONSTRUCTED] the Hit class was not uploaded: document + text match info, as the typesense api returns it
function parseHit(h) {
  var d = (h && h.document) || {};
  return {
    document: d,
    highlights: (h && (h.highlights || h.highlight)) || [],
    textMatch: toNum(pickField(h, "text_match", "textMatch", 0)),
    textMatchInfo: parseTextMatchInfo(pickField(h, "text_match_info", "textMatchInfo", {})),
    title: d.post_title || d.postTitle || "",
    permalink: d.permalink || "",
    category: d.category
  };
}

function parseSearch(j) {
  j = j || {};
  return {
    facetCounts: pickField(j, "facet_counts", "facetCounts", []),
    found: toNum(j.found),
    hits: (j.hits || []).map(parseHit),
    outOf: toNum(pickField(j, "out_of", "outOf", 0)),
    page: toNum(j.page),
    requestParams: parseRequestParams(pickField(j, "request_params", "requestParams", {})),
    searchCutoff: !!pickField(j, "search_cutoff", "searchCutoff", false),
    searchTimeMs: toNum(pickField(j, "search_time_ms", "searchTimeMs", 0))
  };
}

// ---- data models: ResponseDataLocal / VideoLocal (Cinemeta episode metadata) ----
function intOrNull(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }

function parseVideoLocal(v) {
  v = v || {};
  var rating = v.rating !== undefined && v.rating !== null && v.rating !== "" ? Number(v.rating) : null;
  return {
    title: v.title || v.name || "",
    season: intOrNull(v.season),
    episode: intOrNull(v.episode !== undefined ? v.episode : v.number),
    overview: v.overview || v.description || "",
    thumbnail: v.thumbnail || "",
    released: v.released || "",
    rating: rating !== null && !isNaN(rating) ? rating : null
  };
}

// [RECONSTRUCTED] MetaLocal was not uploaded: only the videos list is used
function parseResponseDataLocal(j) {
  var m = (j && j.meta) || {};
  return { meta: { id: m.id || "", imdbId: m.imdb_id || m.imdbId || "", name: m.name || "", videos: (m.videos || []).map(parseVideoLocal) } };
}

async function getImdbId(tmdbId, mediaType) {
  try {
    var ep = mediaType === "movie" ? "movie" : "tv";
    var res = await fetch(TMDB_BASE + "/" + ep + "/" + tmdbId + "/external_ids?api_key=" + TMDB_API_KEY);
    if (!res.ok) return null;
    var d = await res.json();
    return d.imdb_id || null;
  } catch (e) { return null; }
}

// episode title for the stream label (never blocks or breaks the main flow)
async function getEpisodeMeta(tmdbId, season, episode) {
  try {
    var imdb = await getImdbId(tmdbId, "tv");
    if (!imdb) return null;
    var res = await fetch("https://v3-cinemeta.strem.io/meta/series/" + imdb + ".json");
    if (!res.ok) return null;
    var data = parseResponseDataLocal(await res.json());
    for (var i = 0; i < data.meta.videos.length; i++) {
      var v = data.meta.videos[i];
      if (v.season === season && v.episode === episode) return v;
    }
  } catch (e) { log("cinemeta failed: " + e.message); }
  return null;
}

// ---- UtilsKt.loadSourceNameExtractor ----
// [RECONSTRUCTED] the lambda class was not uploaded. It runs the matching extractor and re-labels what comes out:
// optional source prefix, and the quality of the page link when the extractor itself could not tell ("Auto").
async function loadSourceNameExtractor(source, url, referer, quality, out, depth) {
  var tmp = [];
  await resolveLink(url, referer, tmp, depth || 0);
  tmp.forEach(function(l) {
    if (source) l.name = source + " [" + l.name + "]";
    if (quality && (!l.quality || l.quality === "Auto")) l.quality = quality;
    for (var i = 0; i < out.length; i++) if (out[i].url === l.url) return;
    out.push(l);
  });
}

// ---- Router (CloudStream loadExtractor equivalent for the hosts above) ----
async function resolveLink(url, referer, out, depth) {
  depth = depth || 0;
  if (depth > 3 || !url) return;
  var u = url.toLowerCase();

  // [NEW] HDHub4U shortener pages ("?id="): decode the real link first (UtilsKt.getRedirectLinks)
  if (u.indexOf("?id=") >= 0) {
    var real = await getRedirectLinks(url);
    if (real && real !== url && /^https?:\/\//i.test(real)) return resolveLink(real, url, out, depth + 1);
    log("redirect page gave no link: " + url);
  }

  if (/hubcloud\./.test(u)) return hubcloud(url, referer, out, depth);
  if (/hubdrive\./.test(u)) return hubdrive(url, referer, out, depth);
  if (/hblinks\./.test(u)) return hblinks(url, referer, out, depth);
  if (/hubcdn\./.test(u)) return hubcdn(url, referer, out, depth);
  if (/pixeldrain\./.test(u)) return pixelDrain(url, referer, out);        // [NEW] PixelDrain + PixelDrainDev
  // [NEW] hdstream4u / hubstream embeds are VidStack players
  if (/hdstream4u|hubstream|vidstack/.test(u)) {
    var nm = /hdstream4u/.test(u) ? "Hdstream4u" : (/hubstream/.test(u) ? "Hubstream" : "Vidstack");
    return vidstack(url, referer, out, { name: nm });
  }
  // [SKIPPED] StreamTape and VidHidePro: CloudStream built-ins, not part of the uploaded files.
  log("no extractor for " + url);
}

// =========================================================================
// Site: search + page links
// =========================================================================
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

// [NEW] uses the Search / RequestParams / TextMatchInfo models ported from the smali
async function searchSiteFull(query, page) {
  var today = new Date().toISOString().slice(0, 10);
  var url =
    "https://search.pingora.fyi/collections/post/documents/search?q=" +
    encodeURIComponent(query) +
    "&query_by=post_title%2Ccategory%2Cstars%2Cdirector%2Cimdb_id" +
    "&query_by_weights=4%2C2%2C2%2C2%2C4" +
    "&sort_by=sort_by_date%3Adesc" +
    "&limit=15" +
    "&highlight_fields=none" +
    "&use_cache=true" +
    "&page=" + (page || 1) +
    "&analytics_tag=" + today;

  var res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "*/*",
      "Origin": MAIN_URL,
      "Referer": MAIN_URL + "/",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      "Accept-Language": "en-GB,en;q=0.7",
      "Sec-GPC": "1",
      "sec-ch-ua-platform": '"Android"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua": '"Not-A.Brand";v="99", "Brave";v="157", "Chromium";v="157"'
    }
  });
  if (!res.ok) throw new Error("Search HTTP " + res.status);
  var search = parseSearch(await res.json());
  var results = search.hits.map(function(h) {
    return {
      title: h.title,
      permalink: h.permalink,
      category: h.category,
      tmScore: Number(h.textMatchInfo.score) || 0
    };
  }).filter(function(r) { return r.permalink; });
  return { search: search, results: results };
}

async function searchSite(query, page) {
  return (await searchSiteFull(query, page)).results;
}

function pickResult(results, title, year, isMovie, season) {
  var nt = norm(title);
  var best = null, bestScore = -1;
  results.forEach(function(r) {
    var t = norm(r.title);
    var score = 0;
    if (t.indexOf(nt) === 0) score += 50; else if (t.indexOf(nt) >= 0) score += 30; else return;
    if (isMovie) {
      if (year && t.indexOf(year) >= 0) score += 40;
      if (/\bseason\b/.test(t)) score -= 30;
    } else {
      var sm = /\bseason (\d+)\b/.exec(t);
      if (sm) { if (parseInt(sm[1], 10) === season) score += 40; else score -= 40; }
      else score += 5;
    }
    score -= Math.min(20, Math.max(0, t.length - nt.length) / 10);
    if (score > bestScore || (score === bestScore && best && (r.tmScore || 0) > (best.tmScore || 0))) { bestScore = score; best = r; }
  });
  return best;
}

var HOST_RE = /(hdstream4u|hubstream|vidstack|pixeldrain|hubcloud|hubdrive|hubcdn|hblinks|greenmotors)/i;
var QUALITY_RE = /(480|720|1080|2160|4K|watch|player|download)/i;

function badLink(h) {
  return /telegram|t\.me|catimages/i.test(h);
}

function movieLinks(doc, pageUrl) {
  var links = [];
  selectAll(doc, ".page-body h3 a, .page-body h4 a, .page-body p a, .page-body div a").forEach(function(a) {
    var href = attr(a, "href").trim();
    var t = text(a);
    if (!href || href[0] === "#" || badLink(href) || /how-to-download/i.test(href)) return;
    if (href.indexOf("?id=") >= 0 || HOST_RE.test(href) || QUALITY_RE.test(t)) {
      href = absUrl(pageUrl, href);
      if (/\d{3,4}\s*p|4k|2160/i.test(t)) QUALITY_HINTS[href] = qualityOf(t);   // [NEW] used by loadSourceNameExtractor
      if (links.indexOf(href) < 0) links.push(href);
    }
  });
  return links;
}

async function seriesLinks(doc, pageUrl, episode) {
  var epRe = /EPiSODE\s*(\d+)/i;
  var map = {};
  selectAll(doc, "h3, h4").forEach(function(h) {
    var m = epRe.exec(text(h));
    if (!m) return;
    var ep = parseInt(m[1], 10);
    var found = [];
    var add = function(el) {
      selectAll(el, "a[href]").forEach(function(a) {
        var href = attr(a, "href").trim();
        if (!href || badLink(href)) return;
        found.push(absUrl(pageUrl, href));
      });
    };
    add(h);
    if (h.tag === "a") found.push(absUrl(pageUrl, attr(h, "href")));
    var sib = nextElementSibling(h);
    while (sib && sib.tag !== "hr" && !epRe.test(text(sib))) { add(sib); sib = nextElementSibling(sib); }
    if (!map[ep]) map[ep] = [];
    found.forEach(function(l) { if (map[ep].indexOf(l) < 0) map[ep].push(l); });
  });
  if (map[episode] && map[episode].length) return map[episode];

  // Fallback: quality "pack" links -> page with "Episode N" h5 links
  var out = [];
  var packs = selectAll(doc, "h3 a, h4 a").filter(function(a) { return /1080|720|4K|2160/i.test(text(a)); });
  await Promise.all(packs.map(async function(p) {
    var href = absUrl(pageUrl, attr(p, "href"));
    if (!href) return;
    try {
      var d = await getDoc(href, SITE_HEADERS);
      selectAll(d, "h5 a").forEach(function(a) {
        var m = /Episode\s*(\d+)/i.exec(text(a));
        var h = attr(a, "href").trim();
        if (m && h && parseInt(m[1], 10) === episode) out.push(absUrl(href, h));
      });
    } catch (e) { log("pack failed: " + e.message); }
  }));
  return out;
}

// =========================================================================
// TMDB + main
// =========================================================================
async function getTmdbInfo(tmdbId, mediaType) {
  var ep = mediaType === "movie" ? "movie" : "tv";
  var res = await fetch(TMDB_BASE + "/" + ep + "/" + tmdbId + "?api_key=" + TMDB_API_KEY);
  if (!res.ok) throw new Error("TMDB HTTP " + res.status);
  var d = await res.json();
  var title = d.title || d.name;
  var date = d.release_date || d.first_air_date || "";
  return { title: title, year: date.substring(0, 4) };
}

async function getStreams(tmdbId, mediaType, season, episode) {
  await loadDomains();
  var info = await getTmdbInfo(tmdbId, mediaType);
  var isMovie = mediaType === "movie";
  log("TMDB: \"" + info.title + "\" (" + info.year + ") " + (isMovie ? "Movie" : "S" + season + "E" + episode));

  // [NEW] episode title from Cinemeta (VideoLocal), fetched in parallel, never blocks the result
  var metaPromise = isMovie ? Promise.resolve(null) : getEpisodeMeta(tmdbId, parseInt(season, 10), parseInt(episode, 10));

  var first = await searchSiteFull(info.title, 1);
  var results = first.results;
  if (!results.length) {
    first = await searchSiteFull(info.title.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim(), 1);
    results = first.results;
  }
  var picked = pickResult(results, info.title, info.year, isMovie, season);

  // [NEW] nothing good on page 1 but the index has more hits (Search.found / RequestParams.perPage)
  var perPage = first.search.requestParams.perPage || results.length || 15;
  for (var pg = 2; !picked && pg <= 3 && first.search.found > (pg - 1) * perPage; pg++) {
    try {
      var more = await searchSiteFull(info.title, pg);
      results = results.concat(more.results);
      picked = pickResult(results, info.title, info.year, isMovie, season);
    } catch (e) { log("search page " + pg + " failed: " + e.message); break; }
  }

  if (!picked) throw new Error("No match on HDHub4U for \"" + info.title + "\"");
  var pageUrl = picked.permalink.replace(/^https?:\/\/[^\/]+/i, MAIN_URL);
  log("Selected: " + cleanTitle(picked.title) + " -> " + pageUrl);

  var doc = await getDoc(pageUrl, SITE_HEADERS);
  var links = isMovie ? movieLinks(doc, pageUrl) : await seriesLinks(doc, pageUrl, episode);
  log("Found " + links.length + " links");
  if (!links.length) throw new Error("No download links on page");

  var out = [];
  await Promise.all(links.map(function(l) {
    return loadSourceNameExtractor("", l, pageUrl, QUALITY_HINTS[l] || null, out, 0).catch(function(e) { log("link failed: " + e.message); });
  }));
  if (!out.length) throw new Error("No playable links extracted");

  // [NEW] label the streams with the episode title when Cinemeta knows it
  var meta = await metaPromise;
  if (meta && meta.title) {
    var tag = "S" + (season < 10 ? "0" : "") + season + "E" + (episode < 10 ? "0" : "") + episode + " " + meta.title;
    out.forEach(function(s) { s.title = tag + " | " + s.title; });
  }

  var rank = function(q) { return parseInt(q, 10) || 0; };
  out.sort(function(a, b) { return rank(b.quality) - rank(a.quality); });
  return out;
}

module.exports = {
  getStreams: getStreams,
  // used only by the offline tests
  _internals: {
    getRedirectLinks: getRedirectLinks, cleanTitle: cleanTitle, pen: pen, base64Decode: base64Decode,
    pixelDrainDownloadUrl: pixelDrainDownloadUrl, vidstack: vidstack, aesCbcDecrypt: aesCbcDecrypt,
    parseSearch: parseSearch, parseResponseDataLocal: parseResponseDataLocal,
    resolveLink: resolveLink, loadSourceNameExtractor: loadSourceNameExtractor, pickResult: pickResult
  }
};
