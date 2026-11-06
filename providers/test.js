/**
 * moviebox - v4 fast path
 * - token stored in module scope + harvested from x-user, reused across calls
 * - dub detail paths cached per detailPath
 * - subtitles cached per (subjectId|streamId|lang), fetched once per stream
 * - dubs processed in parallel (cap 4)
 * - single /subject/play per dub; parallel fallback only if empty
 * - 401 re-auths immediately (no blind sleeps)
 */

var __create = Object.create;
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
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
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => { try { step(generator.next(value)); } catch (e) { reject(e); } };
    var rejected  = (value) => { try { step(generator.throw(value)); } catch (e) { reject(e); } };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

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

var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "3.0.03.0529.03",
  version_code: 50020042
};
var UA_V3 = "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)";

var PACKAGE_INFO_V4 = {
  package_name: "com.community.mbox.in",
  version_name: "4.0.02.0831.03",
  version_code: 50020126
};
var UA_V4 = "com.community.mbox.in/50020126 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)";
var PLAY_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

var DECOY_HASH = "b164fbfb4347792950bdfbfb563d39d9";
var DECOY_PATH = "/other/2026/09/04/";

// ================= module-scope caches (reused across calls) =================
var import_crypto_js = __toESM(require("crypto-js"));
var SECRET_KEY_DEFAULT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_DEFAULT).toString(import_crypto_js.default.enc.Utf8));
var SECRET_KEY_ALT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_ALT).toString(import_crypto_js.default.enc.Utf8));

var deviceId = "";
var selectedBrand = "";
var selectedModel = "";
var bearerToken = null;            // ← stored + reused
var tokenPromise = null;           // ← in-flight dedupe
var dubPathCache = new Map();      // detailPath -> { subjectId: detailPath }
var subtitleCache = new Map();     // `${subjectId}|${streamId}|${lang}` -> [subs]
var DUB_CONCURRENCY = 4;

// ================= utils =================
function decodeJwtExpiry(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return 0;
    let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    const parsed = import_crypto_js.default.enc.Base64.parse(base64).toString(import_crypto_js.default.enc.Utf8);
    return JSON.parse(parsed).exp || 0;
  } catch (e) { return 0; }
}
function isTokenValid(token) {
  if (!token) return false;
  return decodeJwtExpiry(token) > Date.now() / 1e3 + 300; // 5min headroom
}
function initializeSession() {
  if (!deviceId) {
    let chars = "0123456789abcdef";
    for (let i = 0; i < 32; i++) deviceId += chars[Math.floor(Math.random() * 16)];
    const brands = Object.keys(BRAND_MODELS);
    selectedBrand = brands[Math.floor(Math.random() * brands.length)];
    selectedModel = BRAND_MODELS[selectedBrand][Math.floor(Math.random() * BRAND_MODELS[selectedBrand].length)];
  }
}
function md5(input) { return import_crypto_js.default.MD5(input).toString(import_crypto_js.default.enc.Hex); }
function hmacMd5(key, data) { return import_crypto_js.default.HmacMD5(data, key).toString(import_crypto_js.default.enc.Base64); }
function generateXClientToken(timestamp) {
  const ts = (timestamp || Date.now()).toString();
  return `${ts},${md5(ts.split("").reverse().join(""))}`;
}
function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  let path = "", query = "";
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
    const params = Array.from(urlObj.searchParams.keys()).sort();
    if (params.length > 0) {
      query = params.map((key) => urlObj.searchParams.getAll(key).map((v) => `${key}=${v}`).join("&")).join("&");
    }
  } catch (e) {
    if (url.includes("?")) {
      const parts = url.split("?");
      path = parts[0].replace(/https?:\/\/[^\/]+/, "");
      query = parts[1].split("&").sort().join("&");
    } else {
      path = url.replace(/https?:\/\/[^\/]+/, "");
    }
  }
  const canonicalUrl = query ? `${path}?${query}` : path;
  let bodyHash = "", bodyLength = "";
  if (body && typeof body === "string" && body.length > 0) {
    const bodyWords = import_crypto_js.default.enc.Utf8.parse(body);
    bodyLength = bodyWords.sigBytes.toString();
    bodyHash = import_crypto_js.default.MD5(bodyWords).toString(import_crypto_js.default.enc.Hex);
  }
  return `${method.toUpperCase()}\n${accept || ""}\n${contentType || ""}\n${bodyLength}\n${timestamp}\n${bodyHash}\n${canonicalUrl}`;
}
function generateXTrSignature(method, accept, contentType, url, body, useAltKey = false, customTimestamp = null) {
  const timestamp = customTimestamp || Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  const secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  return `${timestamp}|2|${hmacMd5(secret, canonical)}`;
}
function buildClientInfoV4() {
  return JSON.stringify({
    package_name: "com.community.mbox.in",
    version_name: PACKAGE_INFO_V4.version_name,
    version_code: PACKAGE_INFO_V4.version_code,
    os: "android", os_version: "14", install_ch: "official",
    device_id: deviceId, install_store: "official",
    gaid: "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d",
    brand: "Google", model: "Pixel 8",
    system_language: "en", net: "NETWORK_WIFI", region: "IN",
    timezone: "Asia/Calcutta", sp_code: "",
    "X-Play-Mode": "1", "X-Idle-Data": "1",
    "X-Family-Mode": "0", "X-Content-Mode": "0"
  });
}

