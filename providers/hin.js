// mobile_nf.js – Netflix (nf) – IMDb Title Search + Apostrophe Fix + Season Fallback
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TOKEN_URL = "https://jsonhosting.com/api/json/eb20e727/raw";
const BASE_URL = "https://net52.cc/mobile";

// OMDb API key
const OMDb_API_KEY = "8d6935ed";

// ---- Hardcoded title mapping ----
const TITLE_MAPPING = {
  "(MAD)²": "Mad Square",
  "MAD²": "Mad Square",
  "Mad²": "Mad Square",
  "India's Got Latent": "India’s Got Latent"
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

// ---------- Language priority ----------
function langPriority(title) {
  var t = (title || "").toLowerCase();
  if (/\bhindi\b/.test(t)) return 100;
  if (/\benglish\b/.test(t)) return 90;
  if (!/\b(tamil|telugu|malayalam|kannada|bengali|marathi)\b/.test(t)) return 50;
  return 10;
}

function pickBestResult(results, year) {
  if (!results || !results.length) return null;
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = langPriority(r.t) * 10;
    if (year && r.y === year) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
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

// ---------- Net52 API with apostrophe fix ----------
async function search(query) {
  // Try original query
  let searchQueries = [query];
  
  // Normalize apostrophes: curly → straight
  const normalized = query.replace(/[’']/g, "'");
  if (normalized !== query) {
    searchQueries.push(normalized);
  }
  
  // Also try with curly apostrophe
  if (query.includes("'")) {
    const curlyVersion = query.replace(/'/g, "’");
    if (curlyVersion !== query) {
      searchQueries.push(curlyVersion);
    }
  }

  // Remove duplicates
  searchQueries = [...new Set(searchQueries)];

  for (const q of searchQueries) {
    const url = `${BASE_URL}/search.php?s=${encodeURIComponent(q)}&t=${getTimestamp()}&ADSearch=false`;
    const headers = buildHeaders({}, "XMLHttpRequest");
    try {
      const data = await fetchJson(url, { headers });
      if (data.status === "y" && data.searchResult && data.searchResult.length > 0) {
        log(`Search found ${data.searchResult.length} results with: "${q}"`);
        return data.searchResult;
      }
    } catch (e) {
      // Continue to next query
    }
  }
  
  log(`No results found for any variation of: "${query}"`);
  return [];
}

async function searchWithFallback(originalTitle, year, imdbTitle) {
  let searchTitle = imdbTitle || originalTitle;
  
  // Check hardcoded mapping first
  let mappedTitle = TITLE_MAPPING[searchTitle] || null;
  if (mappedTitle) {
    log(`Using hardcoded mapping: "${searchTitle}" → "${mappedTitle}"`);
    searchTitle = mappedTitle;
  }
  
  // Try search title
  let results = await search(searchTitle);
  if (results.length > 0) {
    log(`Found ${results.length} results with title: "${searchTitle}"`);
    if (year) {
      const filtered = results.filter(item => item.y === year);
      if (filtered.length > 0) {
        log(`Filtered to ${filtered.length} results with year ${year}`);
        return filtered;
      }
    }
    return results;
  }

  // Fallback: try normalized
  const normalized = normalizeTitleForSearch(originalTitle);
  log(`No results, trying normalized: "${normalized}"`);
  results = await search(normalized);
  if (results.length === 0) return [];

  if (year) {
    const filtered = results.filter(item => item.y === year);
    if (filtered.length > 0) {
      log(`Filtered to ${filtered.length} results with year ${year}`);
      return filtered;
    }
  }
  return results;
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

  const imdbId = await getImdbId(tmdbId, mediaType);
  let imdbTitle = null;
  if (imdbId) {
    imdbTitle = await getImdbTitle(imdbId);
    if (imdbTitle) {
      log(`IMDb title: "${imdbTitle}"`);
    }
  }

  const results = await searchWithFallback(title, year, imdbTitle);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (year: ${item.y || 'unknown'}) id=${item.id}`);
  }

  let candidates = [];
  if (year) {
    const existingYearMatches = results.filter(item => item.y === year);
    if (existingYearMatches.length > 0) {
      candidates = existingYearMatches;
      log(`✅ Found ${candidates.length} results with year ${year}`);
    } else {
      log(`Fetching year from post.php for ${results.length} candidates...`);
      for (const item of results) {
        try {
          const post = await getPost(item.id);
          const itemYear = post.year || "";
          log(`  "${item.t}" → year: "${itemYear}"`);
          if (itemYear === year) {
            candidates.push({ ...item, y: itemYear, post: post });
          } else {
            // Keep as fallback
            log(`  Year mismatch (${itemYear} != ${year}), keeping as fallback`);
            candidates.push({ ...item, y: itemYear, post: post });
          }
        } catch (e) {
          log(`  Failed to get year for "${item.t}": ${e.message}`);
        }
      }
      if (candidates.length === 0) {
        throw new Error(`No results found for "${title}"`);
      }
      const matchingYear = candidates.filter(item => item.y === year);
      if (matchingYear.length > 0) {
        candidates = matchingYear;
        log(`✅ Found ${candidates.length} results with year ${year}`);
      } else {
        log(`⚠️ No results with year ${year}, using all results (${candidates.length})`);
      }
    }
  } else {
    candidates = results;
  }

  let selected = pickBestResult(candidates, year);
  if (!selected) {
    selected = candidates[0];
    log(`No language pick, using first: "${selected.t}" (${selected.y})`);
  } else {
    log(`Selected: "${selected.t}" (${selected.y})`);
  }

  const post = selected.post || await getPost(selected.id);
  log(`Type: ${post.type}, title: ${post.title}`);

  let contentId;

  const isMovie = (post.type === "m" || mediaType === "movie");

  if (isMovie) {
    contentId = post.main_id || selected.id;
    log(`Movie, using ID: ${contentId}`);
  } else {
    const seasonList = post.season || [];
    let targetSeasonId = null;
    let targetSeasonNum = season;

    for (const s of seasonList) {
      const sNum = parseInt(s.s, 10);
      if (sNum === season) {
        targetSeasonId = s.id;
        targetSeasonNum = season;
        break;
      }
    }

    if (!targetSeasonId && seasonList.length > 0) {
      const firstSeason = seasonList[0];
      targetSeasonId = firstSeason.id;
      targetSeasonNum = parseInt(firstSeason.s, 10);
      log(`⚠️ Season ${season} not found, falling back to Season ${targetSeasonNum}`);
    }

    if (!targetSeasonId) {
      throw new Error(`No seasons found for this show`);
    }

    log(`Season ID: ${targetSeasonId} (Season ${targetSeasonNum})`);

    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) {
      throw new Error(`No episodes found for season ${targetSeasonNum}`);
    }

    let targetEp = null;
    let availableEpisodes = [];

    for (const ep of episodes) {
      const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
      availableEpisodes.push(epNum);
      if (epNum === episode) {
        targetEp = ep;
        break;
      }
    }

    if (!targetEp && episodes.length > 0) {
      log(`⚠️ Episode ${episode} not found, available episodes: ${availableEpisodes.join(', ')}`);
      log(`Using first episode: ${episodes[0].ep}`);
      targetEp = episodes[0];
    }

    if (!targetEp) {
      throw new Error(`No episodes found for season ${targetSeasonNum}`);
    }

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