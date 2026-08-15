/**
 * castle - Updated to use official app endpoints
 * All resolutions (1080p, 720p, 480p) + All audio tracks
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

// ====================== CONSTANTS (UPDATED) ======================
var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE_URL = "https://api.themoviedb.org/3";
var CASTLE_BASE = "https://api.flwck.com";                   // new base
var PKG = "com.journey.indiab";                               // new package
var CHANNEL = "India2";                                       // new channel
var CLIENT = "1";
var LANG = "en-US";
var APK_SIGN_KEY = "3E9F4979E27C7A9ABB2688C38E6BABAD645BE135"; // new sign key

// Headers used for all requests (except video which adds extra)
var API_HEADERS = {
  "User-Agent": "okhttp/4.9.3", // keep same
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Connection": "Keep-Alive",
  "Referer": CASTLE_BASE
};

// Playback headers (unchanged)
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

// ====================== TMDB ======================
function getTMDBDetails(tmdbId, mediaType) {
  return __async(this, null, function* () {
    if (String(tmdbId).startsWith("tt")) {
      return { title: "Unknown", year: null, tmdbId: tmdbId };
    }

    try {
      const endpoint = mediaType === "tv" ? "tv" : "movie";
      const url = TMDB_BASE_URL + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
      const response = yield makeRequest(url);
      const data = yield response.json();

      const title = mediaType === "tv" ? data.name : data.title;
      const releaseDate = mediaType === "tv" ? data.first_air_date : data.release_date;
      const year = releaseDate ? parseInt(releaseDate.split("-")[0]) : null;

      return { title: title || "Unknown", year: year, tmdbId: tmdbId };
    } catch (e) {
      return { title: "Unknown", year: null, tmdbId: tmdbId };
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
      // locationId: "1001" // optionally add
    });
    const url = CASTLE_BASE + "/film-api/v1.1.0/movie/searchByKeyword?" + params.toString();
    const response = yield makeRequest(url);
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
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
    return JSON.parse(decrypted);
  });
}

function getVideo2(securityKey, movieId, episodeId, resolution = 2, languageId = null) {
  return __async(this, null, function* () {
    const url = CASTLE_BASE + "/film-api/v2.0.7/movie/getVideo2?clientType=" + CLIENT +
                "&packageName=" + PKG + "&channel=" + CHANNEL + "&lang=" + LANG;

    const body = {
      mode: "1",
      appMarket: "GuanWang",
      clientType: CLIENT,
      woolUser: "false",
      apkSignKey: APK_SIGN_KEY,
      androidVersion: "12",
      movieId: movieId.toString(),
      isNewUser: "false",
      resolution: resolution.toString(),
      packageName: PKG,
      useVipCdn: "false",
      firstAccessTime: Date.now().toString()   // dynamic
    };

    if (episodeId !== null && episodeId !== undefined) {
      body.episodeId = episodeId.toString();
    }

    if (languageId !== null) {
      body.languageId = languageId.toString();
    }

    const headers = {
      "Content-Type": "application/json",
      "version": "2.0.8",
      "clientType": CLIENT,
      "deviceId": "5f2c2f2b-523b-377f-9f2f-c454ac72784f",
      "guid": "6787a0a8c3b440e99e71bd0fbd12c7e32289",
      "channel": CHANNEL,
      "timestamp": Date.now().toString(),
      "nonce": Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15) // random 26 chars
    };

    const response = yield makeRequest(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    const cipher = yield extractCipherFromResponse(response);
    const decrypted = yield decryptCastle(cipher, securityKey);
    return JSON.parse(decrypted);
  });
}

// ====================== HELPERS ======================
function normalizeTitle(t) {
  return (t || "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function findCastleMovieId(securityKey, tmdbInfo) {
  return __async(this, null, function* () {
    const terms = [];
    if (tmdbInfo.year) terms.push(tmdbInfo.title + " " + tmdbInfo.year);
    terms.push(tmdbInfo.title);

    let rows = [];
    for (const term of terms) {
      const result = yield searchCastle(securityKey, term);
      rows = extractDataBlock(result).rows || [];
      if (rows.length > 0) break;
    }

    if (rows.length === 0) throw new Error("No search results found");

    const searchNorm = normalizeTitle(tmdbInfo.title);
    let best = rows[0];

    for (const item of rows) {
      const itemNorm = normalizeTitle(item.title || item.name || "");
      if (itemNorm === searchNorm || itemNorm.includes(searchNorm) || searchNorm.includes(itemNorm)) {
        best = item;
        break;
      }
    }

    const movieId = best.id || best.redirectId || best.redirectIdStr;
    if (!movieId) throw new Error("Could not extract movie ID");
    return movieId.toString();
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

// ====================== MAIN ======================
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    const debug = [];

    function add(msg) {
      debug.push({
        name: "Castle: " + msg,
        title: "Debug",
        url: "https://test.com",
        quality: "360p",
        provider: "castle"
      });
    }

    try {
      add("Start " + mediaType + " S" + (seasonNum || "-") + "E" + (episodeNum || "-") + " | ID:" + tmdbId);

      const tmdbInfo = yield getTMDBDetails(tmdbId, mediaType);
      add("TMDB → " + tmdbInfo.title);

      const securityKey = yield getSecurityKey();
      add("Key OK");

      const movieId = yield findCastleMovieId(securityKey, tmdbInfo);
      add("MovieId → " + movieId);

      let details = yield getDetails(securityKey, movieId);
      let currentMovieId = movieId;

      if (mediaType === "tv" && seasonNum) {
        const data = extractDataBlock(details);
        const seasons = data.seasons || [];
        const season = seasons.find(s => Number(s.number) === Number(seasonNum));
        if (season && season.movieId && String(season.movieId) !== String(movieId)) {
          details = yield getDetails(securityKey, season.movieId.toString());
          currentMovieId = season.movieId.toString();
          add("Season switched → " + currentMovieId);
        }
      }

      const detailsData = extractDataBlock(details);
      const episodes = detailsData.episodes || [];
      add("Episodes → " + episodes.length);
      if (episodes.length > 0) {
        add("First episode id: " + (episodes[0].id || "null"));
      }

      let episodeId = null;

      if (mediaType === "tv" && episodeNum) {
        let ep = episodes.find(e => Number(e.number) === Number(episodeNum));
        if (!ep && episodes.length >= episodeNum) {
          ep = episodes[episodeNum - 1];
          add("Used index fallback");
        }
        if (ep && ep.id) episodeId = ep.id.toString();
      } else if (episodes.length > 0) {
        episodeId = episodes[0].id.toString();
      } else {
        episodeId = currentMovieId;
        add("No episodes – using movieId as episodeId");
      }

      if (!episodeId) {
        add("No episodeId found");
        return debug;
      }

      add("EpisodeId → " + episodeId);

      // Get episode and tracks
      const episode = episodes.find(e => e.id?.toString() === episodeId);
      const tracks = episode?.tracks || [];
      add("Tracks found: " + tracks.map(t => (t.languageName || t.abbreviate || "Unknown") + (t.existIndividualVideo ? " [IND]" : " [SHARED]")).join(", "));

      const allStreams = [];
      const resolutions = [3, 2, 1]; // 1080p, 720p, 480p

      let fetchedAny = false;

      // ------------------------------------------
      // 1. Try per‑track with languageId
      // ------------------------------------------
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
              add("Got " + langName + " " + resolutionToQuality(resolution));
            } else {
              add(langName + " " + resolution + " returned no streams");
            }
          } catch (e) {
            add(langName + " " + resolution + " failed: " + e.message);
          }
        }
      }

      // ------------------------------------------
      // 2. Fallback: shared method (use first languageId)
      // ------------------------------------------
      if (!fetchedAny) {
        add("No per-track streams, falling back to shared method");
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
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, allLanguageNames || "Shared");
            if (streams.length > 0) {
              allStreams.push(...streams);
              fetchedAny = true;
              add("Got shared " + resolutionToQuality(resolution));
            }
          } catch (e) {
            add("Shared " + resolution + " failed: " + e.message);
          }
        }
      }

      // ------------------------------------------
      // 3. Final fallback: try without episodeId (some endpoints allow it)
      // ------------------------------------------
      if (!fetchedAny) {
        add("Trying without episodeId");
        const allLanguageNames = tracks.map(t => t.languageName || t.abbreviate || "Unknown").join(", ");
        for (const resolution of resolutions) {
          try {
            // Pass null for episodeId – getVideo2 will omit it from the body
            const videoData = yield getVideo2(securityKey, currentMovieId, null, resolution);
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution, allLanguageNames || "NoEpisode");
            if (streams.length > 0) {
              allStreams.push(...streams);
              fetchedAny = true;
              add("Got without episodeId " + resolutionToQuality(resolution));
            }
          } catch (e) {
            add("Without episodeId " + resolution + " failed: " + e.message);
          }
        }
      }

      // ------------------------------------------
      // 4. Ultra fallback: try no language, no episodeId
      // ------------------------------------------
      if (!fetchedAny) {
        add("Final fallback - no language, no episodeId");
        for (const resolution of resolutions) {
          try {
            const videoData = yield getVideo2(securityKey, currentMovieId, null, resolution);
            const streams = processVideoResponse(videoData, tmdbInfo, seasonNum, episodeNum, resolution);
            if (streams.length > 0) {
              allStreams.push(...streams);
              fetchedAny = true;
              add("Ultra fallback " + resolutionToQuality(resolution));
            }
          } catch (e) {
            add("Ultra fallback " + resolution + " failed: " + e.message);
          }
        }
      }

      // Deduplicate
      const seen = new Set();
      const uniqueStreams = allStreams.filter(s => {
        const langMatch = s.name.match(/Castle\s*(.+?)\s*-\s*/);
        const lang = langMatch ? langMatch[1].trim() : "unknown";
        const key = s.url + "_" + s.quality + "_" + lang;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      add("Total unique streams: " + uniqueStreams.length);

      if (uniqueStreams.length > 0) {
        uniqueStreams.sort((a, b) => getQualityValue(b.quality) - getQualityValue(a.quality));
        return uniqueStreams;
      }

      return debug;

    } catch (error) {
      add("ERROR: " + error.message);
      return debug;
    }
  });
}

module.exports = { getStreams };