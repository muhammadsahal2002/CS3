/**
 * castle - Full audio & video quality support
 * Matches Kotlin smali logic: All tracks + All resolutions
 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
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
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ====================== CONSTANTS ======================
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var CASTLE_BASE = "https://api.hlowb.com";
var PKG = "com.external.castle";
var CHANNEL = "IndiaA";
var CLIENT = "1";
var LANG = "en-US";
var APK_SIGN_KEY = "ED0955EB04E67A1D9F3305B95454FED485261475";

var API_HEADERS = {
  "User-Agent": "okhttp/4.9.3",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "Keep-Alive",
  "Referer": CASTLE_BASE
};

var PLAYBACK_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "identity",
  "Connection": "keep-alive",
  "Sec-Fetch-Dest": "video",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
  "DNT": "1"
};

// ====================== HTTP ======================
function makeRequest(_0) {
  return __async(this, arguments, function* (url, options = {}) {
    try {
      const response = yield fetch(url, {
        method: options.method || "GET",
        headers: __spreadValues(__spreadValues({}, API_HEADERS), options.headers),
        body: options.body
      });
      if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + response.statusText);
      }
      return response;
    } catch (error) {
      console.error("[Castle] Request failed: " + error.message);
      throw error;
    }
  });
}

function extractCipherFromResponse(response) {
  return __async(this, null, function* () {
    const text = yield response.text();
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Empty response");
    try {
      const json = JSON.parse(trimmed);
      if (json && json.data && typeof json.data === "string") {
        return json.data.trim();
      }
    } catch (e) {}
    return trimmed;
  });
}

function extractDataBlock(obj) {
  if (obj && obj.data && typeof obj.data === "object") return obj.data;
  return obj || {};
}

// Castle ids like 10225090559984575 are bigger than JavaScript can hold exactly (JSON.parse turns
// them into ...576 and the server then answers "not found"). Keep long numbers as strings.
function safeParse(text) {
  return JSON.parse(String(text).replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
}

// ====================== TMDB ======================
// [UPDATED] also returns original/alternative titles, and for series the season's own name + year
function getTMDBDetails(tmdbId, mediaType, seasonNum) {
  return __async(this, null, function* () {
    if (String(tmdbId).startsWith("tt")) {
      return { title: "Unknown", year: null, tmdbId: tmdbId, titles: [], seasonTitles: [], seasonYear: null };
    }

    try {
      const endpoint = mediaType === "tv" ? "tv" : "movie";
      const url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY + "&append_to_response=alternative_titles";
      const response = yield makeRequest(url);
      const data = yield response.json();

      const title = mediaType === "tv" ? data.name : data.title;
      const original = mediaType === "tv" ? data.original_name : data.original_title;
      const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
      const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;

      const list = [title, original];
      const alt = data.alternative_titles ? (data.alternative_titles.titles || data.alternative_titles.results || []) : [];
      for (const a of alt) {
        if (a && a.title && /^(IN|US|GB)$/.test(a.iso_3166_1 || "") && list.length < 12) list.push(a.title);
      }
      const titles = [];
      list.forEach(t => { if (t && titles.indexOf(t) < 0) titles.push(t); });

      const info = {
        title: title || "Unknown", year: year, tmdbId: tmdbId,
        originalTitle: original || "", titles: titles, seasonTitles: [], seasonYear: null
      };

      if (mediaType === "tv" && seasonNum) {
        try {
          const sres = yield makeRequest(TMDB_BASE_URL + "/tv/" + tmdbId + "/season/" + seasonNum + "?api_key=" + TMDB_API_KEY);
          const sd = yield sres.json();
          const sname = String(sd.name || "").trim();
          info.seasonYear = sd.air_date ? parseInt(String(sd.air_date).split("-")[0]) : null;
          if (sname && !/^season\s*\d+$/i.test(sname)) {
            const bare = sname.replace(/^season\s*\d+\s*[:\-]?\s*/i, "").trim() || sname;
            [info.title + " " + bare, bare, sname].forEach(t => {
              if (t && info.seasonTitles.indexOf(t) < 0) info.seasonTitles.push(t);
              if (t && info.titles.indexOf(t) < 0) info.titles.push(t);
            });
          }
        } catch (e) {}
      }
      return info;
    } catch (e) {
      return { title: "Unknown", year: null, tmdbId: tmdbId, titles: [], seasonTitles: [], seasonYear: null };
    }
  });
}

