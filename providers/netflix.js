// mobile_nf.js – Netflix (nf) – Year first + word matching
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN_URL = "https://jsonhosting.com/api/json/eb20e727/raw";
const BASE_URL = "https://net52.cc/mobile";

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
let rawToken = null;

function log(msg) { console.log("[NetflixNF] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function normalizeTitleForSearch(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Word matching score ----------
function wordMatchScore(tmdbTitle, resultTitle) {
  const tmdbWords = normalizeTitleForSearch(tmdbTitle).toLowerCase().split(" ");
  const resultWords = normalizeTitleForSearch(resultTitle).toLowerCase().split(" ");
  
  let matchedWords = 0;
  const matchedList = [];
  
  for (const tw of tmdbWords) {
    if (tw.length < 2) continue;
    for (const rw of resultWords) {
      if (rw.length < 2) continue;
      if (rw === tw || rw.indexOf(tw) !== -1 || tw.indexOf(rw) !== -1) {
        if (!matchedList.includes(tw)) {
          matchedList.push(tw);
          matchedWords++;
        }
        break;
      }
    }
  }

  const totalWords = tmdbWords.filter(w => w.length >= 2).length;
  if (totalWords === 0) return 0;
  
  // Bonus for exact title match
  const exactBonus = normalizeTitleForSearch(tmdbTitle).toLowerCase() === normalizeTitleForSearch(resultTitle).toLowerCase() ? 20 : 0;
  
  return Math.round((matchedWords / totalWords) * 100) + exactBonus;
}

async function fetchToken() {
  if (tokenCache) return tokenCache;

  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Token HTTP ${resp.status}`);
  const json = await resp.json();

  const record = json.record || {};
  const t_hash_t = record.t_hash_t || "";
  const t_hash = record.t_hash || record.t_hash_encoded || record.addhash || "";
  rawToken = record.token || "";

  if (!t_hash_t) throw new Error("Missing t_hash_t in token");

  cookieHeader = `t_hash_t=${t_hash_t}; ott=nf`;
  if (t_hash) cookieHeader += `; t_hash=${t_hash}`;
  cookieHeader += "; hd=on";

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

async function getTmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  const title = data.title || data.name;
  const year = data.release_date ? data.release_date.substring(0,4) :
               (data.first_air_date ? data.first_air_date.substring(0,4) : "");
  return { title, year };
}

async function search(query) {
  const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  return data.searchResult || [];
}

async function searchWithFallback(originalTitle, year) {
  const normalized = normalizeTitleForSearch(originalTitle);
  let allResults = [];
  let queries = [];

  // Try original title first (important)
  queries.push(originalTitle);
  // Try normalized as fallback
  queries.push(normalized);
  // Try with year appended (helps when title is short like "Mad")
  if (year) {
    queries.push(`${originalTitle} ${year}`);
    queries.push(`${normalized} ${year}`);
  }

  const uniqueQueries = [...new Set(queries)];
  const seenIds = new Set();

  for (const q of uniqueQueries) {
    log(`Searching: "${q}"`);
    try {
      const results = await search(q);
      if (results && results.length > 0) {
        for (const item of results) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            allResults.push(item);
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  return allResults;
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
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}&lang=null&hd=on`;
  const headers = buildHeaders({}, "app.netmirror.nmv2");
  const data = await fetchJson(url, { headers });
  if (!Array.isArray(data) || data.length === 0) throw new Error("Empty playlist response");
  return data[0];
}

// ---------- Main getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  await fetchToken();

  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  log(`TMDB: "${title}" (${year})`);

  const results = await searchWithFallback(title, year);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (${item.y}) id=${item.id}`);
  }

  // ---- STEP 1: FILTER BY YEAR - MUST MATCH ----
  let candidates = [];
  if (year) {
    candidates = results.filter(item => item.y === year);
    if (candidates.length === 0) {
      const availableYears = [...new Set(results.map(r => r.y))].join(', ');
      throw new Error(`No results found with year ${year}. Available years: ${availableYears}`);
    }
    log(`✅ Found ${candidates.length} results with year ${year}`);
  } else {
    candidates = results;
  }

  // ---- STEP 2: WORD MATCHING ----
  let selected = null;
  let bestWordScore = -1;

  for (const item of candidates) {
    const wordScore = wordMatchScore(title, item.t);
    log(`  "${item.t}": word_score=${wordScore}`);
    if (wordScore > bestWordScore) {
      bestWordScore = wordScore;
      selected = item;
    }
  }

  if (!selected) {
    selected = candidates[0];
    log(`Using first matching year result: "${selected.t}" (${selected.y})`);
  } else {
    log(`✅ Selected: "${selected.t}" (${selected.y}) word_score=${bestWordScore}`);
  }

  const post = await getPost(selected.id);
  log(`Type: ${post.type}, title: ${post.title}`);

  let contentId;

  if (post.type === "m" || mediaType === "movie") {
    contentId = post.main_id || selected.id;
    log(`Movie, using ID: ${contentId}`);
  } else {
    const seasonList = post.season || [];
    let targetSeasonId = null;
    for (const s of seasonList) {
      if (parseInt(s.s, 10) === season) {
        targetSeasonId = s.id;
        break;
      }
    }
    if (!targetSeasonId) throw new Error(`Season ${season} not found`);
    log(`Season ID: ${targetSeasonId}`);

    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) throw new Error(`No episodes for season ${season}`);

    let targetEp = null;
    for (const ep of episodes) {
      const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
      if (epNum === episode) { targetEp = ep; break; }
    }
    if (!targetEp) throw new Error(`Episode ${episode} not found`);
    log(`Found episode: ${targetEp.t} (ID: ${targetEp.id})`);
    contentId = targetEp.id;
  }

  const playlist = await getPlaylist(contentId, post.title || title);
  if (!playlist.sources || !playlist.sources.length) {
    throw new Error("No sources in playlist");
  }

  const qualities = playlist.sources.map(s => s.label || s.quality || 'unknown');
  log(`Available qualities: ${qualities.join(', ')}`);

  const subtitles = [];
  if (playlist.tracks && playlist.tracks.length) {
    for (const track of playlist.tracks) {
      let url = track.file || "";
      if (url && url.indexOf("http") !== 0) {
        url = (url.indexOf("//") === 0) ? "https:" + url : "https://net52.cc" + url;
      }
      subtitles.push({
        url: url,
        language: track.label || "Unknown",
        default: (track.label && track.label.toLowerCase().indexOf("english") !== -1) ? true : false
      });
    }
  }

  return playlist.sources.map(src => {
    const fileUrl = src.file.startsWith("http") ? src.file : `https://net52.cc${src.file}`;
    return {
      name: "Netflix",
      title: src.label || "Auto",
      url: fileUrl,
      quality: src.label || "Auto",
      headers: {
        Referer: "https://net52.cc/",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Cookie": cookieHeader,
        "Origin": "https://net52.cc"
      },
      subtitles: subtitles
    };
  });
}

module.exports = { getStreams };