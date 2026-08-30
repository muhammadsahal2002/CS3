// mobile_nf.js – Netflix (nf) – Year-first scoring + title similarity
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

// ---------- Language priority (tiebreaker only) ----------
function langPriority(title) {
  var t = (title || "").toLowerCase();
  if (/\bhindi\b/.test(t)) return 100;
  if (/\benglish\b/.test(t)) return 90;
  if (!/\b(tamil|telugu|malayalam|kannada|bengali|marathi)\b/.test(t)) return 50;
  return 10;
}

// ---------- Title similarity (simple: longest common prefix + length bonus) ----------
function titleSimilarity(a, b) {
  var s1 = (a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var s2 = (b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s1 === s2) return 100;
  // Count matching characters
  var maxLen = Math.max(s1.length, s2.length);
  var matches = 0;
  for (var i = 0; i < Math.min(s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) matches++;
  }
  // Also check if one contains the other
  if (s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1) {
    matches += Math.min(s1.length, s2.length) * 0.5;
  }
  return Math.min(100, (matches / maxLen) * 100 + (Math.min(s1.length, s2.length) / maxLen) * 20);
}

function pickBestResult(results, title, year) {
  if (!results || !results.length) return null;

  var best = null;
  var bestScore = -999;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = 0;

    // ---- YEAR MATCH (Highest priority) ----
    if (year && r.y === year) {
      score += 50;   // Year match: highest weight
    } else if (year && r.y !== year) {
      score -= 10;   // Penalty for wrong year
    }

    // ---- TITLE SIMILARITY ----
    var sim = titleSimilarity(r.t, title);
    score += sim * 0.5;   // Up to 50 points for near-exact title match

    // ---- LENGTH BONUS (helps differentiate "Mad" vs "Mad Square") ----
    // Longer titles get a small bonus if they contain the search term
    var normTitle = (r.t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    var normSearch = (title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normTitle.indexOf(normSearch) !== -1 && normTitle.length > normSearch.length) {
      score += 5;
    }

    // ---- LANGUAGE (tiebreaker only – small weight) ----
    score += langPriority(r.t) * 0.1;   // Max 10 points

    // ---- LOG SCORING ----
    log(`  "${r.t}" (${r.y}): year=${year && r.y === year ? '+50' : '-10'}, sim=${Math.round(sim)}, total=${Math.round(score)}`);

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  return best;
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

// ---------- Net52 API (multiple search attempts) ----------
async function search(query) {
  const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  return data.searchResult || [];
}

async function searchWithFallback(originalTitle, year) {
  const normalized = normalizeTitleForSearch(originalTitle);
  let results = [];

  // 1. Try original title
  results = await search(originalTitle).catch(() => []);
  if (results.length > 0) return results;

  // 2. Try normalized
  log("No results for original, trying normalized: " + normalized);
  results = await search(normalized).catch(() => []);
  if (results.length > 0) return results;

  // 3. Try title + year
  if (year) {
    const withYear = `${normalized} ${year}`;
    log("Trying with year: " + withYear);
    results = await search(withYear).catch(() => []);
    if (results.length > 0) return results;
  }

  // 4. Special case: for "Mad" vs "Mad Square"
  if (normalized.toLowerCase() === "mad") {
    const variations = ["Mad Square", "MAD Square", "Mad2", "MAD2", "Mad 2"];
    for (const variant of variations) {
      log("Trying variation: " + variant);
      const vResults = await search(variant).catch(() => []);
      if (vResults.length > 0) {
        // Filter by year if possible
        if (year) {
          const filtered = vResults.filter(item => item.y === year);
          if (filtered.length > 0) return filtered;
        }
        return vResults;
      }
    }
  }

  return [];
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
  if (!results.length) throw new Error(`No results for "${title}"`);

  // Log all results
  log("Search results:");
  for (const item of results) {
    log(`  "${item.t}" (${item.y}) id=${item.id}`);
  }

  // ---- Pick best result with year-first scoring ----
  let selected = pickBestResult(results, title, year);
  if (!selected) {
    selected = results[0];
    log(`No pick, using first: "${selected.t}" (${selected.y})`);
  } else {
    log(`✅ Selected: "${selected.t}" (${selected.y})`);
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