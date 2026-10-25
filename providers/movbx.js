/**
 * moviebox - ported from new APK v4.0.02.0831.03 (50020126)
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
        __defProp(to, key, { get: () => __getOwnPropDesc(from, key), enumerable: true, configurable: true });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try { step(generator.next(value)); } catch (e) { reject(e); }
    };
    var rejected = (value) => {
      try { step(generator.throw(value)); } catch (e) { reject(e); }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/moviebox/constants.js
var API_BASE = "https://api3.aoneroom.com";              // still used for search/subject/get-stream
var API_BASE_TOKEN = "https://apig.inmoviebox.com";      // [NEW] token fetch host
var API_BASE_DETAIL = "https://movie-box.co";            // [NEW] dub detail-path host
var KEY_B64_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
var KEY_B64_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";

var BRAND_MODELS = {
  "Samsung": ["SM-S918B", "SM-A528B", "SM-M336B"],
  "Xiaomi": ["2201117TI", "M2012K11AI", "Redmi Note 11"],
  "OnePlus": ["LE2111", "CPH2449", "IN2023"],
  "Google": ["Pixel 6", "Pixel 7", "Pixel 8"],
  "Realme": ["RMX3085", "RMX3360", "RMX3551"]
};

// [CHANGED] bumped to match new APK
var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "4.0.02.0831.03",
  version_code: 50020126
};

var CLIENT_UA = "com.community.mbox.in/50020126 (Linux; U; Android 14; en_IN; Pixel 8; Build/UD1A.230803.041; Cronet/145.0.7582.0)"; // [CHANGED]
var PLAY_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36"; // [NEW]
var GAID = "1b2212c1-dadf-43c3-a0c8-bd6ce48ae22d"; // [CHANGED]

var DECOY_HASH = "b164fbfb4347792950bdfbfb563d39d9";
var DECOY_PATH = "/other/2026/09/04/";

// src/moviebox/utils.js
var import_crypto_js = __toESM(require("crypto-js"));
var SECRET_KEY_DEFAULT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_DEFAULT).toString(import_crypto_js.default.enc.Utf8)
);
var SECRET_KEY_ALT = import_crypto_js.default.enc.Base64.parse(
  import_crypto_js.default.enc.Base64.parse(KEY_B64_ALT).toString(import_crypto_js.default.enc.Utf8)
);
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
function getCachedToken() {
  return __async(this, null, function* () {
    if (isTokenValid(bearerToken)) return bearerToken;
    console.log("[MovieBox] Fetching fresh anonymous token...");
    // [CHANGED] token host is apig.inmoviebox.com
    const url = `${API_BASE_TOKEN}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
    const res = yield movieBoxRequest("GET", url, null, {}, true);
    if (res && res.headers) {
      const xUser = res.headers.get("x-user");
      if (xUser) {
        try {
          const xUserJson = JSON.parse(xUser);
          const token = xUserJson.token;
          if (token && isTokenValid(token)) {
            bearerToken = token;
            console.log("[MovieBox] Token acquired");
            return token;
          }
        } catch (e) {
          console.error("[MovieBox] Failed to parse x-user header for token", e);
        }
      }
    }
    return bearerToken || "";
  });
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
function md5(input) {
  return import_crypto_js.default.MD5(input).toString(import_crypto_js.default.enc.Hex);
}
function hmacMd5(key, data) {
  return import_crypto_js.default.HmacMD5(data, key).toString(import_crypto_js.default.enc.Base64);
}
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

// [CHANGED] new x-client-info shape (matches v4 APK)
function buildClientInfo(brand, model) {
  return JSON.stringify({
    package_name: PACKAGE_INFO.package_name,
    version_name: PACKAGE_INFO.version_name,
    version_code: PACKAGE_INFO.version_code,
    os: "android",
    os_version: "14",
    install_ch: "official",
    device_id: deviceId,
    install_store: "official",
    gaid: GAID,
    brand: brand || "Google",
    model: model || "Pixel 8",
    system_language: "en",
    net: "NETWORK_WIFI",
    region: "IN",
    timezone: "Asia/Calcutta",
    sp_code: "",
    "X-Play-Mode": "1",
    "X-Idle-Data": "1",
    "X-Family-Mode": "0",
    "X-Content-Mode": "0"
  });
}

function movieBoxRequest(_0, _1) {
  return __async(this, arguments, function* (method, url, body = null, customHeaders = {}, isTokenFetch = false) {
    initializeSession();
    const timestamp = Date.now();
    const headerContentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xTrSignature = generateXTrSignature(method, accept, headerContentType, url, body, false, timestamp);

    const headers = __spreadValues({
      "Accept": accept,
      "Content-Type": headerContentType,
      "x-client-token": generateXClientToken(timestamp),
      "x-tr-signature": xTrSignature,
      "User-Agent": CLIENT_UA,
      "x-client-info": buildClientInfo("Google", "Pixel 8"),
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
          if (res.status === 403 || res.status === 429) {
            retries--;
            yield new Promise((resolve) => setTimeout(resolve, 1e3));
            continue;
          }
          return null;
        }
        const text = yield res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        const xUser = res.headers.get("x-user");
        if (xUser) {
          try {
            const j = JSON.parse(xUser);
            if (j.token && isTokenValid(j.token)) bearerToken = j.token;
          } catch (e) {}
        }
        return { data: parsed, headers: res.headers };
      } catch (err) {
        retries--;
        if (retries === 0) {
          console.error("[MovieBox Request Error]", err.message);
          return null;
        }
        yield new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }
    return null;
  });
}

function fetchTmdbDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    var _a;
    try {
      const url = `${TMDB_BASE_URL}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
      const res = yield fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Connection": "keep-alive"
        }
      });
      const data = yield res.json();
      return {
        title: mediaType === "movie" ? data.title || data.original_title : data.name || data.original_name,
        year: (data.release_date || data.first_air_date || "").substring(0, 4),
        imdbId: (_a = data.external_ids) == null ? void 0 : _a.imdb_id,
        originalTitle: data.original_title || data.original_name
      };
    } catch (e) {
      console.error("[MovieBox TMDB Error]", e.message);
      return null;
    }
  });
}
function normalizeTitle(s) {
  if (!s) return "";
  return s.replace(/\[.*?\]/g, " ").replace(/\(.*?|/g, " ")
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

// [FIXED] now implements BOTH branches from new Smali:
//   1) urlprefix=<base64url> -> decode -> return http(s) URL
//   2) (CloudFront-)?Policy=<base64> -> JSON -> Statement[0].Resource
function base64UrlDecode(s) {
  let b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return import_crypto_js.default.enc.Base64.parse(b64);
}
function extractPolicyResource(signCookie) {
  if (!signCookie) return null;
  try {
    let cookieStr = String(signCookie).trim();

    // If it's JSON-ish, try to pull signCookie field directly
    if (cookieStr.startsWith("{")) {
      try {
        const root = JSON.parse(cookieStr);
        let streams = root && root.data && root.data.streams ? root.data.streams : root.streams;
        let sc = null;
        if (Array.isArray(streams) && streams.length > 0) {
          sc = streams[0] && streams[0].signCookie;
        }
        if (!sc && root.signCookie) sc = root.signCookie;
        if (!sc) return null;
        cookieStr = String(sc);
      } catch (e) { /* fall through */ }
    }

    // [FIXED] Step 1: urlprefix= -- either an http(s) URL directly, or base64url-encoded URL
    const up = cookieStr.match(/urlprefix=([^:;\s]+)/);
    if (up && up[1]) {
      const raw = up[1].replace(/^["'\s]+|["'\s]+$/g, "");
      if (/^https?:\/\//i.test(raw)) {
        return raw; // already a URL
      }
      try {
        const decoded = base64UrlDecode(raw).toString(import_crypto_js.default.enc.Utf8);
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch (e) { /* ignore */ }
    }

    // [FIXED] Step 2: (CloudFront-)?Policy=<base64>
    const pm = cookieStr.match(/(?:CloudFront-)?Policy=([^;]+)/);
    if (!pm || !pm[1]) return null;
    const decoded = base64UrlDecode(pm[1]).toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(decoded);
    return (json.Statement && json.Statement[0] && json.Statement[0].Resource) || null;
  } catch (e) {
    return null;
  }
}
function buildDashUrl(resource, quality) {
  if (!resource) return null;
  let url = String(resource).replace(/\/\*$/, "");
  if (quality) {
    url = url.replace(/_(\d+)_(h26\d|hevc|h264|avc)(_\d+)?$/, `_${quality}_$2$3`);
  }
  return `${url}/index.mpd`;
}

// [NEW] fetchDubDetailPaths - mirrors Smali fetchDubDetailPaths
function fetchDubDetailPaths(detailPath) {
  return __async(this, null, function* () {
    try {
      const url = `${API_BASE_DETAIL}/wefeed-h5api-bff/detail?detailPath=${encodeURIComponent(detailPath)}`;
      const res = yield fetch(url, {
        headers: {
          "Accept": "application/json",
          "Origin": "https://movie-box.co",
          "Referer": "https://mzfi.me/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
          "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}"
        }
      });
      if (!res.ok) return {};
      const root = yield res.json();
      const dubs = root && root.data && root.data.subject ? root.data.subject.dubs : null;
      const map = {};
      if (Array.isArray(dubs)) {
        for (const d of dubs) {
          if (!d || !d.subjectId) continue;
          const id = String(d.subjectId);
          const path = d.detailPath;
          if (path && String(path).trim()) map[id] = path;
        }
      }
      return map;
    } catch (e) {
      return {};
    }
  });
}

// [NEW] resolve detail path for a subjectId
function resolveDetailPath(subjectId, dubPaths) {
  if (dubPaths && dubPaths[subjectId]) return dubPaths[subjectId];
  // Fallback: subjectId as-is (works for a lot of titles)
  return subjectId;
}

// src/moviebox/index.js
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] === Querying TMDB ${tmdbId} type=${mediaType} S${seasonNum}E${episodeNum} ===`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) {
      console.log("[MovieBox] TMDB details failed");
      return [];
    }
    let subjects = yield searchMovieBox(details.title);
    console.log(`[MovieBox] Search "${details.title}" → ${subjects.length} results`);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      console.log(`[MovieBox] Fallback search "${details.originalTitle}" → ${subjects.length} results`);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      console.log(`[MovieBox] Best match: "${bestMatch.title}" (${bestMatch.year || bestMatch.releaseDate || "?"}) id=${bestMatch.subjectId}`);
      const s = mediaType === "tv" ? seasonNum : 0;
      const e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(bestMatch.subjectId, s, e, details.title, mediaType);
    }
    console.log(`[MovieBox] ✗ No matching content found for: ${details.title}`);
    return [];
  });
}
function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const response = yield movieBoxRequest("POST", url, body);
    if (response && response.data && response.data.data && response.data.data.results) {
      let allSubjects = [];
      response.data.data.results.forEach((group) => {
        if (group.subjects) allSubjects = allSubjects.concat(group.subjects);
      });
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

// [NEW] the new play URL builder (mirrors Smali playBase string)
function buildPlayUrl(subDomain, subjectId, season, episode, detailPath) {
  return `${subDomain}/wefeed-h5api-bff/subject/play?subjectId=${subjectId}&se=${season}&ep=${episode}` +
         `&detailPath=${encodeURIComponent(detailPath)}` +
         `&streamSignType=1&supportCodecs%5Bhevc%5D=1&supportCodecs%5Bh264%5D=1`;
}

// [NEW] headers for /subject/play endpoint (mirrors Smali loadLinks netHeaders)
function buildPlayHeaders(token) {
  const h = {
    "User-Agent": PLAY_UA,
    "Referer": "", // filled by caller (uses subDomain)
    "Accept": "application/json",
    "x-client-info": "{\"timezone\":\"Asia/Calcutta\"}",
    "x-request-lang": "en",
    "x-vip-restrict": "0",
    "x-no-high-risk-restrict": "0",
    "x-source": ""
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    // 1. subject detail (to get dubs)
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes || !detailRes.data || !detailRes.data.data) {
      console.log("[MovieBox] Subject fetch failed");
      return [];
    }
    const subjectData = detailRes.data.data;
    console.log(`[MovieBox] Subject: "${subjectData.title}" (${subjectData.releaseDate || "?"})`);

    // 2. Get token once
    const token = yield getCachedToken();

    // 3. Build subject list (original + dubs)
    const subjectIds = [];
    let originalLang = "Original";
    let originalDetailPath = null;
    const dubs = subjectData.dubs;
    if (Array.isArray(dubs)) {
      for (const dub of dubs) {
        if (dub.subjectId == subjectId) {
          originalLang = dub.lanName || "Original";
          if (dub.detailPath) originalDetailPath = dub.detailPath;
        } else {
          subjectIds.push({ id: String(dub.subjectId), lang: dub.lanName || "Unknown", detailPath: dub.detailPath || null });
        }
      }
    }
    subjectIds.unshift({ id: String(subjectId), lang: originalLang, detailPath: originalDetailPath });

    // 4. If we don't have a detailPath yet, fetch dub detail paths once via one of the dubs (or original)
    let dubPaths = {};
    if (subjectIds.length && subjectIds[0].detailPath) {
      // We can use it as the seed for fetchDubDetailPaths
      dubPaths = yield fetchDubDetailPaths(subjectIds[0].detailPath);
      console.log(`[MovieBox] dubPaths resolved: ${Object.keys(dubPaths).length}`);
    }

    console.log(`[MovieBox] Trying ${subjectIds.length} subjects`);
    const allStreams = [];
    const seen = new Set();

    for (const item of subjectIds) {
      try {
        const detailPath = item.detailPath || resolveDetailPath(item.id, dubPaths);
        if (!detailPath) {
          console.log(`[MovieBox]   no detailPath for ${item.lang} id=${item.id}`);
          continue;
        }

        // 5. We need a subDomain. The new APK uses the value from extractPolicyResource() on a previous response.
        //    First time through, we don't have one yet -- we try the main API host as subDomain and
        //    let the response give us a signCookie via urlprefix / Policy to build the CDN URL.
        const subDomain = item.subDomain || API_BASE;
        const playUrl = buildPlayUrl(subDomain, item.id, season, episode, detailPath);
        console.log(`[MovieBox] → /subject/play ${item.lang} id=${item.id} se=${season} ep=${episode}`);

        const headers = buildPlayHeaders(token);
        headers["Referer"] = `${subDomain}/movies/${detailPath}?id=${item.id}&type=/movie/detail&detailSe=&detailEp=&lang=en`;

        const playRes = yield movieBoxRequest("GET", playUrl, null, headers);
        if (!playRes || !playRes.data || !playRes.data.data) {
          console.log(`[MovieBox]   play empty`);
          continue;
        }

        const playData = playRes.data.data;
        const buckets = [
          { key: "dash", label: "DASH" },
          { key: "hls", label: "HLS" },
          { key: "streams", label: "MP4" }
        ];

        for (const bucket of buckets) {
          const arr = playData[bucket.key];
          if (!Array.isArray(arr) || arr.length === 0) continue;

          for (const stream of arr) {
            if (!stream) continue;

            // Try signCookie FIRST
            const resource = extractPolicyResource(stream.signCookie);
            if (resource) {
              console.log(`[MovieBox]   🔓 resource=${resource} (${bucket.label})`);
              const resolutions = String(stream.resolutions || "")
                .split(",").map((x) => x.trim()).filter(Boolean);
              const list = resolutions.length ? resolutions : ["1080"];
              const streamId = stream.id || `${item.id}|${season}|${episode}`;
              const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);

              for (const r of list) {
                const dashUrl = buildDashUrl(resource, r);
                if (!dashUrl) continue;
                if (seen.has(dashUrl)) continue;
                seen.add(dashUrl);
                console.log(`[MovieBox]   ✓ added: ${r}p ${bucket.label}`);
                allStreams.push({
                  name: `MovieBox ${item.lang}`,
                  title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${r}p [${bucket.label}]`,
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

            // No resource -- raw URL fallback, only if not decoy
            if (!stream.url || isDecoyUrl(stream.url)) {
              if (stream.url) console.log(`[MovieBox]   ⚠️ decoy, no resource decoded`);
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

        // If dash had resources, we got what we need for this subject
      } catch (err) {
        console.error(`[MovieBox Stream Fetch Error] ID: ${item.id}`, err.message);
      }
    }
    console.log(`[MovieBox] === Total: ${allStreams.length} streams ===`);
    return allStreams;
  });
}

// [CHANGED] new captions endpoints (stream-captions + ext-captions)
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

    // 1) get-stream-captions
    try {
      const url = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const res = yield movieBoxRequest("GET", url, null);
      const caps = res && res.data && res.data.data && res.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch (e) {}

    // 2) get-ext-captions  [NEW]
    try {
      const url = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const res = yield movieBoxRequest("GET", url, null);
      const caps = res && res.data && res.data.data && res.data.data.extCaptions;
      if (Array.isArray(caps)) caps.forEach(push);
    } catch (e) {}

    return subtitles;
  });
}
module.exports = { getStreams };