/**
 * moviebox - ported from APK v4.0.02.0831.03 (50020126)
 * Termux-tested flow:
 *   token (v3) → search (v3) → subject-get (v4) → dub-paths → play (v4)
 *   → extractPolicyResource → buildDashUrl
 */

var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => new Promise((resolve, reject) => {
  var fulfilled = (v) => { try { step(generator.next(v)); } catch (e) { reject(e); } };
  var rejected  = (v) => { try { step(generator.throw(v)); } catch (e) { reject(e); } };
  var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
  step((generator = generator.apply(__this, __arguments)).next());
});

// ================= constants =================
var API_BASE        = "https://api3.aoneroom.com";
var API_BASE_TOKEN  = "https://apig.inmoviebox.com";
var API_BASE_DETAIL = "https://movie-box.co";

var KEY_B64_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
var KEY_B64_ALT     = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";
var TMDB_API_KEY    = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL   = "https://api.themoviedb.org/3";

var BRAND_MODELS = {
  "Samsung": ["SM-S918B", "SM-A528B", "SM-M336B"],
  "Xiaomi":  ["2201117TI", "M2012K11AI", "Redmi Note 11"],
  "OnePlus": ["LE2111", "CPH2449", "IN2023"],
  "Google":  ["Pixel 6", "Pixel 7", "Pixel 8"],
  "Realme":  ["RMX3085", "RMX3360", "RMX3551"]
};

// v3 (search / token) — matches Smali fetchAnonymousToken & search
var V3 = {
  name: "3.0.03.0529.03", code: 50020042,
  ua: "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)",
  os: "16", gaid: "d7578036d13336cc", brand: "google", model: "sdk_gphone64_x86_64", install_store: "ps"
};
// v4 (subject-get / play / captions) — matches Smali loadLinks
var V4 = {
  name: "4.0.02.0831.03", code: 50020126,
  ua: "com.community.mbox.in/50020126 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)",
  os: "14", gaid: "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d", brand: "Google", model: "Pixel 8",
  install_ch: "official", install_store: "official"
};
var PLAY_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

var DECOY_HASH = "b164fbfb4347792950bdfbfb563d39d9";
var DECOY_PATH = "/other/2026/09/04/";

// ================= crypto =================
var CryptoJS = __toESM(require("crypto-js")).default;
var SECRET_KEY_DEFAULT = CryptoJS.enc.Base64.parse(
  CryptoJS.enc.Base64.parse(KEY_B64_DEFAULT).toString(CryptoJS.enc.Utf8)
);
var SECRET_KEY_ALT = CryptoJS.enc.Base64.parse(
  CryptoJS.enc.Base64.parse(KEY_B64_ALT).toString(CryptoJS.enc.Utf8)
);

// ================= session =================
var deviceId = "";
var bearerToken = null;
var selectedBrand = "", selectedModel = "";

function initSession() {
  if (deviceId) return;
  const chars = "0123456789abcdef";
  for (let i = 0; i < 32; i++) deviceId += chars[Math.floor(Math.random() * 16)];
  const brands = Object.keys(BRAND_MODELS);
  selectedBrand = brands[Math.floor(Math.random() * brands.length)];
  selectedModel = BRAND_MODELS[selectedBrand][Math.floor(Math.random() * BRAND_MODELS[selectedBrand].length)];
}

// ================= crypto helpers =================
function md5(s) { return CryptoJS.MD5(s).toString(CryptoJS.enc.Hex); }
function hmacMd5(key, data) { return CryptoJS.HmacMD5(data, key).toString(CryptoJS.enc.Base64); }
function b64urlDecode(s) {
  let b = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  return CryptoJS.enc.Base64.parse(b);
}
function xClientToken(ts) { return `${ts},${md5(String(ts).split("").reverse().join(""))}`; }

function buildCanonical(method, accept, ctype, url, body, ts) {
  let path = "", query = "";
  try {
    const u = new URL(url);
    path = u.pathname;
    const keys = Array.from(u.searchParams.keys()).sort();
    query = keys.map(k => u.searchParams.getAll(k).map(v => `${k}=${v}`).join("&")).join("&");
  } catch {
    const [p, q] = url.split("?");
    path = p.replace(/https?:\/\/[^/]+/, "");
    query = q ? q.split("&").sort().join("&") : "";
  }
  const canonicalUrl = query ? `${path}?${query}` : path;
  let bodyHash = "", bodyLen = "";
  if (body && body.length) {
    const w = CryptoJS.enc.Utf8.parse(body);
    bodyLen = w.sigBytes.toString();
    bodyHash = CryptoJS.MD5(w).toString(CryptoJS.enc.Hex);
  }
  return `${method.toUpperCase()}\n${accept || ""}\n${ctype || ""}\n${bodyLen}\n${ts}\n${bodyHash}\n${canonicalUrl}`;
}
function xtrSig(method, accept, ctype, url, body, alt = false, tsOverride = null) {
  const ts = tsOverride || Date.now();
  const canonical = buildCanonical(method, accept, ctype, url, body, ts);
  const secret = alt ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  return `${ts}|2|${hmacMd5(secret, canonical)}`;
}

