// mobile_nf.js – Netflix (nf) – IMDb Title Search + Series Fix
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
// Cloudflare Worker (token source) - EDIT THESE TWO
const CF_URL = "https://nftoken.YOURNAME.workers.dev";
const CF_KEY = "k9x2mQ7pLr4";
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
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

function log(msg) { console.log("[NetflixNF] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
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

function normalizeTitleForSearch(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Cloudflare token: read, or unlock + save when missing/expired ----------
var CF_HOST = "https://net52.cc";
var CF_UA = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.85 Mobile Safari/537.36 /OS.Gatu v3.1";
var CF_UNLOCK_TIMEOUT_MS = 45000;
var CF_POLL_MS = 750;

function cfDelay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function cfDecode(v) { try { return decodeURIComponent(v); } catch (e) { return v; } }

function cfTokenUsable(t) {
  if (!t || typeof t !== "string") return false;
  if (t.indexOf("::99") !== -1) return false;
  var parts = t.split("::");
  if (parts.length >= 3 && /^\d{10}$/.test(parts[2])) {
    if (Date.now() / 1000 - Number(parts[2]) >= 43200) return false;
  }
  return true;
}
function cfExpiry(tok) {
  var expiry = Date.now() + 12 * 3600 * 1000 - 10 * 60 * 1000;
  var parts = String(tok).split("::");
  if (parts.length >= 3 && /^\d{10}$/.test(parts[2])) {
    expiry = Number(parts[2]) * 1000 + 12 * 3600 * 1000 - 10 * 60 * 1000;
  }
  return expiry;
}
function cfCookiePairs(res) {
  var raw = [];
  try { if (res.headers && typeof res.headers.getSetCookie === "function") raw = res.headers.getSetCookie(); } catch (e) {}
  if (!raw || !raw.length) {
    var s = "";
    try { s = res.headers.get("set-cookie") || ""; } catch (e1) {}
    try { var x = res.headers.get("x-set-cookie"); if (x) s += (s ? ", " : "") + x; } catch (e2) {}
    raw = s ? s.split(/,(?=\s*[A-Za-z0-9_\-]+=)/) : [];
  }
  var out = [];
  raw.forEach(function(c) {
    var p = String(c).split(";")[0].trim();
    if (p && p.indexOf("=") > 0) out.push(p);
  });
  return out;
}
function cfTokenFromResponse(res) {
  var pairs = cfCookiePairs(res), v = null;
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i].indexOf("t_hash_t=") === 0) { v = pairs[i].slice(9); break; }
  }
  if (!v) return null;
  var tok = cfDecode(v);
  return cfTokenUsable(tok) ? tok : null;
}
function cfHomeHeaders(cookie) {
  var h = {
    "User-Agent": CF_UA,
    "X-Requested-With": "com.netmirror.app",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (cookie) h["Cookie"] = cookie;
  return h;
}

async function cfUnlock() {
  log("Unlocking session (about 40s)...");
  var homeRes = await fetch(CF_HOST + "/mobile/home?app=1", { headers: cfHomeHeaders() });
  var tok = cfTokenFromResponse(homeRes);
  if (tok) return tok;

  var initialCookie = cfCookiePairs(homeRes).join("; ");
  var html = await homeRes.text();
  var m = /data-addhash=["']([^"']+)["']/.exec(html);
  var addhash = m ? m[1] : null;
  if (!addhash) throw new Error("No data-addhash on home page - cannot unlock");

  try {
    var domain = CF_HOST.replace(/^https?:\/\//, "");
    fetch("https://userver." + domain + "/?hee5=" + encodeURIComponent(addhash) + "&a=y&t=" + Math.random(), {
      headers: {
        "User-Agent": CF_UA,
        "Referer": CF_HOST + "/mobile/home?app=1",
        "Cookie": initialCookie,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "manual"
    }).catch(function() {});
  } catch (e) {}

  var pollCookie = "ext_name=ojplmecpdpgccookcobabopnaifgidhf; addhash=" + encodeURIComponent(addhash) + "; " + initialCookie;
  var start = Date.now();
  while (Date.now() - start < CF_UNLOCK_TIMEOUT_MS) {
    await cfDelay(CF_POLL_MS);
    var vRes;
    try {
      vRes = await fetch(CF_HOST + "/mobile/verify2.php", {
        method: "POST",
        headers: {
          "User-Agent": CF_UA,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": CF_HOST + "/mobile/home",
          "Origin": CF_HOST,
          "Cookie": pollCookie
        },
        body: "verify=" + encodeURIComponent(addhash)
      });
    } catch (e) { continue; }

    tok = cfTokenFromResponse(vRes);
    if (tok) return tok;

    var j = null;
    try { j = await vRes.json(); } catch (e) {}
    if (j) {
      var tJson = j.t_hash_t || j.token || (j.data && j.data.t_hash_t);
      if (tJson && cfTokenUsable(tJson)) return cfDecode(tJson);
      if (j.statusup === "All Done") {
        try {
          var r2 = await fetch(CF_HOST + "/mobile/home?app=1", { headers: cfHomeHeaders(pollCookie) });
          tok = cfTokenFromResponse(r2);
          if (tok) return tok;
        } catch (e) {}
      }
    }
  }
  throw new Error("Unlock timed out");
}

async function cfGetOrCreate() {
  try {
    var r = await fetch(CF_URL, { headers: { "x-key": CF_KEY } });
    if (r.ok) {
      var j = JSON.parse(await r.text());
      var rec = j.record || j;
      if (rec && rec.t_hash_t && (!rec.expiry || rec.expiry > Date.now()) && cfTokenUsable(rec.t_hash_t)) {
        log("Token loaded from Cloudflare");
        return rec;
      }
      log("Cloudflare token expired");
    } else {
      log("Cloudflare has no token (HTTP " + r.status + ")");
    }
  } catch (e) { log("Cloudflare read failed: " + e.message); }

  var tok = await cfUnlock();
  var created = { t_hash_t: tok, expiry: cfExpiry(tok) };
  try {
    await fetch(CF_URL, { method: "PUT", headers: { "x-key": CF_KEY }, body: JSON.stringify(created) });
    log("New token saved to Cloudflare");
  } catch (e) { log("Cloudflare save failed: " + e.message); }
  return created;
}

// ---------- Token ----------
async function fetchToken() {
const now = Date.now();
if (tokenCache && (now - tokenFetchedAt) < TOKEN_TTL_MS) return tokenCache;

const json = await cfGetOrCreate();

  const record = json.record || json || {};
  const t_hash_t = record.t_hash_t || "";
  const t_hash = record.t_hash || record.t_hash_encoded || record.addhash || "";
  rawToken = record.token || "";

  if (!t_hash_t) throw new Error("Missing t_hash_t in token");

  cookieHeader = `t_hash_t=${t_hash_t}; ott=nf`;
  if (t_hash) cookieHeader += `; t_hash=${t_hash}`;
  cookieHeader += "; hd=on";

  tokenCache = { t_hash_t, t_hash, rawToken };
  tokenFetchedAt = now;
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

async function searchWithFallback(originalTitle, year) {
  let results = await search(originalTitle).catch(() => []);

  if (results.length > 0) {
    log(`Found ${results.length} results with TMDB title: "${originalTitle}"`);
    if (year) {
      const filtered = results.filter(item => item.y === year);
      if (filtered.length > 0) {
        log(`Filtered to ${filtered.length} results with year ${year}`);
        return filtered;
      }
    }
    return results;
  }

  const normalized = normalizeTitleForSearch(originalTitle);
  log(`No results with TMDB title, trying normalized: "${normalized}"`);
  results = await search(normalized).catch(() => []);
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
// ---------- Main getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  await fetchToken();

  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  const isMovieType = (mediaType === "movie");
  log(`TMDB: "${title}" (${year}) [${isMovieType ? 'Movie' : 'Series'}]`);

  const results = await searchWithFallback(title, year);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (year: ${item.y || 'unknown'}) id=${item.id}`);
  }

  // ---- YEAR FILTERING: Strict for Movies, Flexible for Series ----
  let candidates = [];
  
  if (isMovieType && year) {
    // ---- MOVIE: Strict year matching ----
    const existingYearMatches = results.filter(item => item.y === year);
    if (existingYearMatches.length > 0) {
      candidates = existingYearMatches;
      log(`✅ Found ${candidates.length} movie results with year ${year}`);
    } else {
      log(`Fetching year from post.php for ${results.length} movie candidates...`);
      for (const item of results) {
        try {
          const post = await getPost(item.id);
          const itemYear = post.year || "";
          log(`  "${item.t}" → year: "${itemYear}"`);
          if (itemYear === year) {
            candidates.push({ ...item, y: itemYear, post: post });
          }
        } catch (e) {
          log(`  Failed to get year for "${item.t}": ${e.message}`);
        }
      }
      if (candidates.length === 0) {
        throw new Error(`No movies found with year ${year}`);
      }
      log(`✅ Found ${candidates.length} movie results with year ${year}`);
    }
  } else {
    // ---- SERIES: Flexible year (use all results) ----
    log(`📺 Series mode: Year matching is flexible`);
    candidates = results;
    
    // Still fetch years for logging, but don't filter
    for (const item of results) {
      try {
        const post = await getPost(item.id);
        const itemYear = post.year || "";
        log(`  "${item.t}" → year: "${itemYear}"`);
        item.y = itemYear;
        item.post = post;
      } catch (e) {
        log(`  Failed to get year for "${item.t}": ${e.message}`);
      }
    }
    
    // If there's a year match, prefer it (but don't reject others)
    if (year) {
      const yearMatches = results.filter(item => item.y === year);
      if (yearMatches.length > 0) {
        log(`✅ Found ${yearMatches.length} results with year ${year} (preferred)`);
        // Keep all results, but put year matches first
        candidates = [...yearMatches, ...results.filter(item => item.y !== year)];
      } else {
        log(`⚠️ No results with year ${year}, using all results`);
      }
    }
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

  // ---- FIX: Treat "t" as TV series ----
  const isMovie = (post.type === "m" || mediaType === "movie");

  if (isMovie) {
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