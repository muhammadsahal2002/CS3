/**
 * moviebox - ported from APK v4.0.02.0831.03 (50020126)
 * Built from your original plugin — only playback-critical changes applied.
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
var API_BASE_TOKEN  = "https://apig.inmoviebox.com";   // ← ADDED
var API_BASE_DETAIL = "https://movie-box.co";          // ← ADDED

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

// v3 — search & token (unchanged from your old plugin)
var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "3.0.03.0529.03",
  version_code: 50020042
};
var UA_V3 = "com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)";

// v4 — subject-get & play  ← ADDED
var PACKAGE_INFO_V4 = {
  package_name: "com.community.mbox.in",
  version_name: "4.0.02.0831.03",
  version_code: 50020126
};
var UA_V4 = "com.community.mbox.in/50020126 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)";
var PLAY_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36";

var DECOY_HASH = "b164fbfb4347792950bdfbfb563d39d9";
var DECOY_PATH = "/other/2026/09/04/";

// ================= utils =================
var import_crypto_js = __toESM(require("crypto-js"));
var SECRET_KEY_DEFAULT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_DEFAULT).toString(import_crypto_js.default.enc.Utf8));
var SECRET_KEY_ALT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_ALT).toString(import_crypto_js.default.enc.Utf8));

var deviceId = "";
var selectedBrand = "";
var selectedModel = "";
var bearerToken = null;

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
  return decodeJwtExpiry(token) > Date.now() / 1e3 + 3600;
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
  const hash = md5(ts.split("").reverse().join(""));
  return `${ts},${hash}`;
}
function buildCanonicalString(method, accept, contentType, url, body, timestamp) {
  let path = "", query = "";
  try {
    const urlObj = new URL(url);
    path = urlObj.pathname;
    const params = Array.from(urlObj.searchParams.keys()).sort();
    if (params.length > 0) {
      query = params.map((key) => {
        const values = urlObj.searchParams.getAll(key);
        return values.map((val) => `${key}=${val}`).join("&");
      }).join("&");
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
  return `${method.toUpperCase()}
${accept || ""}
${contentType || ""}
${bodyLength}
${timestamp}
${bodyHash}
` + canonicalUrl;
}
function generateXTrSignature(method, accept, contentType, url, body, useAltKey = false, customTimestamp = null) {
  const timestamp = customTimestamp || Date.now();
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestamp);
  const secret = useAltKey ? SECRET_KEY_ALT : SECRET_KEY_DEFAULT;
  return `${timestamp}|2|${hmacMd5(secret, canonical)}`;
}

// ← ADDED: v4 client info builder
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

// ← CHANGED: add `mode` param ("v3" default, "v4" for subject-get & play)
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
    const headers = __spreadValues({
      "Accept": accept,
      "Content-Type": headerContentType,
      "x-client-token": generateXClientToken(timestamp),
      "x-tr-signature": xTrSignature,
      "User-Agent": ua,
      "x-client-info": xClientInfo,
      "x-client-status": "0"
    }, customHeaders);
    if (!isTokenFetch) {
      const token = yield getCachedToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const options = { method, headers };
    if (body) options.body = body;
    let retries = 2;
    while (retries > 0) {
      try {
        const res = yield fetch(url, options);
        if (!res.ok) {
          if (res.status === 401 || res.status === 403 || res.status === 429) {
            bearerToken = null;
            retries--;
            yield new Promise((r) => setTimeout(r, 1e3));
            continue;
          }
          return null;
        }
        const text = yield res.text();
        let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
        const xUser = res.headers.get("x-user");
        if (xUser) { try { const j = JSON.parse(xUser); if (j.token && isTokenValid(j.token)) bearerToken = j.token; } catch {} }
        return { data: parsed, headers: res.headers };
      } catch (err) {
        retries--;
        if (retries === 0) { console.error("[MovieBox Request Error]", err.message); return null; }
        yield new Promise((r) => setTimeout(r, 1e3));
      }
    }
    return null;
  });
}

// ← CHANGED: token host is apig.inmoviebox.com
function getCachedToken() {
  return __async(this, null, function* () {
    if (isTokenValid(bearerToken)) return bearerToken;
    console.log("[MovieBox] Fetching fresh anonymous token...");
    const url = `${API_BASE_TOKEN}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
    const res = yield movieBoxRequest("GET", url, null, {}, true, "v3");
    if (res && res.headers) {
      const xUser = res.headers.get("x-user");
      if (xUser) {
        try {
          const xUserJson = JSON.parse(xUser);
          const token = xUserJson.token;
          if (token && isTokenValid(token)) { bearerToken = token; return token; }
        } catch (e) { console.error("[MovieBox] Failed to parse x-user", e); }
      }
    }
    return bearerToken || "";
  });
}

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
    } catch (e) { console.error("[MovieBox TMDB Error]", e.message); return null; }
  });
}
function normalizeTitle(s) {
  if (!s) return "";
  return s.replace(/\[.*?\]/g, " ").replace(/\(.*?\|/g, " ")
    .replace(/\b(dub|dubbed|hd|4k|hindi|tamil|telugu|dual audio)\b/gi, " ")
    .trim().toLowerCase().replace(/:/g, " ")
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
}
function parseQualityNumber(value) {
  const match = String(value || "").match(/(\d{3,4})/);
  return match ? parseInt(match[1], 10) : 0;
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

// ← CHANGED: added `urlprefix=<base64url>` branch (THE critical fix)
function extractPolicyResource(signCookie) {
  if (!signCookie) return null;
  try {
    let s = String(signCookie).trim();

    // If JSON, drill to signCookie field
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

    // Branch 1: urlprefix= (raw URL or base64url)
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

    // Branch 2: (CloudFront-)?Policy=  (old path, still needed)
    const m = s.match(/(?:CloudFront-)?Policy=([^;]+)/);
    if (!m) return null;
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const decoded = import_crypto_js.default.enc.Base64.parse(b64).toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(decoded);
    return (json.Statement && json.Statement[0] && json.Statement[0].Resource) || null;
  } catch (e) { return null; }
}

// ← CHANGED: strip trailing slashes → fixes `//index.mpd`
function buildDashUrl(resource, quality) {
  if (!resource) return null;
  let url = String(resource).replace(/\/\*$/, "").replace(/\/+$/, "");
  if (quality) url = url.replace(/_(\d+)_(h26\d|hevc|h264|avc)(_\d+)?$/, `_${quality}_$2$3`);
  return `${url}/index.mpd`;
}

// ← ADDED: dub detail paths from movie-box.co (needed for /subject/play)
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
        if (d && d.subjectId && d.detailPath && String(d.detailPath).trim()) map[String(d.subjectId)] = d.detailPath;
      }
      return map;
    } catch { return {}; }
  });
}

// ← CHANGED: replaced play-info with /subject/play, added se/ep + h264 fallbacks
function playOnce(subDomain, sid, se, ep, dp, token, h264Only) {
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
    if (token) extra["Authorization"] = `Bearer ${token}`;
    const r = yield movieBoxRequest("GET", url, null, extra, false, "v4");
    if (!r || !r.data || !r.data.data) return null;
    const d = r.data.data;
    const has = ["dash", "hls", "streams"].some(k => Array.isArray(d[k]) && d[k].length > 0);
    return has ? d : null;
  });
}
function playInfo(subDomain, sid, se, ep, dp, token) {
  return __async(this, null, function* () {
    const pairs = [];
    const add = (a, b) => { if (!pairs.some(([x, y]) => x === a && y === b)) pairs.push([a, b]); };
    add(se, ep);
    add(0, 0);   // movie default
    add(1, 1);   // TV default
    for (const [s, e] of pairs) {
      for (const h264 of [false, true]) {
        const d = yield playOnce(subDomain, sid, s, e, dp, token, h264);
        if (d) return d;
      }
    }
    return null;
  });
}

// ================= search =================
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const response = yield movieBoxRequest("POST", url, body, {}, false, "v3");
    if (response && response.data && response.data.data && response.data.data.results) {
      let allSubjects = [];
      response.data.data.results.forEach((group) => { if (group.subjects) allSubjects = allSubjects.concat(group.subjects); });
      return allSubjects;
    }
    return [];
  });
}
function findBestMatch(subjects, tmdbTitle, tmdbYear, mediaType) {
  const normTmdbTitle = normalizeTitle(tmdbTitle);
  const targetType = mediaType === "movie" ? 1 : 2;
  let bestMatch = null, bestScore = 0;
  for (const subject of subjects) {
    if (subject.subjectType !== targetType) continue;
    const normTitle = normalizeTitle(subject.title);
    const year = subject.year || (subject.releaseDate ? subject.releaseDate.substring(0, 4) : null);
    let score = 0;
    if (normTitle === normTmdbTitle) score += 50;
    else if (normTitle.includes(normTmdbTitle) || normTmdbTitle.includes(normTitle)) score += 15;
    if (tmdbYear && year && tmdbYear == year) score += 35;
    if (score > bestScore) { bestScore = score; bestMatch = subject; }
  }
  return bestScore >= 40 ? bestMatch : null;
}

// ================= getStreamLinks =================
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    // subject-get (v4)
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl, null, {}, false, "v4");
    if (!detailRes || !detailRes.data || !detailRes.data.data) {
      console.log("[MovieBox] Subject fetch failed");
      return [];
    }
    const subjectData = detailRes.data.data;
    console.log(`[MovieBox] Subject: "${subjectData.title}"`);

    // detailUrl → subDomain + original detailPath
    let subDomain = API_BASE, originalDetailPath = null;
    if (subjectData.detailUrl) {
      try {
        const u = new URL(subjectData.detailUrl);
        subDomain = `${u.protocol}//${u.host}`;
        originalDetailPath = String(subjectData.detailUrl).replace(/\/+$/, "").split("/").pop();
      } catch {}
    }
    console.log(`[MovieBox] subDomain=${subDomain} detailPath=${originalDetailPath}`);

    // subject list (original + dubs)
    const subjectIds = [];
    let originalLang = "Original";
    if (Array.isArray(subjectData.dubs)) {
      for (const dub of subjectData.dubs) {
        if (String(dub.subjectId) === String(subjectId)) originalLang = dub.lanName || "Original";
        else subjectIds.push({ id: String(dub.subjectId), lang: dub.lanName || "Unknown", detailPath: dub.detailPath || null });
      }
    }
    subjectIds.unshift({ id: String(subjectId), lang: originalLang, detailPath: originalDetailPath });

    // dub detail path map
    let dubPaths = {};
    if (originalDetailPath) dubPaths = yield fetchDubDetailPaths(originalDetailPath);
    console.log(`[MovieBox] dubPaths: ${Object.keys(dubPaths).length}`);

    const token = yield getCachedToken();
    const allStreams = [];
    const seen = new Set();

    for (const item of subjectIds) {
      try {
        const detailPath = item.detailPath || dubPaths[item.id] || item.id;
        console.log(`[MovieBox] → /subject/play ${item.lang} id=${item.id} se=${season} ep=${episode}`);
        const playData = yield playInfo(subDomain, item.id, season, episode, detailPath, token);
        if (!playData) { console.log(`[MovieBox]   play empty`); continue; }

        for (const bucket of ["dash", "hls", "streams"]) {
          const arr = playData[bucket];
          if (!Array.isArray(arr) || arr.length === 0) continue;

          for (const stream of arr) {
            if (!stream) continue;

            // (A) signCookie → resource → DASH
            const resource = extractPolicyResource(stream.signCookie);
            if (resource) {
              console.log(`[MovieBox]   🔓 resource=${resource} (${bucket})`);
              const resolutions = String(stream.resolutions || "")
                .split(",").map((x) => x.trim()).filter(Boolean);
              const list = resolutions.length ? resolutions : ["1080"];
              const streamId = stream.id || `${item.id}|${season}|${episode}`;
              const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
              for (const r of list) {
                const dashUrl = buildDashUrl(resource, r);
                if (!dashUrl || seen.has(dashUrl)) continue;
                seen.add(dashUrl);
                allStreams.push({
                  name: `MovieBox ${item.lang}`,
                  title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${r}p [${bucket.toUpperCase()}]`,
                  url: dashUrl,
                  quality: `${r}p • ${item.lang}`,
                  headers: {
                    "Referer": subDomain,
                    "User-Agent": PLAY_UA,
                    "Cookie": String(stream.signCookie || "").replace(/;\s*$/, "").trim()
                  },
                  subtitles,
                  provider: "moviebox"
                });
              }
              continue;
            }

            // (B) raw URL fallback
            if (!stream.url || isDecoyUrl(stream.url)) {
              if (stream.url) console.log(`[MovieBox]   ⚠️ decoy, no resource`);
              continue;
            }
            const formatType = getFormatType(stream.url);
            const qualLabel = stream.resolutions || stream.quality || "Auto";
            const qualNum = parseQualityNumber(qualLabel);
            const quality = qualNum ? `${qualNum}p` : "Auto";
            const streamId = stream.id || `${item.id}|${season}|${episode}`;
            const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
            if (seen.has(stream.url)) continue;
            seen.add(stream.url);
            allStreams.push({
              name: `MovieBox ${item.lang}`,
              title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${quality} [${formatType}]`,
              url: stream.url,
              quality: `${quality} • ${item.lang}`,
              headers: __spreadValues({
                "Referer": subDomain,
                "User-Agent": PLAY_UA
              }, stream.signCookie ? { "Cookie": String(stream.signCookie).replace(/;\s*$/, "").trim() } : {}),
              subtitles,
              provider: "moviebox"
            });
          }
        }
      } catch (err) {
        console.error(`[MovieBox Stream Fetch Error] ID: ${item.id}`, err.message);
      }
    }
    console.log(`[MovieBox] === Total: ${allStreams.length} streams ===`);
    return allStreams;
  });
}

// ================= subtitles =================
function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const subtitles = [];
    const seen = new Set();
    const push = (cap) => {
      if (!cap || !cap.url || seen.has(cap.url)) return;
      seen.add(cap.url);
      subtitles.push({
        url: cap.url,
        language: cap.lan || cap.lanName || cap.language || "en",
        name: `${cap.lanName || cap.lan || cap.language || "Subtitle"} (${langLabel})`,
        headers: { "Referer": API_BASE }
      });
    };
    try {
      const u = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const r = yield movieBoxRequest("GET", u, null, {}, false, "v4");
      const caps = r && r.data && r.data.data && r.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch {}
    try {
      const u = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const r = yield movieBoxRequest("GET", u, null, {}, false, "v4");
      const caps = r && r.data && r.data.data && r.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch {}
    return subtitles;
  });
}

// ================= getStreams =================
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] === Querying TMDB ${tmdbId} type=${mediaType} S${seasonNum}E${episodeNum} ===`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) { console.log("[MovieBox] TMDB details failed"); return []; }
    let subjects = yield searchMovieBox(details.title);
    console.log(`[MovieBox] Search "${details.title}" → ${subjects.length} results`);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      console.log(`[MovieBox] Fallback search "${details.originalTitle}" → ${subjects.length} results`);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      console.log(`[MovieBox] Best match: "${bestMatch.title}" id=${bestMatch.subjectId}`);
      const s = mediaType === "tv" ? seasonNum : 0;
      const e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(String(bestMatch.subjectId), s, e, details.title, mediaType);
    }
    console.log(`[MovieBox] ✗ No matching content found for: ${details.title}`);
    return [];
  });
}

module.exports = { getStreams };