// ====================== DECRYPT ======================
function decryptCastle(encryptedB64, securityKeyB64) {
  return __async(this, null, function* () {
    try {
      const CryptoJS = require("crypto-js");

      if (typeof __crypto_aes_decrypt_raw !== "undefined") {
        const originalDecrypt = CryptoJS.AES.decrypt;
        CryptoJS.AES.decrypt = function(cipher, key, options) {
          try {
            const wordArrayToBytes = (wordArray) => {
              const bytes = new Uint8Array(wordArray.sigBytes);
              for (let i = 0; i < wordArray.sigBytes; i++) {
                bytes[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
              }
              return bytes;
            };
            const toUint8Array = (data) => {
              if (data instanceof Uint8Array) return data;
              if (data instanceof ArrayBuffer) return new Uint8Array(data);
              if (data && typeof data.length === "number") return new Uint8Array(Array.prototype.slice.call(data));
              return new Uint8Array(0);
            };
            const data = typeof cipher === "string"
              ? new Uint8Array(Array.from(atob(cipher), c => c.charCodeAt(0)))
              : (cipher.ciphertext ? wordArrayToBytes(cipher.ciphertext) : toUint8Array(cipher));
            const kBytes = wordArrayToBytes(key);
            const ivBytes = (options && options.iv) ? wordArrayToBytes(options.iv) : new Uint8Array(0);

            const keyArg = typeof Int8Array !== "undefined" ? new Int8Array(kBytes.buffer) : kBytes;
            const ivArg = typeof Int8Array !== "undefined" ? new Int8Array(ivBytes.buffer) : ivBytes;
            const dataArg = typeof Int8Array !== "undefined" ? new Int8Array(data.buffer) : data;

            const resBytes = __crypto_aes_decrypt_raw("AES-CBC", keyArg, ivArg, dataArg);
            const plain = new TextDecoder().decode(resBytes);
            return { toString: function() { return plain; } };
          } catch (err) {
            return originalDecrypt.call(CryptoJS.AES, cipher, key, options);
          }
        };
      }

      const CASTLE_SUFFIX = "T!BgJB";
      const securityKeyWords = CryptoJS.enc.Base64.parse(securityKeyB64);
      const suffixWords = CryptoJS.enc.Utf8.parse(CASTLE_SUFFIX);
      const keyMaterial = securityKeyWords.concat(suffixWords);

      let finalKey;
      if (keyMaterial.sigBytes < 16) {
        const padding = CryptoJS.lib.WordArray.create(new Array(16 - keyMaterial.sigBytes).fill(0));
        finalKey = keyMaterial.concat(padding);
      } else if (keyMaterial.sigBytes > 16) {
        finalKey = CryptoJS.lib.WordArray.create(keyMaterial.words.slice(0, 4), 16);
      } else {
        finalKey = keyMaterial;
      }

      const iv = finalKey;
      const decrypted = CryptoJS.AES.decrypt(encryptedB64, finalKey, {
        iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });

      const result = decrypted.toString(CryptoJS.enc.Utf8);
      if (!result) throw new Error("Decryption resulted in empty string");
      return result;
    } catch (error) {
      console.error("[Castle] Decryption failed: " + error.message);
      throw error;
    }
  });
}

// ====================== API ======================
function getSecurityKey() {
  return __async(this, null, function* () {
    const url = CASTLE_BASE + "/v0.1/system/getSecurityKey/1?channel=" + CHANNEL + "&clientType=" + CLIENT + "&lang=" + LANG;
    const response = yield makeRequest(url);
    const data = yield response.json();
    if (data.code !== 200 || !data.data) throw new Error("Security key API error");
    return data.data;
  });
}

function searchCastle(securityKey, keyword, page = 1, size = 30) {
  return __async(this, null, function* () {
    const params = new URLSearchParams({
      channel: CHANNEL,
      clientType: CLIENT,
      keyword,
      lang: LANG,
      mode: "1",
      packageName: PKG,
      page: page.toString(),
      size: size.toString()
    });
    const url = CASTLE_BASE + "/film-api/v1.1.0/movie/searchByKeyword?" + params.toString();
    const response = yield makeRequest(url);
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return safeParse(decrypted);
  });
}

function getDetails(securityKey, movieId) {
  return __async(this, null, function* () {
    const url = CASTLE_BASE + "/film-api/v1.9.9/movie?channel=" + CHANNEL +
                "&clientType=" + CLIENT + "&lang=" + LANG +
                "&movieId=" + movieId + "&packageName=" + PKG;
    const response = yield makeRequest(url);
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return safeParse(decrypted);
  });
}

function getVideo2(securityKey, movieId, episodeId, resolution = 2, languageId = null) {
  return __async(this, null, function* () {
    const url = CASTLE_BASE + "/film-api/v2.0.1/movie/getVideo2?clientType=" + CLIENT +
                "&packageName=" + PKG + "&channel=" + CHANNEL + "&lang=" + LANG;

    const body = {
      mode: "1",
      appMarket: "GuanWang",
      clientType: CLIENT,
      woolUser: "false",
      apkSignKey: APK_SIGN_KEY,
      androidVersion: "13",
      movieId: movieId.toString(),
      episodeId: episodeId.toString(),
      isNewUser: "true",
      resolution: resolution.toString(),
      packageName: PKG
    };

    if (languageId !== null) {
      body.languageId = languageId.toString();
    }

    const response = yield makeRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return safeParse(decrypted);
  });
}

// ====================== HELPERS ======================
function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

// ---------- [UPDATED] title matching ----------
var CS_TAG_RE = /^(hindi|english|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|dubbed|dual audio|multi audio|\d{4}|season\s*\d+|s\d+|part\s*\d+)\b/i;
var CS_STOP = { the: 1, a: 1, an: 1, and: 1, mtv: 1, netflix: 1, bbc: 1, hbo: 1, amazon: 1 };

function csClean(t) {
  t = String(t || "");
  var prev;
  do {
    prev = t;
    t = t.replace(/\s*[\(\[]([^\)\]]*)[\)\]]\s*$/, function(m, inner) { return CS_TAG_RE.test(inner.trim()) ? "" : m; });
  } while (t !== prev);
  return t.replace(/[\s:\-]+(season\s*\d+|s\d{1,2})\s*$/i, "");
}
function csTokens(s) {
  s = String(s || "").toLowerCase();
  if (s.normalize) s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  return s ? s.split(" ").filter(function(w) { return !CS_STOP[w]; }) : [];
}
function csScore(candTitle, wants) {
  var a = csTokens(csClean(candTitle));
  if (!a.length) return 0;
  var best = 0;
  for (var i = 0; i < wants.length; i++) {
    var b = csTokens(wants[i]);
    if (!b.length) continue;
    if (a.join(" ") === b.join(" ")) return 100;
    var inB = {}, seen = {}, inter = 0;
    b.forEach(function(x) { inB[x] = 1; });
    a.forEach(function(x) { if (inB[x] && !seen[x]) { inter++; seen[x] = 1; } });
    var s = Math.round(100 * inter / (a.length + b.length - inter));
    if (s > best) best = s;
  }
  return best;
}
// season number written in the title ("... Season 21", "... S21"), or null
function csTitleSeason(t) {
  var m = /\bseason\s*(\d+)\b/i.exec(t || "") || /\bS(\d{1,2})\b/.exec(t || "");
  return m ? parseInt(m[1], 10) : null;
}