// ================= request core =================
// No getCachedToken() gate. Token used if present in module scope.
// x-user harvested on every response. 401 re-auths immediately.
function movieBoxRequest(_0, _1) {
  return __async(this, arguments, function* (method, url, body = null, customHeaders = {}, isTokenFetch = false, mode = "v3") {
    initializeSession();
    const timestamp = Date.now();
    const headerContentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xTrSignature = generateXTrSignature(method, accept, headerContentType, url, body, false, timestamp);
    const isV4 = mode === "v4";
    const xClientInfo = isV4 ? buildClientInfoV4() : JSON.stringify(__spreadProps(__spreadValues({}, PACKAGE_INFO), {
      os: "android", os_version: "16", device_id: deviceId, install_store: "ps",
      gaid: "d7578036d13336cc", brand: selectedBrand.toLowerCase(), model: selectedModel,
      system_language: "en", net: "NETWORK_WIFI", region: "IN",
      timezone: "Asia/Calcutta", sp_code: ""
    }));
    const ua = isV4 ? UA_V4 : UA_V3;

    function buildHeaders() {
      const h = __spreadValues({
        "Accept": accept,
        "Content-Type": headerContentType,
        "x-client-token": generateXClientToken(timestamp),
        "x-tr-signature": xTrSignature,
        "User-Agent": ua,
        "x-client-info": xClientInfo,
        "x-client-status": "0"
      }, customHeaders);
      if (!isTokenFetch && bearerToken) h["Authorization"] = `Bearer ${bearerToken}`;
      return h;
    }

    let options = { method, headers: buildHeaders() };
    if (body) options.body = body;

    try {
      let res = yield fetch(url, options);

      // 401 → re-auth once, no sleep
      if (res.status === 401 && !isTokenFetch && bearerToken) {
        bearerToken = null;
        const t = yield getCachedToken(true);
        if (t) {
          options.headers["Authorization"] = `Bearer ${t}`;
          res = yield fetch(url, options);
        }
      }
      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          yield new Promise((r) => setTimeout(r, 400));
          res = yield fetch(url, options);
          if (!res.ok) return null;
        } else {
          return null;
        }
      }

      const text = yield res.text();
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }

      // harvest token from every response
      const xUser = res.headers.get("x-user");
      if (xUser) {
        try {
          const j = JSON.parse(xUser);
          if (j.token && isTokenValid(j.token)) bearerToken = j.token;
        } catch {}
      }
      return { data: parsed, headers: res.headers };
    } catch (err) {
      return null;
    }
  });
}

