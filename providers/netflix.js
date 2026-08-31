// mobile_nf.js – Netflix (nf) – IMDb title first, year from post
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN_URL = "https://jsonhosting.com/api/json/eb20e727/raw";
const BASE_URL = "https://net52.cc/mobile";

// OMDb API key
const OMDb_API_KEY = "8d6935ed";

// ---- Hardcoded title mapping (fallback if OMDb fails) ----
const TITLE_MAPPING = {
  "(MAD)²": "Mad Square",
  "MAD²": "Mad Square",
  "Mad²": "Mad Square"
};

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

// ---------- Get IMDb ID from TMDB ----------
async function getImdbId(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
  try {
    const data = await fetchJson(url);
    return data.imdb_id || null;
  } catch (e) {
    log(`Failed to get IMDb ID: ${e.message}`);
    return null;
  }
}

// ---------- Get IMDb title using OMDb ----------
async function getImdbTitle(imdbId) {
  if (!imdbId) return null;
  
  try {
    const url = `https://www.omdbapi.com/?i=${imdbId}&plot=short&r=json&apikey=${OMDb_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.Response === "True" && data.Title) {
      log(`OMDb title: "${data.Title}"`);
      return data.Title;
    } else {
      log(`OMDb error: ${data.Error || 'Unknown'}`);
    }
  } catch (e) {
    log(`OMDb failed: ${e.message}`);
  }
  return null;
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

async function searchWithFallback(originalTitle, year, imdbTitle) {
  const normalized = normalizeTitleForSearch(originalTitle);
  let allResults = [];
  let queries = [];

  // ---- Use IMDb title first (most likely to match Net52) ----
  let mappedTitle = TITLE_MAPPING[originalTitle] || null;
  
  // Priority: IMDb title > mapped title > original title
  let searchTitle = imdbTitle || mappedTitle || originalTitle;
  
  // Always search with the best title
  queries.push(searchTitle);
  if (year) {
    queries.push(`${searchTitle} ${year}`);
  }
  
  // Also try original as fallback
  if (searchTitle !== originalTitle) {
    queries.push(originalTitle);
    queries.push(normalized);
    if (year) {
      queries.push(`${originalTitle} ${year}`);
      queries.push(`${normalized} ${year}`);
    }
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
    } catch (e) {
      log(`Search failed for "${q}": ${e.message}`);
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

  // ---- Get IMDb ID and title ----
  const imdbId = await getImdbId(tmdbId, mediaType);
  let imdbTitle = null;
  if (imdbId) {
    imdbTitle = await getImdbTitle(imdbId);
    if (imdbTitle) {
      log(`IMDb title: "${imdbTitle}"`);
    }
  }

  // ---- Search with IMDb title first ----
  const results = await searchWithFallback(title, year, imdbTitle);
  if (!results.length) {
    throw new Error(`No results found for "${title}"`);
  }

  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (year unknown) id=${item.id}`);
  }

  // ---- STEP 1: Fetch year from post.php for each candidate ----
  log(`Fetching year for ${results.length} candidates...`);
  let candidatesWithYear = [];

  for (const item of results) {
    try {
      const post = await getPost(item.id);
      const itemYear = post.year || "";
      log(`  "${item.t}" → year: "${itemYear}"`);
      candidatesWithYear.push({
        ...item,
        y: itemYear,
        post: post
      });
    } catch (e) {
      log(`  Failed to get year for "${item.t}": ${e.message}`);
      candidatesWithYear.push({
        ...item,
        y: "",
        post: null
      });
    }
  }

  // ---- STEP 2: Filter by year (MUST MATCH) ----
  let yearMatches = [];
  if (year) {
    yearMatches = candidatesWithYear.filter(item => item.y === year);
    if (yearMatches.length === 0) {
      const availableYears = [...new Set(candidatesWithYear.map(r => r.y).filter(y => y))].join(', ');
      log(`❌ No results with year ${year}. Available: ${availableYears || 'none'}`);
      throw new Error(`No results found with year ${year}.`);
    }
    log(`✅ Found ${yearMatches.length} results with year ${year}`);
  } else {
    yearMatches = candidatesWithYear;
  }

  // ---- STEP 3: Word matching among year matches ----
  let selected = null;
  let bestWordScore = -1;
  // Use IMDb title for matching (most accurate)
  const matchTitle = imdbTitle || title;
  log(`Using match title: "${matchTitle}"`);

  for (const item of yearMatches) {
    const wordScore = wordMatchScore(matchTitle, item.t);
    log(`  "${item.t}" (${item.y}): word_score=${wordScore}`);
    if (wordScore > bestWordScore) {
      bestWordScore = wordScore;
      selected = item;
    }
  }

  if (!selected) {
    selected = yearMatches[0];
    log(`Using first matching year result: "${selected.t}" (${selected.y})`);
  } else {
    log(`✅ Selected: "${selected.t}" (${selected.y}) word_score=${bestWordScore}`);
  }

  // Use the post we already fetched
  const post = selected.post || await getPost(selected.id);
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