// ================= client-info =================
function clientInfoV3() {
  return JSON.stringify({
    package_name: "com.community.mbox.in", version_name: V3.name, version_code: V3.code,
    os: "android", os_version: V3.os, device_id: deviceId, install_store: V3.install_store,
    gaid: V3.gaid, brand: selectedBrand.toLowerCase(), model: selectedModel,
    system_language: "en", net: "NETWORK_WIFI", region: "IN",
    timezone: "Asia/Calcutta", sp_code: ""
  });
}
function clientInfoV4() {
  return JSON.stringify({
    package_name: "com.community.mbox.in", version_name: V4.name, version_code: V4.code,
    os: "android", os_version: V4.os, install_ch: V4.install_ch, device_id: deviceId,
    install_store: V4.install_store, gaid: V4.gaid, brand: V4.brand, model: V4.model,
    system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta",
    sp_code: "", "X-Play-Mode": "1", "X-Idle-Data": "1",
    "X-Family-Mode": "0", "X-Content-Mode": "0"
  });
}

// ================= token =================
function isTokenValid(t) {
  try {
    const parts = String(t).split(".");
    if (parts.length < 2) return false;
    let b = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const json = CryptoJS.enc.Base64.parse(b).toString(CryptoJS.enc.Utf8);
    return (JSON.parse(json).exp || 0) > Date.now() / 1000 + 3600;
  } catch { return false; }
}
function getToken(force = false) {
  return __async(this, null, function* () {
    if (!force && isTokenValid(bearerToken)) return bearerToken;
    const url = `${API_BASE_TOKEN}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
    const r = yield request("GET", url, null, {}, true, "v3");
    if (r && r.headers) {
      const xUser = r.headers.get("x-user");
      if (xUser) {
        try {
          const j = JSON.parse(xUser);
          if (j.token && isTokenValid(j.token)) { bearerToken = j.token; return j.token; }
        } catch {}
      }
    }
    return bearerToken || "";
  });
}

// ================= request =================
function request(method, url, body = null, extra = {}, isTokenFetch = false, mode = "v3") {
  return __async(this, null, function* () {
    initSession();

    // SAFETY: headers object in body slot → swap
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      extra = Object.assign({}, body, extra);
      body = null;
    }
    if (method === "GET" || method === "HEAD") body = null;

    const ts = Date.now();
    const ctype = extra["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = extra["Accept"] || "application/json";
    const isV4 = mode === "v4";
    const headers = Object.assign({
      "Accept": accept,
      "Content-Type": ctype,
      "x-client-token": xClientToken(ts),
      "x-tr-signature": xtrSig(method, accept, ctype, url, body, false, ts),
      "User-Agent": isV4 ? V4.ua : V3.ua,
      "x-client-info": isV4 ? clientInfoV4() : clientInfoV3(),
      "x-client-status": "0"
    }, extra);
    if (!isTokenFetch) {
      const t = yield getToken();
      if (t) headers["Authorization"] = `Bearer ${t}`;
    }

    const opts = { method, headers };
    if (body) opts.body = body;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = yield fetch(url, opts);
        if (!res.ok) {
          if ((res.status === 401 || res.status === 403 || res.status === 429) && attempt === 0) {
            bearerToken = null;
            continue;
          }
          return null;
        }
        const text = yield res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const xUser = res.headers.get("x-user");
        if (xUser) {
          try { const j = JSON.parse(xUser); if (j.token && isTokenValid(j.token)) bearerToken = j.token; } catch {}
        }
        return { status: res.status, data: parsed, headers: res.headers };
      } catch (e) {
        if (attempt === 1) { console.error("[MovieBox Request Error]", e.message); return null; }
        yield new Promise(r => setTimeout(r, 1000));
      }
    }
    return null;
  });
}

// ================= TMDB =================
function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, { headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "application/json", "Connection": "keep-alive"
      }});
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) === null || _a === void 0 ? void 0 : _a.imdb_id,
        originalTitle: data.original_title || data.original_name
      };
    } catch (e) { console.error("[MovieBox TMDB Error]", e.message); return null; }
  });
}

// ================= helpers =================
function normalizeTitle(s) {
  if (!s) return "";
  return s.replace(/\[.*?\]/g, " ").replace(/\(.*?\|/g, " ")
    .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ")
    .trim().toLowerCase().replace(/:/g, " ")
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
}
function parseQualityNumber(value) {
  const m = String(value || "").match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 0;
}
function getFormatType(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes(".mpd")) return "DASH";
  if (u.includes(".m3u8")) return "HLS";
  if (u.includes(".mp4")) return "MP4";
  if (u.includes(".mkv")) return "MKV";
  return "VIDEO";
}
function isDecoyUrl(url) {
  if (!url) return true;
  const u = String(url).toLowerCase();
  return u.includes(DECOY_HASH) || u.includes(DECOY_PATH);
}

// ================= cookie → resource =================
function extractPolicyResource(signCookie) {
  if (!signCookie) return null;
  try {
    let s = String(signCookie).trim();
    if (s.startsWith("{")) {
      try {
        const root = JSON.parse(s);
        const streams = (root.data && root.data.streams) || root.streams;
        let sc = Array.isArray(streams) && streams[0] && streams[0].signCookie;
        if (!sc && root.signCookie) sc = root.signCookie;
        if (!sc) return null;
        s = String(sc);
      } catch {}
    }

    // Branch 1: urlprefix=… (raw URL or base64url-encoded URL)
    const up = s.match(/urlprefix=([^:;\s]+)/);
    if (up && up[1]) {
      const raw = up[1].replace(/^["'\s]+|["'\s]+$/g, "");
      if (/^https?:\/\//i.test(raw)) return raw;
      try {
        const dec = b64urlDecode(raw).toString(CryptoJS.enc.Utf8);
        if (/^https?:\/\//i.test(dec)) return dec;
      } catch {}
    }

    // Branch 2: (CloudFront-)?Policy=
    const pm = s.match(/(?:CloudFront-)?Policy=([^;]+)/);
    if (!pm) return null;
    const dec = b64urlDecode(pm[1]).toString(CryptoJS.enc.Utf8);
    const json = JSON.parse(dec);
    return (json.Statement && json.Statement[0] && json.Statement[0].Resource) || null;
  } catch { return null; }
}
function buildDashUrl(resource, quality) {
  if (!resource) return null;
  // strip trailing /* and any trailing slashes (urlprefix often ends with '/')
  let u = String(resource).replace(/\/\*$/, "").replace(/\/+$/, "");
  if (quality) u = u.replace(/_(\d+)_(h26\d|hevc|h264|avc)(_\d+)?$/, `_${quality}_$2$3`);
  return `${u}/index.mpd`;
}

// ================= dub paths =================
function fetchDubDetailPaths(detailPath) {
  return __async(this, null, function* () {
    try {
      const url = `${API_BASE_DETAIL}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`;
      const res = yield fetch(url, { headers: {
        "Accept": "application/json",
        "Origin": "https://movie-box.co",
        "Referer": "https://mzfi.me/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}"
      }});
      if (!res.ok) return {};
      const root = yield res.json();
      const dubs = root && root.data && root.data.subject ? root.data.subject.dubs : null;
      const map = {};
      if (Array.isArray(dubs)) for (const d of dubs) {
        if (d && d.subjectId && d.detailPath && String(d.detailPath).trim()) {
          map[String(d.subjectId)] = d.detailPath;
        }
      }
      return map;
    } catch { return {}; }
  });
}

// ================= play builders =================
function buildPlayUrl(subDomain, subjectId, season, episode, detailPath, preferH264) {
  const codecs = preferH264
    ? "supportCodecs%5Bhevc%5D=0&supportCodecs%5Bh264%5D=1"
    : "supportCodecs%5Bhevc%5D=1&supportCodecs%5Bh264%5D=1";
  return `${subDomain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${season}&ep=${episode}` +
         `&detailPath=${encodeURIComponent(detailPath)}` +
         `&streamSignType=1&${codecs}`;
}
function buildPlayHeaders(subDomain, subjectId, detailPath, token, preferH264) {
  const referer = `${subDomain}/movies/${detailPath}?id=${subjectId}&type=/movie/detail&detailSe=&detailEp=&lang=en`;
  const h = {
    "User-Agent": PLAY_UA,
    "Referer": referer,
    "Accept": "application/json",
    "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}",
    "x-request-lang": "en",
    "x-vip-restrict": preferH264 ? "1" : "0",
    "x-no-high-risk-restrict": "0",
    "x-source": ""
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// ================= play (single attempt) =================
function playOnce(subDomain, subjectId, season, episode, detailPath, token, preferH264) {
  return __async(this, null, function* () {
    const url = buildPlayUrl(subDomain, subjectId, season, episode, detailPath, preferH264);
    const extra = buildPlayHeaders(subDomain, subjectId, detailPath, token, preferH264);
    const r = yield request("GET", url, null, extra, false, "v4");
    if (!r || !r.data || !r.data.data) return null;
    const d = r.data.data;
    const has = ["dash", "hls", "streams"].some(k => Array.isArray(d[k]) && d[k].length > 0);
    return has ? d : null;
  });
}

// ================= /subject/play with h264 + se/ep fallbacks =================
function playInfo(subDomain, subjectId, season, episode, detailPath, token) {
  return __async(this, null, function* () {
    // 1) primary
    let d = yield playOnce(subDomain, subjectId, season, episode, detailPath, token, false);
    if (d) return d;

    // 2) retry se=1/ep=1 (some servers reject 0/0)
    if (season === 0 || episode === 0) {
      d = yield playOnce(subDomain, subjectId, 1, 1, detailPath, token, false);
      if (d) return d;
    }

    // 3) force h264
    d = yield playOnce(subDomain, subjectId, season, episode, detailPath, token, true);
    if (d) return d;

    // 4) h264 + 1/1
    if (season === 0 || episode === 0) {
      d = yield playOnce(subDomain, subjectId, 1, 1, detailPath, token, true);
      if (d) return d;
    }
    return null;
  });
}

// ================= search / subject =================
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const r = yield request("POST", url, body, {}, false, "v3");
    if (!r || !r.data || !r.data.data || !Array.isArray(r.data.data.results)) return [];
    let all = [];
    for (const g of r.data.data.results) if (Array.isArray(g.subjects)) all = all.concat(g.subjects);
    return all;
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  const normT = normalizeTitle(tmdbTitle);
  const targetType = mediaType === "movie" ? 1 : 2;
  let best = null, bestScore = 0;
  for (const s of subjects) {
    if (s.subjectType !== targetType) continue;
    const normS = normalizeTitle(s.title);
    const year = s.year || (s.releaseDate ? s.releaseDate.substring(0, 4) : null);
    let score = 0;
    if (normS === normT) score += 50;
    else if (normS.includes(normT) || normT.includes(normS)) score += 15;
    if (tmdbYear && year && tmdbYear == year) score += 35;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 40 ? best : null;
}

// ================= subtitles =================
function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const out = [];
    const seen = new Set();
    const push = (c) => {
      if (!c || !c.url || seen.has(c.url)) return;
      seen.add(c.url);
      out.push({
        url: c.url,
        language: c.lan || c.lanName || c.language || "en",
        name: `${c.lanName || c.lan || c.language || "Subtitle"} (${langLabel})`,
        headers: { "Referer": API_BASE }
      });
    };
    try {
      const u = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const r = yield request("GET", u, null, {}, false, "v4");
      const caps = r && r.data && r.data.data && r.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch {}
    try {
      const u = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const r = yield request("GET", u, null, {}, false, "v4");
      const caps = r && r.data && r.data.data && r.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch {}
    return out;
  });
}

// ================= main stream resolver =================
function getStreamLinks(subjectId, season, episode, mediaTitle, mediaType) {
  return __async(this, null, function* () {
    // 1. subject-get (v4)
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield request("GET", subjectUrl, null, {}, false, "v4");
    if (!detailRes || !detailRes.data || !detailRes.data.data) {
      console.log("[MovieBox] Subject fetch failed");
      return [];
    }
    const subjectData = detailRes.data.data;
    console.log(`[MovieBox] Subject: "${subjectData.title}"`);

    // 2. parse detailUrl → subDomain + originalDetailPath
    let subDomain = API_BASE, originalDetailPath = null;
    if (subjectData.detailUrl) {
      try {
        const u = new URL(subjectData.detailUrl);
        subDomain = `${u.protocol}//${u.host}`;
        originalDetailPath = String(subjectData.detailUrl).replace(/\/+$/, "").split("/").pop();
      } catch {}
    }
    console.log(`[MovieBox] subDomain=${subDomain} detailPath=${originalDetailPath}`);

    // 3. build subject list (original + dubs)
    const list = [];
    let originalLang = "Original";
    if (Array.isArray(subjectData.dubs)) {
      for (const dub of subjectData.dubs) {
        if (String(dub.subjectId) === String(subjectId)) originalLang = dub.lanName || "Original";
        else list.push({ id: String(dub.subjectId), lang: dub.lanName || "Unknown", detailPath: dub.detailPath || null });
      }
    }
    list.unshift({ id: String(subjectId), lang: originalLang, detailPath: originalDetailPath });

    // 4. dub path map
    let dubPaths = {};
    if (originalDetailPath) dubPaths = yield fetchDubDetailPaths(originalDetailPath);
    console.log(`[MovieBox] dubPaths: ${Object.keys(dubPaths).length}`);

    // 5. token
    const token = yield getToken();

    const allStreams = [];
    const seen = new Set();

    for (const item of list) {
      try {
        const detailPath = item.detailPath || dubPaths[item.id] || item.id;
        console.log(`[MovieBox] play ${item.lang} id=${item.id} se=${season} ep=${episode}`);
        const playData = yield playInfo(subDomain, item.id, season, episode, detailPath, token);
        if (!playData) { console.log(`[MovieBox]   ✗ empty for ${item.lang}`); continue; }

        for (const bucket of ["dash", "hls", "streams"]) {
          const arr = playData[bucket];
          if (!Array.isArray(arr) || arr.length === 0) continue;

          for (const s of arr) {
            if (!s) continue;

            // (A) signCookie → resource → DASH url
            const resource = extractPolicyResource(s.signCookie);
            if (resource) {
              const streamId = s.id || `${item.id}|${season}|${episode}`;
              const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
              const list_res = String(s.resolutions || "1080").split(",").map(x => x.trim()).filter(Boolean);
              for (const q of (list_res.length ? list_res : ["1080"])) {
                const dashUrl = buildDashUrl(resource, q);
                if (!dashUrl || seen.has(dashUrl)) continue;
                seen.add(dashUrl);
                allStreams.push({
                  name: `MovieBox ${item.lang}`,
                  title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${q}p [${bucket.toUpperCase()}]`,
                  url: dashUrl,
                  quality: `${q}p • ${item.lang}`,
                  headers: {
                    "Referer": subDomain,
                    "User-Agent": PLAY_UA,
                    "Cookie": String(s.signCookie || "").replace(/;\s*$/, "").trim()
                  },
                  subtitles,
                  provider: "moviebox"
                });
              }
              continue;
            }

            // (B) raw URL fallback
            if (!s.url || isDecoyUrl(s.url)) continue;
            const formatType = getFormatType(s.url);
            const qualLabel = s.resolutions || s.quality || "";
            const qualNum = parseQualityNumber(qualLabel);
            const quality = qualNum ? `${qualNum}p` : "Auto";
            const streamId = s.id || `${item.id}|${season}|${episode}`;
            const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
            if (seen.has(s.url)) continue;
            seen.add(s.url);
            allStreams.push({
              name: `MovieBox ${item.lang}`,
              title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${quality} [${formatType}]`,
              url: s.url,
              quality: `${quality} • ${item.lang}`,
              headers: Object.assign(
                { "Referer": subDomain, "User-Agent": PLAY_UA },
                s.signCookie ? { "Cookie": String(s.signCookie).replace(/;\s*$/, "").trim() } : {}
              ),
              subtitles,
              provider: "moviebox"
            });
          }
        }
      } catch (err) {
        console.error(`[MovieBox] err id=${item.id}:`, err.message);
      }
    }
    console.log(`[MovieBox] === ${allStreams.length} streams ===`);
    return allStreams;
  });
}

// ================= public API =================
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] TMDB ${tmdbId} type=${mediaType} S${seasonNum}E${episodeNum}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) return [];
    let subjects = yield searchMovieBox(details.title);
    let best = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!best && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      best = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (!best) { console.log("[MovieBox] ✗ no match"); return []; }
    console.log(`[MovieBox] match "${best.title}" id=${best.subjectId}`);
    return yield getStreamLinks(
      String(best.subjectId),
      mediaType === "tv" ? seasonNum : 0,
      mediaType === "tv" ? episodeNum : 0,
      details.title, mediaType
    );
  });
}

module.exports = { getStreams };