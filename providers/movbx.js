/**
 * moviebox - Built from src/moviebox/
 * Generated: 2026-07-08T18:40:52.588Z
 * Updated: signCookie decode FIRST, then decoy check
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
var API_BASE = "https://api3.aoneroom.com";
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
var PACKAGE_INFO = {
  package_name: "com.community.mbox.in",
  version_name: "3.0.03.0529.03",
  version_code: 50020042
};

// Decoy markers (the "please update app" trap)
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
    const url = `${API_BASE}/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1`;
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
function movieBoxRequest(_0, _1) {
  return __async(this, arguments, function* (method, url, body = null, customHeaders = {}, isTokenFetch = false) {
    initializeSession();
    const timestamp = Date.now();
    const headerContentType = customHeaders["Content-Type"] || (body ? "application/json; charset=utf-8" : "application/json");
    const accept = customHeaders["Accept"] || "application/json";
    const xTrSignature = generateXTrSignature(method, accept, headerContentType, url, body, false, timestamp);
    const xClientInfo = JSON.stringify(__spreadProps(__spreadValues({}, PACKAGE_INFO), {
      os: "android", os_version: "16", device_id: deviceId, install_store: "ps",
      gaid: "d7578036d13336cc", brand: selectedBrand.toLowerCase(), model: selectedModel,
      system_language: "en", net: "NETWORK_WIFI", region: "IN",
      timezone: "Asia/Calcutta", sp_code: ""
    }));
    const headers = __spreadValues({
      "Accept": accept,
      "Content-Type": headerContentType,
      "x-client-token": generateXClientToken(timestamp),
      "x-tr-signature": xTrSignature,
      "User-Agent": `${PACKAGE_INFO.package_name}/${PACKAGE_INFO.version_code} (Linux; U; Android 16; en_IN; ${selectedModel}; Build/BP22.250325.006; Cronet/133.0.6876.3)`,
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

// ─────────────────────────────────────────────────────────────
// Decoy + signCookie helpers
// ─────────────────────────────────────────────────────────────
function isDecoyUrl(url) {
  if (!url) return true;
  const u = String(url).toLowerCase();
  return u.includes(DECOY_HASH) || u.includes(DECOY_PATH);
}
function extractPolicyResource(signCookie) {
  if (!signCookie) return null;
  try {
    const m = signCookie.match(/CloudFront-Policy=([^;]+)/);
    if (!m) return null;
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const decoded = import_crypto_js.default.enc.Base64.parse(b64).toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(decoded);
    return (json.Statement && json.Statement[0] && json.Statement[0].Resource) || null;
  } catch (e) {
    return null;
  }
}
function buildDashUrl(resource, quality) {
  if (!resource) return null;
  let url = resource.replace(/\/\*$/, "");
  if (quality) {
    url = url.replace(/_(\d+)_(h26\d|hevc|h264|avc)(_\d+)?$/, `_${quality}_$2$3`);
  }
  return `${url}/index.mpd`;
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

// ─────────────────────────────────────────────────────────────
// getStreamLinks — decode signCookie FIRST, decoy check SECOND
// ─────────────────────────────────────────────────────────────
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes || !detailRes.data || !detailRes.data.data) {
      console.log("[MovieBox] Subject fetch failed");
      return [];
    }
    const subjectData = detailRes.data.data;
    console.log(`[MovieBox] Subject: "${subjectData.title}" (${subjectData.releaseDate || "?"})`);

    const subjectIds = [];
    let originalLang = "Original";
    const dubs = subjectData.dubs;
    if (Array.isArray(dubs)) {
      dubs.forEach((dub) => {
        if (dub.subjectId == subjectId) {
          originalLang = dub.lanName || "Original";
        } else {
          subjectIds.push({ id: dub.subjectId, lang: dub.lanName });
        }
      });
    }
    subjectIds.unshift({ id: subjectId, lang: originalLang });

    console.log(`[MovieBox] Trying ${subjectIds.length} subjects`);
    const allStreams = [];
    const seen = new Set();

    for (const item of subjectIds) {
      try {
        const playUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${item.id}&se=${season}&ep=${episode}`;
        console.log(`[MovieBox] → play-info ${item.lang} id=${item.id}`);
        const playRes = yield movieBoxRequest("GET", playUrl, null);
        if (!playRes || !playRes.data || !playRes.data.data) {
          console.log(`[MovieBox]   play-info failed/empty`);
          continue;
        }
        const playData = playRes.data.data;
        const streamsList = playData.streams;
        const detectorsList = playData.resourceDetectors;
        console.log(`[MovieBox]   streams=${Array.isArray(streamsList) ? streamsList.length : 0} detectors=${Array.isArray(detectorsList) ? detectorsList.length : 0}`);

        if (Array.isArray(streamsList) && streamsList.length > 0) {
          for (const stream of streamsList) {
            if (!stream.url) continue;

            // ★★★ KEY FIX: decode signCookie FIRST — even if url is decoy,
            // the real CDN path lives inside CloudFront-Policy cookie
            const resource = extractPolicyResource(stream.signCookie);
            if (resource) {
              console.log(`[MovieBox]   🔓 resource=${resource}`);
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
                console.log(`[MovieBox]   ✓ added: ${r}p`);
                allStreams.push({
                  name: "MovieBox",
                  title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${r}p [DASH]`,
                  url: dashUrl,
                  quality: `${r}p`,
                  headers: {
                    "Referer": API_BASE,
                    "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)`,
                    "Cookie": stream.signCookie.replace(/;\s*$/, "").trim()
                  },
                  subtitles,
                  provider: "moviebox"
                });
              }
              continue;
            }

            // No signCookie resource — only use raw URL if not decoy
            if (isDecoyUrl(stream.url)) {
              console.log(`[MovieBox]   ⚠️ decoy (no resource decoded, url matched)`);
              continue;
            }

            // Non-decoy URL without signCookie (rare)
            const formatType = getFormatType(stream.url);
            const qualLabel = stream.resolutions || stream.quality || "Auto";
            const qualNum = parseQualityNumber(qualLabel);
            const quality = qualNum ? `${qualNum}p` : "Auto";
            const streamId = stream.id || `${item.id}|${season}|${episode}`;
            const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);
            if (seen.has(stream.url)) continue;
            seen.add(stream.url);
            allStreams.push({
              name: "MovieBox",
              title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${quality} [${formatType}]`,
              url: stream.url,
              quality,
              headers: __spreadValues({
                "Referer": API_BASE,
                "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)`
              }, stream.signCookie ? { "Cookie": stream.signCookie } : {}),
              subtitles,
              provider: "moviebox"
            });
          }
        } else if (Array.isArray(detectorsList) && detectorsList.length > 0) {
          for (const detector of detectorsList) {
            if (Array.isArray(detector.resolutionList)) {
              for (const video of detector.resolutionList) {
                if (!video.resourceLink) continue;
                if (isDecoyUrl(video.resourceLink)) continue;
                const quality = video.resolution ? `${video.resolution}p` : "Auto";
                const se = video.se || season;
                const ep = video.ep || episode;
                if (seen.has(video.resourceLink)) continue;
                seen.add(video.resourceLink);
                allStreams.push({
                  name: "MovieBox",
                  title: `${mediaTitle} S${se}E${ep} (${item.lang}) - ${quality} [Fallback]`,
                  url: video.resourceLink,
                  quality,
                  headers: {
                    "Referer": API_BASE,
                    "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; MovieBox; Build/BP22.250325.006; Cronet/133.0.6876.3)`
                  },
                  provider: "moviebox"
                });
              }
            }
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

function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const subtitles = [];
    try {
      const streamCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${streamId}`;
      const capRes = yield movieBoxRequest("GET", streamCapUrl, null);
      if (capRes && capRes.data && capRes.data.data && Array.isArray(capRes.data.data.extCaptions)) {
        capRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.language || cap.lanName || cap.lan || "en",
              name: `${cap.lanName || cap.language || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {}
    try {
      const extCapUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${streamId}&episode=0`;
      const extRes = yield movieBoxRequest("GET", extCapUrl, null);
      if (extRes && extRes.data && extRes.data.data && Array.isArray(extRes.data.data.extCaptions)) {
        extRes.data.data.extCaptions.forEach((cap) => {
          if (cap.url) {
            subtitles.push({
              url: cap.url,
              language: cap.lan || cap.lanName || cap.language || "en",
              name: `${cap.lanName || cap.lan || "Subtitle"} (${langLabel})`,
              headers: { "Referer": API_BASE }
            });
          }
        });
      }
    } catch (e) {}
    return subtitles;
  });
}
module.exports = { getStreams };