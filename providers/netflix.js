// mobile_nf.js – Netflix (nf) – Year-first selection + forced variations
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

// ---------- Token ----------
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

// ---------- Net52 API ----------
async function search(query) {
  const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  return data.searchResult || [];
}

// ---------- Aggressive search with multiple variations ----------
async function searchWithFallback(originalTitle, year) {
  const normalized = normalizeTitleForSearch(originalTitle);
  let allResults = [];
  let queries = [];

  // Build search queries
  queries.push(originalTitle);
  queries.push(normalized);

  // For special cases like "Mad" -> also try "Mad Square", "Mad 2", etc.
  if (normalized.toLowerCase() === "mad") {
    queries.push("Mad Square");
    queries.push("MAD Square");
    queries.push("Mad 2");
    queries.push("MAD 2");
    queries.push("Mad²");
    queries.push("MAD²");
    // Also try with year
    if (year) {
      queries.push(`Mad Square ${year}`);
      queries.push(`Mad ${year}`);
    }
  }

  // Also try with year appended to original
  if (year) {
    queries.push(`${originalTitle} ${year}`);
    queries.push(`${normalized} ${year}`);
  }

  // Remove duplicates
  const uniqueQueries = [...new Set(queries)];

  // Search each query and collect results
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
    } catch (e) {
      // ignore
    }
  }

  // Filter by year if possible
  if (year && allResults.length > 0) {
    const yearMatches = allResults.filter(item => item.y === year);
    if (yearMatches.length > 0) {
      log(`Found ${yearMatches.length} results with year ${year}`);
      return yearMatches;
    }
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

  // Aggressive search with variations
  const results = await searchWithFallback(title, year);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  // Log all results
  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (${item.y}) id=${item.id}`);
  }

  // ---- STEP 1: Filter by year first ----
  let candidates = results;
  if (year) {
    const yearMatches = results.filter(item => item.y === year);
    if (yearMatches.length > 0) {
      log(`✅ Found ${yearMatches.length} results with year ${year}`);
      candidates = yearMatches;
    } else {
      log(`⚠️ No results with year ${year}, using all results`);
    }
  }

  // ---- STEP 2: Among year matches, pick the one with best title match ----
  let selected = null;
  let bestTitleScore = -1;

  // Normalize search title
  const searchNorm = normalizeTitleForSearch(title).toLowerCase();

  for (const item of candidates) {
    const itemNorm = normalizeTitleForSearch(item.t).toLowerCase();
    let score = 0;

    // Exact match after normalization
    if (itemNorm === searchNorm) {
      score = 100;
    }
    // One contains the other
    else if (itemNorm.indexOf(searchNorm) !== -1 || searchNorm.indexOf(itemNorm) !== -1) {
      score = 50;
      // Bonus for longer title (e.g., "Mad Square" vs "Mad")
      if (itemNorm.length > searchNorm.length) {
        score += 10;
      }
    }
    // Partial word match
    else {
      const searchWords = searchNorm.split(" ");
      const itemWords = itemNorm.split(" ");
      let matches = 0;
      for (const sw of searchWords) {
        for (const iw of itemWords) {
          if (iw.indexOf(sw) !== -1 || sw.indexOf(iw) !== -1) {
            matches++;
            break;
          }
        }
      }
      score = (matches / Math.max(searchWords.length, 1)) * 30;
    }

    // Bonus for containing Hindi/English language tag (if preferred)
    const t = (item.t || "").toLowerCase();
    if (/\bhindi\b/.test(t)) score += 5;
    if (/\benglish\b/.test(t)) score += 3;

    log(`  "${item.t}": title_score=${Math.round(score)}`);

    if (score > bestTitleScore) {
      bestTitleScore = score;
      selected = item;
    }
  }

  if (!selected) {
    selected = candidates[0] || results[0];
    log(`No pick, using first: "${selected.t}" (${selected.y})`);
  } else {
    log(`✅ Selected: "${selected.t}" (${selected.y}) title_score=${Math.round(bestTitleScore)}`);
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

  // Log available qualities
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