// [UPDATED] find the right Castle entry. Several search terms, scored by title, then (for series)
// checked against the entry's real season list. Returns { movieId, details }.
function findCastleMatch(securityKey, tmdbInfo, mediaType, seasonNum) {
  return __async(this, null, function* () {
    const isTv = mediaType === "tv";
    const wantSeason = Number(seasonNum) || 1;
    const wants = (tmdbInfo.titles && tmdbInfo.titles.length) ? tmdbInfo.titles : [tmdbInfo.title];

    // search terms: plain title first (what the real app sends), then season name / original title
    const terms = [];
    const seenTerm = {};
    const addTerm = (t) => {
      const q = String(t || "").trim();
      const k = csTokens(q).join(" ");
      if (!q || !k || seenTerm[k]) return;
      seenTerm[k] = 1;
      terms.push(q);
    };
    addTerm(tmdbInfo.title);
    if (isTv) (tmdbInfo.seasonTitles || []).forEach(addTerm);
    addTerm(tmdbInfo.originalTitle);
    (tmdbInfo.titles || []).slice(2, 4).forEach(addTerm);
    const searchTerms = terms.slice(0, 4);
    if (!isTv && tmdbInfo.year) searchTerms.push(tmdbInfo.title + " " + tmdbInfo.year);

    const rowsById = {};
    let ranked = [];

    const rank = () => {
      ranked = Object.keys(rowsById).map(id => {
        const item = rowsById[id];
        const raw = item.title || item.name || "";
        const ts = csScore(raw, wants);
        const sn = csTitleSeason(raw);
        let score = ts;
        if (isTv && sn !== null) score += (sn === wantSeason) ? 30 : -40;
        if (!isTv && /\bseason\b/i.test(raw)) score -= 20;
        return { id: id, raw: raw, ts: ts, sn: sn, score: score,
                 seasonHit: isTv && csScore(raw, tmdbInfo.seasonTitles || []) >= 85 };
      });
      ranked.sort((a, b) => b.score - a.score);
    };

    for (const term of searchTerms) {
      let result;
      try { result = yield searchCastle(securityKey, term); } catch (e) { continue; }
      const rows = extractDataBlock(result).rows || [];
      console.log("[Castle] search \"" + term + "\" -> " + rows.length + " rows");
      for (const item of rows) {
        const id = item.id || item.redirectId || item.redirectIdStr;
        if (id && !rowsById[String(id)]) rowsById[String(id)] = item;
      }
      rank();
      if (ranked.length && ranked[0].ts >= 85) break;
    }

    if (ranked.length === 0) throw new Error("No search results found");
    ranked.slice(0, 6).forEach(r => console.log("[Castle]   cand \"" + r.raw + "\" title=" + r.ts + " score=" + r.score));

    if (!isTv) {
      const best = ranked[0];
      if (best.ts < 60) throw new Error("No matching movie for \"" + tmdbInfo.title + "\"");
      return { movieId: best.id, details: null };
    }

    // series: accept the first good candidate that really has the requested season
    const cands = ranked.filter(r => r.ts >= 40).slice(0, 4);
    for (const c of cands) {
      let d;
      try { d = yield getDetails(securityKey, c.id); } catch (e) { continue; }
      const data = extractDataBlock(d);
      const seasons = data.seasons || [];
      const has = seasons.some(s => Number(s.number) === wantSeason);
      const single = seasons.length === 0 && (c.sn === wantSeason || c.seasonHit || (wantSeason === 1 && c.ts >= 70));
      console.log("[Castle]   check \"" + c.raw + "\" seasons=[" + seasons.map(s => s.number).join(",") + "] -> " + ((has || single) ? "OK" : "no season " + wantSeason));
      if (has || single) return { movieId: c.id, details: d };
    }
    throw new Error("No Castle entry has season " + wantSeason + " of \"" + tmdbInfo.title + "\"");
  });
}

