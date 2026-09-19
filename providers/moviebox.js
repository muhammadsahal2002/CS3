/**
 * moviebox - Built from src/moviebox/
 * Fixed: decodes signCookie → real CDN URL → DASH manifests
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
  package_name: "com.community.oneroom",
  version_name: "4.0.03.0918.03",
  version_code: 50020129
};

// Decoy markers
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
  } catch { return 0; }
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
            return token;
          }
        } catch (e) {
          console.error("[MovieBox] Failed to parse x-user header", e);
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
    const u = new URL(url);
    path = u.pathname;
    const params = Array.from(u.searchParams.keys()).sort();
    if (params.length > 0) {
      query = params.map((key) => {
        const values = u.searchParams.getAll(key);
        return values.map((val) => `${key}=${val}`).join("&");
      }).join("&");
    }
  } catch {
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
            yield new Promise(r => setTimeout(r, 1000));
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
          } catch {}
        }
        return { data: parsed, headers: res.headers };
      } catch (err) {
        retries--;
        if (retries === 0) {
          console.error("[MovieBox Request Error]", err.message);
          return null;
        }
        yield new Promise(r => setTimeout(r, 1000));
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json"
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
// ★ NEW: Decoy + signCookie decoding
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
    const decoded = import_crypto_js.default.enc.Base64.parse(b64)
      .toString(import_crypto_js.default.enc.Utf8);
    const json = JSON.parse(decoded);
    return json.Statement?.[0]?.Resource || null;
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

// ─────────────────────────────────────────────────────────────
// src/moviebox/index.js
// ─────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  return __async(this, null, function* () {
    console.log(`[MovieBox] Querying streams for TMDB: ${tmdbId}, Type: ${mediaType}`);
    const details = yield fetchTmdbDetails(tmdbId, mediaType);
    if (!details) return [];
    let subjects = yield searchMovieBox(details.title);
    let bestMatch = findBestMatch(subjects, details.title, details.year, mediaType);
    if (!bestMatch && details.originalTitle && details.originalTitle !== details.title) {
      subjects = yield searchMovieBox(details.originalTitle);
      bestMatch = findBestMatch(subjects, details.originalTitle, details.year, mediaType);
    }
    if (bestMatch) {
      const s = mediaType === "tv" ? seasonNum : 0;
      const e = mediaType === "tv" ? episodeNum : 0;
      return yield getStreamLinks(bestMatch.subjectId, s, e, details.title, mediaType);
    }
    console.log(`[MovieBox] No matching content found: ${details.title}`);
    return [];
  });
}

function searchMovieBox(query) {
  return __async(this, null, function* () {
    const url = `${API_BASE}/wefeed-mobile-bff/subject-api/search/v2`;
    const body = JSON.stringify({ page: 1, perPage: 20, keyword: query });
    const response = yield movieBoxRequest("POST", url, body);
    if (response?.data?.data?.results) {
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

// ★★★ THE FIX ★★★
function getStreamLinks(subjectId, season = 0, episode = 0, mediaTitle = "", mediaType = "movie") {
  return __async(this, null, function* () {
    const subjectUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/get?subjectId=${subjectId}`;
    const detailRes = yield movieBoxRequest("GET", subjectUrl);
    if (!detailRes?.data?.data) return [];

    const subjectIds = [];
    let originalLang = "Original";
    const dubs = detailRes.data.data.dubs;
    if (Array.isArray(dubs)) {
      dubs.forEach((dub) => {
        if (dub.subjectId == subjectId) originalLang = dub.lanName || "Original";
        else subjectIds.push({ id: dub.subjectId, lang: dub.lanName || "Dub" });
      });
    }
    subjectIds.unshift({ id: subjectId, lang: originalLang });

    const allStreams = [];
    const seen = new Set();
    // Movies often need (0,0) OR (1,1) — try both
    const attempts = (season === 0 && episode === 0) ? [[0, 0], [1, 1]] : [[season, episode]];

    for (const item of subjectIds) {
      for (const [se, ep] of attempts) {
        try {
          const playUrl = `${API_BASE}/wefeed-mobile-bff/subject-api/play-info?subjectId=${item.id}&se=${se}&ep=${ep}`;
          const playRes = yield movieBoxRequest("GET", playUrl, null);
          if (!playRes?.data?.data) continue;
          const playData = playRes.data.data;

          if (Array.isArray(playData.streams) && playData.streams.length > 0) {
            for (const stream of playData.streams) {
              // ★ Decode signCookie → real CDN URL
              const resource = extractPolicyResource(stream.signCookie);
              const resolutions = String(stream.resolutions || "")
                .split(",").map(x => x.trim()).filter(Boolean);

              if (resource) {
                console.log(`[MovieBox] 🔓 Real CDN: ${resource}`);
                for (const r of (resolutions.length ? resolutions : ["1080"])) {
                  const dashUrl = buildDashUrl(resource, r);
                  if (!dashUrl) continue;
                  const key = `${dashUrl}`;
                  if (seen.has(key)) continue;
                  seen.add(key);

                  const streamId = stream.id || `${item.id}|${se}|${ep}`;
                  const subtitles = yield fetchSubtitles(item.id, streamId, item.lang);

                  allStreams.push({
                    name: "MovieBox",
                    title: `${mediaTitle}${season > 0 ? ` S${season}E${episode}` : ""} (${item.lang}) - ${r}p`,
                    url: dashUrl,
                    quality: `${r}p`,
                    format: "DASH",
                    headers: {
                      "Referer": API_BASE,
                      "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)`,
                      "Cookie": stream.signCookie.replace(/;\s*$/, "").trim()
                    },
                    subtitles,
                    provider: "moviebox"
                  });
                }
                break;  // Got real streams — stop trying alternates
              } else if (stream.url && !isDecoyUrl(stream.url)) {
                // Non-decoy URL without signCookie (rare)
                const key = stream.url;
                if (seen.has(key)) continue;
                seen.add(key);
                allStreams.push({
                  name: "MovieBox",
                  title: `${mediaTitle} (${item.lang}) - ${resolutions[0] || "Auto"}p`,
                  url: stream.url,
                  quality: resolutions[0] ? `${resolutions[0]}p` : "Auto",
                  format: getFormatType(stream.url),
                  headers: {
                    "Referer": API_BASE,
                    "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)`
                  },
                  subtitles: [],
                  provider: "moviebox"
                });
              } else if (stream.url) {
                console.log(`[MovieBox] ⚠️  Skipping decoy: ...${stream.url.slice(-40)}`);
              }
            }
          } else if (Array.isArray(playData.resourceDetectors)) {
            for (const detector of playData.resourceDetectors) {
              if (!Array.isArray(detector.resolutionList)) continue;
              for (const video of detector.resolutionList) {
                if (!video.resourceLink || isDecoyUrl(video.resourceLink)) continue;
                const key = video.resourceLink;
                if (seen.has(key)) continue;
                seen.add(key);
                allStreams.push({
                  name: "MovieBox",
                  title: `${mediaTitle} (${item.lang}) - ${video.resolution || "Auto"}p [Detector]`,
                  url: video.resourceLink,
                  quality: video.resolution ? `${video.resolution}p` : "Auto",
                  format: getFormatType(video.resourceLink),
                  headers: {
                    "Referer": API_BASE,
                    "User-Agent": `com.community.mbox.in/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)`
                  },
                  subtitles: [],
                  provider: "moviebox"
                });
              }
            }
          }
          if (allStreams.length > 0) break;
        } catch (err) {
          console.error(`[MovieBox Stream Error] ID: ${item.id}`, err.message);
        }
      }
      if (allStreams.length > 0) break;
    }
    console.log(`[MovieBox] Found ${allStreams.length} real stream(s)`);
    return allStreams;
  });
}

function fetchSubtitles(subjectId, streamId, langLabel) {
  return __async(this, null, function* () {
    const subtitles = [];
    const seen = new Set();
    const grab = function* (url, name) {
      try {
        const res = yield movieBoxRequest("GET", url, null);
        const caps = res?.data?.data?.extCaptions;
        if (!Array.isArray(caps)) return;
        for (const c of caps) {
          if (!c.url || seen.has(c.url)) continue;
          seen.add(c.url);
          subtitles.push({
            url: c.url,
            language: c.language || c.lanName || c.lan || "en",
            name: `${c.lanName || c.language || "Sub"} (${langLabel})`,
            headers: { "Referer": API_BASE }
          });
        }
      } catch (e) {}
    };
    yield* grab(`${API_BASE}/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=${subjectId}&streamId=${encodeURIComponent(streamId)}`, "stream");
    yield* grab(`${API_BASE}/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${subjectId}&resourceId=${encodeURIComponent(streamId)}&episode=0`, "ext");
    return subtitles;
  });
}

module.exports = { getStreams };