// ================= token (stored + reused, in-flight deduped) =================
function getCachedToken(force = false) {
  return __async(this, null, function* () {
    if (!force && isTokenValid(bearerToken)) return bearerToken;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (function* () {
      const url = `${API_BASE_TOKEN}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
      const res = yield movieBoxRequest("GET", url, null, {}, true, "v3");
      if (res && res.headers) {
        const xUser = res.headers.get("x-user");
        if (xUser) {
          try {
            const j = JSON.parse(xUser);
            if (j.token && isTokenValid(j.token)) { bearerToken = j.token; return j.token; }
          } catch {}
        }
      }
      return bearerToken || "";
    })();
    try { return yield tokenPromise; } finally { tokenPromise = null; }
  });
}

// ================= tmdb =================
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
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id,
        originalTitle: data.original_title || data.original_name
      };
    } catch (e) { return null; }
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

// ================= signCookie decode =================
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
    const up = s.match(/urlprefix=([^:;\s]+)/);
    if (up && up[1]) {
      const raw = up[1].replace(/^["'\s]+|["'\s]+$/g, "");
      if (/^https?:\/\//i.test(raw)) return raw;
      try {
        let b = raw.replace(/-/g, "+").replace(/_/g, "/");
        while (b.length % 4) b += "=";
        const dec = import_crypto_js.default.enc.Base64.parse(b).toString(import_crypto_js.default.enc.Utf8);
        if (/^https?:\/\//i.test(dec)) return dec;
      } catch {}
    }
    const m = s.match(/(?:CloudFront-)?Policy=([^;]+)/);
    if (!m) return null;
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const decoded = import_crypto_js.default.enc.Base64.parse(b64).toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(decoded);
    return (json.Statement && json.Statement[0] && json.Statement[0].Resource) || null;
  } catch (e) { return null; }
}
function buildDashUrl(resource, quality) {
  if (!resource) return null;
  let url = String(resource).replace(/\/\*$/, "").replace(/\/+$/, "");
  if (quality) url = url.replace(/_(\d+)_(h26\d|hevc|h264|avc)(_\d+)?$/, `_${quality}_$2$3`);
  return `${url}/index.mpd`;
}

// ================= dub detail paths (cached) =================
function fetchDubDetailPaths(detailPath) {
  return __async(this, null, function* () {
    if (!detailPath) return {};
    if (dubPathCache.has(detailPath)) return dubPathCache.get(detailPath);
    try {
      const url = `${API_BASE_DETAIL}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`;
      const res = yield fetch(url, { headers: {
        "Accept": "application/json",
        "Origin": "https://movie-box.co",
        "Referer": "https://mzfi.me/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
        "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}"
      }});
      const map = {};
      if (res.ok) {
        const root = yield res.json();
        const dubs = root && root.data && root.data.subject ? root.data.subject.dubs : null;
        if (Array.isArray(dubs)) for (const d of dubs) {
          if (d && d.subjectId && d.detailPath && String(d.detailPath).trim()) map[String(d.subjectId)] = d.detailPath;
        }
      }
      dubPathCache.set(detailPath, map);
      return map;
    } catch { dubPathCache.set(detailPath, {}); return {}; }
  });
}

// ================= play =================
function playOnce(subDomain, sid, se, ep, dp, h264Only) {
  return __async(this, null, function* () {
    const codecs = h264Only ? "supportCodecs%5Bhevc%5D=0&supportCodecs%5Bh264%5D=1"
                            : "supportCodecs%5Bhevc%5D=1&supportCodecs%5Bh264%5D=1";
    const url = `${subDomain}/wefeed-h5api-bff/subject/play?subjectId=${sid}&se=${se}&ep=${ep}` +
                `&detailPath=${encodeURIComponent(dp)}&streamSignType=1&${codecs}`;
    const referer = `${subDomain}/movies/${dp}?id=${sid}&type=/movie/detail&detailSe=&detailEp=&lang=en`;
    const extra = {
      "User-Agent": PLAY_UA, "Referer": referer, "Accept": "application/json",
      "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}", "x-request-lang": "en",
      "x-vip-restrict": h264Only ? "1" : "0", "x-no-high-risk-restrict": "0", "x-source": ""
    };
    const r = yield movieBoxRequest("GET", url, null, extra, false, "v4");
    if (!r || !r.data || !r.data.data) return null;
    const d = r.data.data;
    const has = ["dash", "hls", "streams"].some(k => Array.isArray(d[k]) && d[k].length > 0);
    return has ? d : null;
  });
}

function playInfo(subDomain, sid, se, ep, dp) {
  return __async(this, null, function* () {
    // one shot with both codecs enabled
    let d = yield playOnce(subDomain, sid, se, ep, dp, false);
    if (d) return d;
    // parallel fallback only if the first shot was empty
    const tries = [
      playOnce(subDomain, sid, 0, 0, dp, false),
      playOnce(subDomain, sid, 1, 1, dp, false),
      playOnce(subDomain, sid, se, ep, dp, true)
    ];
    const results = yield Promise.all(tries);
    return results.find(Boolean) || null;
  });
}

// ================= search =================
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const response = yield movieBoxRequest("POST", url, body, {}, false, "v3");
    if (response && response.data && response.data.data && response.data.data.results) {
      let all = [];
      response.data.data.results.forEach((g) => { if (g.subjects) all = all.concat(g.subjects); });
      return all;
    }
    return [];
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  const norm = normalizeTitle(tmdbTitle);
  const targetType = mediaType === "movie" ? 1 : 2;
  let best = null, bestScore = 0;
  for (const s of subjects) {
    if (s.subjectType !== targetType) continue;
    const t = normalizeTitle(s.title);
    const year = s.year || (s.releaseDate ? s.releaseDate.substring(0, 4) : null);
    let score = 0;
    if (t === norm) score += 50;
    else if (t.includes(norm) || norm.includes(t)) score += 15;
    if (tmdbYear && year && tmdbYear == year) score += 35;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= 40 ? best : null;
}

// ================= subtitles (cached, once per stream) =================
function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const key = `${subjectId}|${streamId}|${langLabel}`;
    if (subtitleCache.has(key)) return subtitleCache.get(key);
    const out = [];
    const seen = new Set();
    const push = (cap) => {
      if (!cap || !cap.url || seen.has(cap.url)) return;
      seen.add(cap.url);
      out.push({
        url: cap.url,
        language: cap.lan || cap.lanName || cap.language || "en",
        name: `${cap.lanName || cap.lan || cap.language || "Subtitle"} (${langLabel})`,
        headers: { "Referer": API_BASE }
      });
    };
    const [a, b] = yield Promise.all([
      movieBoxRequest("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`, null, {}, false, "v4").catch(() => null),
      movieBoxRequest("GET", `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`, null, {}, false, "v4").catch(() => null)
    ]);
    if (a && a.data && a.data.data && Array.isArray(a.data.data.extCaptions)) a.data.data.extCaptions.forEach(push);
    if (b && b.data && b.data.data && Array.isArray(b.data.data.extCaptions)) b.data.data.extCaptions.forEach(push);
    subtitleCache.set(key, out);
    return out;
  });
}

