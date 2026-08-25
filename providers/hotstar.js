// mobile_newtv.js – Hotstar (hs) for Nuvio
// Now fetches token from JSONBin (same as primevideo.js)
// ES6-compatible (async/await, const/let)

"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

// Use the same JSONBin URL as primevideo.js (the token generator updates this)
const TOKEN_URL = "https://api.jsonbin.io/v3/b/6a8bc1edf5f4af5e293a7a1b/latest";
const BASE_URL = "https://net52.cc/mobile/hs";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.85 Mobile Safari/537.36 /OS.Gatu v3.1",
  "Accept": "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Referer": "https://net52.cc/mobile/home?app=1",
  "Connection": "keep-alive"
};

let tokenCache = null;
let cookieHeader = null;
let rawToken = null;  // for possible userhash, though Hotstar may not need it

function log(msg) { console.log("[MobileNewTV] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// ---------- Token Fetch (exactly like primevideo.js) ----------
async function fetchToken() {
  if (tokenCache) return tokenCache;

  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Token HTTP ${resp.status}`);
  const json = await resp.json();

  const record = json.record || {};
  // Hotstar uses t_hash_t and t_hash (like the original logs)
  const t_hash_t = record.t_hash_t || "";
  const t_hash = record.t_hash || record.t_hash_encoded || record.addhash || "";
  rawToken = record.token || ""; // not used for HS but keep

  if (!t_hash_t) throw new Error("Missing t_hash_t in token");

  // Build Hotstar cookie: ott=hs, t_hash_t, t_hash, hd=on (optional)
  cookieHeader = `t_hash_t=${t_hash_t}; ott=hs`;
  if (t_hash) cookieHeader += `; t_hash=${t_hash}`;
  cookieHeader += "; hd=on";  // from original mobile_newtv.js

  tokenCache = { t_hash_t, t_hash, rawToken };
  log("Token loaded from JSONBin");
  return tokenCache;
}

function buildHeaders(extra = {}, requestedWith = "XMLHttpRequest") {
  const h = { ...DEFAULT_HEADERS };
  if (cookieHeader) h["Cookie"] = cookieHeader;
  if (requestedWith) h["X-Requested-With"] = requestedWith;
  if (extra) Object.assign(h, extra);
  return h;
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
  return resp.json();
}

// ---------- API calls (same as before, but using BASE_URL for HS) ----------
async function search(query) {
  const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  return data.searchResult || [];
}

async function getPost(id) {
  const url = `${BASE_URL}/post.php?id=${id}&t=${getTimestamp()}`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Post failed: " + (data.error || "unknown"));
  return data;
}

async function getEpisodes(seasonId, seriesId) {
  let allEpisodes = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let url = `${BASE_URL}/episodes.php?s=${seasonId}&series=${seriesId}&t=${getTimestamp()}`;
    if (page > 1) url += `&page=${page}`;
    const headers = buildHeaders({}, "XMLHttpRequest");
    const data = await fetchJson(url, { headers });
    if (!data.episodes) break;
    allEpisodes = allEpisodes.concat(data.episodes);
    if (data.nextPageShow === 1 && data.nextPage) {
      page = data.nextPage;
    } else {
      hasNext = false;
    }
  }
  return allEpisodes;
}

async function getPlaylist(id, title) {
  // Hotstar playlist does not use lang or userhash – just id, title, tm
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}`;
  const headers = buildHeaders({}, "app.netmirror.nmv2");
  const data = await fetchJson(url, { headers });
  if (!Array.isArray(data) || data.length === 0) throw new Error("Empty playlist response");
  return data[0];
}

// ---------- TMDB helpers ----------
async function getTmdbTitle(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  return data.title || data.name;
}

// ---------- Main exported function ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  await fetchToken();

  const title = await getTmdbTitle(tmdbId, mediaType);
  log(`Title: ${title}`);

  const results = await search(title);
  if (!results.length) throw new Error(`No results for "${title}"`);
  const selected = results[0];
  log(`Selected: ${selected.t} (ID: ${selected.id})`);

  const post = await getPost(selected.id);
  log(`Type: ${post.type}, title: ${post.title}`);

  let contentId;

  if (post.type === "m" || season === undefined || episode === undefined) {
    // Movie or no episode requested – use main_id if present
    contentId = post.main_id || selected.id;
    log(`Movie / no episode, using ID: ${contentId}`);
  } else {
    // ---------- TV SERIES ----------
    const seasonList = post.season || [];
    let targetSeasonId = null;

    for (const s of seasonList) {
      if (parseInt(s.s, 10) === season) {
        targetSeasonId = s.id;
        break;
      }
    }

    if (!targetSeasonId) {
      throw new Error(`Season ${season} not found in series data`);
    }
    log(`Season ID: ${targetSeasonId}`);

    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) throw new Error(`No episodes for season ${season}`);

    let targetEp = null;
    for (const ep of episodes) {
      const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
      if (epNum === episode) {
        targetEp = ep;
        break;
      }
    }

    if (!targetEp) {
      throw new Error(`Episode ${episode} not found in season ${season}`);
    }
    log(`Found episode: ${targetEp.t} (ID: ${targetEp.id})`);
    contentId = targetEp.id;
  }

  // Get playlist (sources) for the content
  const playlist = await getPlaylist(contentId, title);
  if (!playlist.sources || !playlist.sources.length) {
    throw new Error("No sources in playlist");
  }

  // Build stream objects
  const streams = playlist.sources.map(src => {
    const fileUrl = src.file.startsWith("http") ? src.file : `https://net52.cc${src.file}`;
    return {
      name: "Hotstar",
      title: src.label || "Auto",
      url: fileUrl,
      quality: src.label || "Auto",
      headers: {
        Referer: "https://net52.cc/",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Cookie": cookieHeader,
        "Origin": "https://net52.cc"
      }
    };
  });

  return streams;
}

module.exports = { getStreams };