function getQualityValue(quality) {
  if (!quality) return 0;
  const clean = quality.toString().toLowerCase().replace(/^(sd|hd|fhd|uhd|4k)\s*/i, "").replace(/p$/, "").trim();
  const map = { "4k": 2160, "2160": 2160, "1440": 1440, "1080": 1080, "720": 720, "480": 480, "360": 360, "240": 240 };
  if (map[clean]) return map[clean];
  const num = parseInt(clean);
  return isNaN(num) ? 0 : num;
}

function formatSize(sizeValue) {
  if (typeof sizeValue !== "number" || sizeValue <= 0) return "Unknown";
  if (sizeValue > 1e9) return (sizeValue / 1e9).toFixed(2) + " GB";
  return (sizeValue / 1e6).toFixed(0) + " MB";
}

function resolutionToQuality(resolution) {
  const map = { 1: "480p", 2: "720p", 3: "1080p" };
  return map[resolution] || resolution + "p";
}

// ====================== PROCESS VIDEO ======================
function processVideoResponse(videoData, mediaInfo, seasonNum, episodeNum, resolution, languageInfo) {
  const streams = [];
  const data = extractDataBlock(videoData);
  const videoUrl = data.videoUrl;
  if (!videoUrl) return streams;

  const subtitles = [];
  if (data.subtitles && Array.isArray(data.subtitles)) {
    data.subtitles.forEach(sub => {
      if (sub.url) {
        subtitles.push({
          url: sub.url,
          language: sub.abbreviate || "Unknown",
          name: sub.title || sub.abbreviate || "Unknown",
          headers: PLAYBACK_HEADERS
        });
      }
    });
  }

  let mediaTitle = mediaInfo.title || "Unknown";
  if (mediaInfo.year) mediaTitle += " (" + mediaInfo.year + ")";
  if (seasonNum && episodeNum) {
    mediaTitle = mediaInfo.title + " S" + String(seasonNum).padStart(2, "0") + "E" + String(episodeNum).padStart(2, "0");
  }

  const quality = resolutionToQuality(resolution);

  if (data.videos && Array.isArray(data.videos)) {
    for (const video of data.videos) {
      let videoQuality = (video.resolutionDescription || video.resolution || quality).toString();
      videoQuality = videoQuality.replace(/^(SD|HD|FHD)\s+/i, "");
      const streamName = languageInfo ? "Castle " + languageInfo + " - " + videoQuality : "Castle - " + videoQuality;
      streams.push({
        name: streamName,
        title: mediaTitle,
        url: video.url || videoUrl,
        quality: videoQuality,
        size: formatSize(video.size),
        headers: PLAYBACK_HEADERS,
        provider: "castle",
        subtitles: subtitles
      });
    }
  } else {
    const streamName = languageInfo ? "Castle " + languageInfo + " - " + quality : "Castle - " + quality;
    streams.push({
      name: streamName,
      title: mediaTitle,
      url: videoUrl,
      quality: quality,
      size: formatSize(data.size),
      headers: PLAYBACK_HEADERS,
      provider: "castle",
      subtitles: subtitles
    });
  }
  return streams;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    try {
      const tmdbInfo = yield getTMDBDetails(tmdbId, mediaType, seasonNum);
      const securityKey = yield getSecurityKey();
      const match = yield findCastleMatch(securityKey, tmdbInfo, mediaType, seasonNum);
      const movieId = match.movieId;

      let details = match.details || (yield getDetails(securityKey, movieId));
      let currentMovieId = movieId;

      if (mediaType === "tv" && seasonNum) {
        const data = extractDataBlock(details);
        const seasons = data.seasons || [];
        const season = seasons.find(s => Number(s.number) === Number(seasonNum));
        if (season && season.movieId && String(season.movieId) !== String(movieId)) {
          details = yield getDetails(securityKey, season.movieId.toString());
          currentMovieId = season.movieId.toString();
        }
      }

      const detailsData = extractDataBlock(details);
      const episodes = detailsData.episodes || [];

      let episodeId = null;

      if (mediaType === "tv" && episodeNum) {
        let ep = episodes.find(e => Number(e.number) === Number(episodeNum));
        if (!ep && episodes.length >= episodeNum) {
          ep = episodes[episodeNum - 1];
        }
        if (ep && ep.id) episodeId = ep.id.toString();
      } else if (episodes.length > 0) {
        episodeId = episodes[0].id.toString();
      } else {
        episodeId = currentMovieId;
      }

      if (!episodeId) {
        return [];
      }

      const episode = episodes.find(e => e.id?.toString() === episodeId);
      const tracks = episode?.tracks || [];

      const allStreams = [];
      const resolutions = [2]; // 1080p, 720p, 480p

      let fetchedAny = false;

      // Try each track individually
      for (const track of tracks) {
        const langName = track.languageName || track.abbreviate || "Unknown";
        const langId = track.languageId;
        if (!langId) continue;

        for (const resolution of resolutions) {
          try {
            const videoData = yield getVideo2(securityKey, currentMovieId, episodeId, resolution, langId);
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, langName);
            if (streams.length > 0) {
              allStreams.push(...streams);
              fetchedAny = true;
            }
          } catch (e) {
            // Silently continue
          }
        }
      }

      // Fallback to shared method if no per-track streams
      if (!fetchedAny) {
        const allLanguageNames = tracks.map(t => t.languageName || t.abbreviate || "Unknown").join(", ");
        const firstTrack = tracks[0];
        const languageId = firstTrack ? firstTrack.languageId : null;

        for (const resolution of resolutions) {
          try {
            let videoData;
            if (languageId) {
              videoData = yield getVideo2(securityKey, currentMovieId, episodeId, resolution, languageId);
            } else {
              videoData = yield getVideo2(securityKey, currentMovieId, episodeId, resolution);
            }
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, allLanguageNames);
            if (streams.length > 0) {
              allStreams.push(...streams);
            }
          } catch (e) {
            // Silently continue
          }
        }
      }

      // Final fallback: try without any language
      if (allStreams.length === 0) {
        for (const resolution of resolutions) {
          try {
            const videoData = yield getVideo2(securityKey, currentMovieId, episodeId, resolution);
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution);
            if (streams.length > 0) allStreams.push(...streams);
          } catch (e) {
            // Silently continue
          }
        }
      }

      // Deduplicate by URL + quality + language
      const seen = new Set();
      const uniqueStreams = allStreams.filter(s => {
        const langMatch = s.name.match(/Castle\s*(.+?)\s*-\s*/);
        const lang = langMatch ? langMatch[1].trim() : "unknown";
        const key = s.url + "_" + s.quality + "_" + lang;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uniqueStreams.length > 0) {
        uniqueStreams.sort((a, b) => getQualityValue(b.quality) - getQualityValue(a.quality));
        return uniqueStreams;
      }

      return [];

    } catch (error) {
      console.error("[Castle] " + error.message);
      return [];
    }
  });
}

module.exports = { getStreams };