// ================= concurrency helper =================
function mapLimit(items, limit, fn) {
  return __async(this, null, function* () {
    const results = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, () => (function* () {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        try { results[idx] = yield fn(items[idx], idx); }
        catch (e) { results[idx] = null; }
      }
    })());
    yield Promise.all(workers);
    return results;
  });
}

// ================= main =================
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl, null, {}, false, "v4");
    if (!detailRes || !detailRes.data || !detailRes.data.data) return [];
    const subjectData = detailRes.data.data;

    let subDomain = API_BASE, originalDetailPath = null;
    if (subjectData.detailUrl) {
      try {
        const u = new URL(subjectData.detailUrl);
        subDomain = `${u.protocol}//${u.host}`;
        originalDetailPath = String(subjectData.detailUrl).replace(/\/+$/, "").split("/").pop();
      } catch {}
    }

    const subjectIds = [];
    let originalLang = "Original";
    if (Array.isArray(subjectData.dubs)) {
      for (const dub of subjectData.dubs) {
        if (String(dub.subjectId) === String(subjectId)) originalLang = dub.lanName || "Original";
        else subjectIds.push({ id: String(dub.subjectId), lang: dub.lanName || "Unknown", detailPath: dub.detailPath || null });
      }
    }
    subjectIds.unshift({ id: String(subjectId), lang: originalLang, detailPath: originalDetailPath });

    // warm token in background (non-blocking); harvest from subject-api/get already done
    if (!isTokenValid(bearerToken)) getCachedToken().catch(() => {});

    // fetch dub paths only if some dub is missing its direct detailPath
    let dubPaths = {};
    const needDubPaths = subjectIds.some((s) => !s.detailPath && s.id !== String(subjectId));
    if (needDubPaths && originalDetailPath) dubPaths = yield fetchDubDetailPaths(originalDetailPath);

    const allStreams = [];
    const seen = new Set();

    // dubs in parallel (cap 4)
    const perDub = yield mapLimit(subjectIds, DUB_CONCURRENCY, (item) => (function* () {
      const detailPath = item.detailPath || dubPaths[item.id] || item.id;
      const playData = yield playInfo(subDomain, item.id, season, episode, detailPath);
      if (!playData) return [];
      const local = [];
      const subJobs = [];

      for (const bucket of ["dash", "hls", "streams"]) {
        const arr = playData[bucket];
        if (!Array.isArray(arr) || arr.length === 0) continue;

        for (const stream of arr) {
          if (!stream) continue;
          const streamId = stream.id || `${item.id}|${season}|${episode}`;

          // subtitles once per stream, attached to all resolutions
          const subPromise = fetchSubtitles(item.id, streamId, item.lang);
          const idx = subJobs.push(subPromise) - 1;

          const resource = extractPolicyResource(stream.signCookie);
          if (resource) {
            const resolutions = String(stream.resolutions || "")
              .split(",").map((x) => x.trim()).filter(Boolean);
            const list = resolutions.length ? resolutions : ["1080"];
            for (const r of list) {
              const dashUrl = buildDashUrl(resource, r);
              if (!dashUrl || seen.has(dashUrl)) continue;
              seen.add(dashUrl);
              local.push({
                name: `MovieBox ${item.lang}`,
                title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${r}p [${bucket.toUpperCase()}]`,
                url: dashUrl,
                quality: `${r}p • ${item.lang}`,
                headers: {
                  "Referer": subDomain,
                  "User-Agent": PLAY_UA,
                  "Cookie": String(stream.signCookie || "").replace(/;\s*$/, "").trim()
                },
                subtitles: null,
                _subIdx: idx,
                provider: "moviebox"
              });
            }
            continue;
          }

          if (!stream.url || isDecoyUrl(stream.url)) continue;
          const formatType = getFormatType(stream.url);
          const qualLabel = stream.resolutions || stream.quality || "Auto";
          const qualNum = parseQualityNumber(qualLabel);
          const quality = qualNum ? `${qualNum}p` : "Auto";
          if (seen.has(stream.url)) continue;
          seen.add(stream.url);
          local.push({
            name: `MovieBox ${item.lang}`,
            title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${quality} [${formatType}]`,
            url: stream.url,
            quality: `${quality} • ${item.lang}`,
            headers: __spreadValues({
              "Referer": subDomain,
              "User-Agent": PLAY_UA
            }, stream.signCookie ? { "Cookie": String(stream.signCookie).replace(/;\s*$/, "").trim() } : {}),
            subtitles: null,
            _subIdx: idx,
            provider: "moviebox"
          });
        }
      }

      const subs = yield Promise.all(subJobs);
      for (const s of local) s.subtitles = subs[s._subIdx] || [];
      for (const s of local) delete s._subIdx;
      return local;
    })());

    for (const arr of perDub) if (Array.isArray(arr)) allStreams.push(...arr);
    return allStreams;
  });
}

// ================= public =================
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) return [];
    let subjects = yield searchMovieBox(details.title);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (!bestMatch) return [];
    const s = mediaType === "tv" ? seasonNum : 0;
    const e = mediaType === "tv" ? episodeNum : 0;
    return yield getStreamLinks(String(bestMatch.subjectId), s, e, details.title, mediaType);
  });
}

module.exports = { getStreams };