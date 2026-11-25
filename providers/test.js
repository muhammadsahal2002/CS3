// mobile_nf.js – Netflix (nf) – IMDb Title Search + Series Fix
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "https://net52.cc/mobile";
const HOST = "https://net52.cc";

const OMDb_API_KEY = "8d6935ed";

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

// ---------- In-memory token (survives QuickJS re-evaluation via globalThis) ----------
// Still purely in-memory: gone when the app process dies. No file, no storage, no hosting.
let cookieHeader = (typeof globalThis !== "undefined" && globalThis.__nf_cookie) || null;
let unlockPromise = (typeof globalThis !== "undefined" && globalThis.__nf_unlockPromise) || null;

const UNLOCK_TIMEOUT_MS = 45000;
const POLL_MS = 2000;
const OTT = "nf";

function log(msg) { console.log("[NetflixNF] " + msg); }

function getTimestamp() { return Math.floor(Date.now() / 1000); }
function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function currentCookie() {
  return cookieHeader || (typeof globalThis !== "undefined" && globalThis.__nf_cookie) || null;
}

// ---------- Cookie parsing ----------
function cookiePairs(res) {
  var raw = [];
  try {
    if (res.headers && typeof res.headers.getSetCookie === "function") raw = res.headers.getSetCookie();
  } catch (e) {}
  if (!raw || !raw.length) {
    var s = "";
    try { s = res.headers.get("set-cookie") || ""; } catch (e1) {}
    try {
      var x = res.headers.get("x-set-cookie");
      if (x) s += (s ? ", " : "") + x;
    } catch (e2) {}
    raw = s ? s.split(/,(?=\s*[A-Za-z0-9_\-]+=)/) : [];
  }
  var out = [];
  raw.forEach(function(c) {
    var p = String(c).split(";")[0].trim();
    if (p && p.indexOf("=") > 0) out.push(p);
  });
  return out;
}

function pairValue(pairs, name) {
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i].indexOf(name + "=") === 0) return pairs[i].slice(name.length + 1);
  }
  return null;
}
function decode(v) { try { return decodeURIComponent(v); } catch (e) { return v; } }
function isTokenUsable(t) {
  if (!t || typeof t !== "string") return false;
  if (t.indexOf("::99") !== -1) return false;
  return true;
}
function tokenFromResponse(res) {
  var v = pairValue(cookiePairs(res), "t_hash_t");
  if (!v) return null;
  var tok = decode(v);
  return isTokenUsable(tok) ? tok : null;
}

// ---------- Unlock handshake ----------
function appHomeHeaders(cookie) {
  var h = {
    "User-Agent": DEFAULT_HEADERS["User-Agent"],
    "X-Requested-With": "com.netmirror.app",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };
  if (cookie) h["Cookie"] = cookie;
  return h;
}

async function unlockSession() {
  log("🔓 Unlocking session (first search of this app run)...");

  const homeRes = await fetch(HOST + "/mobile/home?app=1", { headers: appHomeHeaders() });
  let tok = tokenFromResponse(homeRes);
  if (tok) {
    log("✅ Token came with the first response");
    return "t_hash_t=" + tok + "; hd=on; ott=" + OTT;
  }

  const initialCookie = cookiePairs(homeRes).join("; ");
  const html = await homeRes.text();
  const m = /data-addhash=["']([^"']+)["']/.exec(html);
  const addhash = m ? m[1] : null;
  if (!addhash) throw new Error("No data-addhash on home page — cannot unlock");

  log("  addhash found, triggering sponsor step...");

  try {
    const domain = HOST.replace(/^https?:\/\//, "");
    fetch("https://userver." + domain + "/?hee5=" + encodeURIComponent(addhash) + "&a=y&t=" + Math.random(), {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": HOST + "/mobile/home?app=1",
        "Cookie": initialCookie,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "manual"
    }).catch(function() {});
  } catch (e) {}

  const pollCookie = "ext_name=ojplmecpdpgccookcobabopnaifgidhf; addhash=" +
    encodeURIComponent(addhash) + "; " + initialCookie;
  const start = Date.now();

  while (Date.now() - start < UNLOCK_TIMEOUT_MS) {
    await delay(POLL_MS);

    let vRes;
    try {
      vRes = await fetch(HOST + "/mobile/verify2.php", {
        method: "POST",
        headers: {
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": HOST + "/mobile/home",
          "Origin": HOST,
          "Cookie": pollCookie
        },
        body: "verify=" + encodeURIComponent(addhash)
      });
    } catch (e) { continue; }

    tok = tokenFromResponse(vRes);
    if (tok) {
      log("✅ Token received after verify");
      return "t_hash_t=" + tok + "; hd=on; ott=" + OTT;
    }

    let j = null;
    try { j = await vRes.json(); } catch (e) {}
    if (j && j.statusup === "All Done") {
      log("  All Done → reloading home...");
      try {
        const r2 = await fetch(HOST + "/mobile/home?app=1", { headers: appHomeHeaders(pollCookie) });
        tok = tokenFromResponse(r2);
        if (tok) {
          log("✅ Token received after home reload");
          return "t_hash_t=" + tok + "; hd=on; ott=" + OTT;
        }
      } catch (e) {}
    }
  }
  throw new Error("Unlock timed out after " + (UNLOCK_TIMEOUT_MS / 1000) + "s");
}

// ---------- ensureCookie: memory-only, dedup, persists via globalThis ----------
async function ensureCookie() {
  const existing = currentCookie();
  if (existing) { cookieHeader = existing; return existing; }   // ← instant on every later call

  const inflight = unlockPromise ||
    (typeof globalThis !== "undefined" && globalThis.__nf_unlockPromise) || null;
  if (inflight) return inflight;

  unlockPromise = unlockSession().then(function(c) {
    unlockPromise = null;
    cookieHeader = c;
    if (typeof globalThis !== "undefined") {
      globalThis.__nf_cookie = c;
      globalThis.__nf_unlockPromise = null;
    }
    log("💾 Cookie cached for this app session");
    return c;
  }).catch(function(e) {
    unlockPromise = null;
    if (typeof globalThis !== "undefined") globalThis.__nf_unlockPromise = null;
    throw e;
  });

  if (typeof globalThis !== "undefined") globalThis.__nf_unlockPromise = unlockPromise;
  return unlockPromise;
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
  var best = null, bestScore = -1;
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var score = langPriority(r.t) * 10;
    if (year && r.y === year) score += 5;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}
function normalizeTitleForSearch(str) {
  return String(str || "").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// ---------- TMDB / OMDb ----------
async function getImdbId(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
  try { const d = await fetchJson(url); return d.imdb_id || null; }
  catch (e) { log(`Failed to get IMDb ID: ${e.message}`); return null; }
}
async function getImdbTitle(imdbId) {
  if (!imdbId) return null;
  try {
    const resp = await fetch(`https://www.omdbapi.com/?i=${imdbId}&plot=short&r=json&apikey=${OMDb_API_KEY}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.Response === "True" && data.Title) { log(`OMDb title: "${data.Title}"`); return data.Title; }
    log(`OMDb error: ${data.Error || 'Unknown'}`);
  } catch (e) { log(`OMDb failed: ${e.message}`); }
  return null;
}

function buildHeaders(extra = {}, requestedWith = "XMLHttpRequest") {
  const h = { ...DEFAULT_HEADERS };
  const ck = currentCookie();
  if (ck) h["Cookie"] = ck;
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
  const data = await fetchJson(url, { headers: buildHeaders({}, "XMLHttpRequest") });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  return data.searchResult || [];
}
async function searchWithFallback(originalTitle, year, imdbTitle) {
  let searchTitle = imdbTitle || originalTitle;
  let results = await search(searchTitle).catch(() => []);
  if (results.length > 0) {
    log(`Found ${results.length} results with IMDb title: "${searchTitle}"`);
    if (year) {
      const f = results.filter(item => item.y === year);
      if (f.length > 0) { log(`Filtered to ${f.length} results with year ${year}`); return f; }
    }
    return results;
  }
  const normalized = normalizeTitleForSearch(originalTitle);
  log(`No results with IMDb title, trying normalized: "${normalized}"`);
  results = await search(normalized).catch(() => []);
  if (results.length === 0) return [];
  if (year) {
    const f = results.filter(item => item.y === year);
    if (f.length > 0) { log(`Filtered to ${f.length} results with year ${year}`); return f; }
  }
  return results;
}
async function getPost(id) {
  const url = `${BASE_URL}/post.php?id=${id}&t=${getTimestamp()}`;
  const data = await fetchJson(url, { headers: buildHeaders({}, "XMLHttpRequest") });
  if (data.status !== "y") throw new Error("Post failed: " + (data.error || "unknown"));
  return data;
}
async function getEpisodes(seasonId, seriesId) {
  let all = [], page = 1, hasNext = true;
  while (hasNext) {
    let url = `${BASE_URL}/episodes.php?s=${seasonId}&series=${seriesId}&t=${getTimestamp()}`;
    if (page > 1) url += `&page=${page}`;
    const data = await fetchJson(url, { headers: buildHeaders({}, "XMLHttpRequest") });
    if (!data.episodes) break;
    all = all.concat(data.episodes);
    if (data.nextPageShow === 1 && data.nextPage) page = data.nextPage;
    else hasNext = false;
  }
  return all;
}
async function getPlaylist(id, title) {
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}&lang=null&hd=on`;
  const data = await fetchJson(url, { headers: buildHeaders({}, "app.netmirror.nmv2") });
  if (!Array.isArray(data) || data.length === 0) throw new Error("Empty playlist response");
  return data[0];
}

// ---------- Main getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  await ensureCookie();

  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  const isMovieType = (mediaType === "movie");
  log(`TMDB: "${title}" (${year}) [${isMovieType ? 'Movie' : 'Series'}]`);

  const imdbId = await getImdbId(tmdbId, mediaType);
  let imdbTitle = null;
  if (imdbId) {
    imdbTitle = await getImdbTitle(imdbId);
    if (imdbTitle) log(`IMDb title: "${imdbTitle}"`);
  }

  const results = await searchWithFallback(title, year, imdbTitle);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log("All search results:");
  for (const item of results) log(`  "${item.t}" (year: ${item.y || 'unknown'}) id=${item.id}`);

  let candidates = [];
  if (isMovieType && year) {
    const existing = results.filter(item => item.y === year);
    if (existing.length > 0) {
      candidates = existing;
      log(`✅ Found ${candidates.length} movie results with year ${year}`);
    } else {
      log(`Fetching year from post.php for ${results.length} movie candidates...`);
      for (const item of results) {
        try {
          const post = await getPost(item.id);
          const itemYear = post.year || "";
          log(`  "${item.t}" → year: "${itemYear}"`);
          if (itemYear === year) candidates.push({ ...item, y: itemYear, post });
        } catch (e) { log(`  Failed to get year for "${item.t}": ${e.message}`); }
      }
      if (candidates.length === 0) throw new Error(`No movies found with year ${year}`);
      log(`✅ Found ${candidates.length} movie results with year ${year}`);
    }
  } else {
    log(`📺 Series mode: Year matching is flexible`);
    candidates = results;
    for (const item of results) {
      try {
        const post = await getPost(item.id);
        const itemYear = post.year || "";
        log(`  "${item.t}" → year: "${itemYear}"`);
        item.y = itemYear; item.post = post;
      } catch (e) { log(`  Failed to get year for "${item.t}": ${e.message}`); }
    }
    if (year) {
      const ym = results.filter(item => item.y === year);
      if (ym.length > 0) {
        log(`✅ Found ${ym.length} results with year ${year} (preferred)`);
        candidates = [...ym, ...results.filter(item => item.y !== year)];
      } else log(`⚠️ No results with year ${year}, using all results`);
    }
  }

  let selected = pickBestResult(candidates, year);
  if (!selected) { selected = candidates[0]; log(`No language pick, using first: "${selected.t}" (${selected.y})`); }
  else log(`Selected: "${selected.t}" (${selected.y})`);

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
    for (const s of seasonList) if (parseInt(s.s, 10) === season) { targetSeasonId = s.id; break; }
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
  if (!playlist.sources || !playlist.sources.length) throw new Error("No sources in playlist");

  const qualities = playlist.sources.map(s => s.label || s.quality || 'unknown');
  log(`Available qualities: ${qualities.join(', ')}`);

  const subtitles = [];
  if (playlist.tracks && playlist.tracks.length) {
    for (const track of playlist.tracks) {
      let url = track.file || "";
      if (url && url.indexOf("http") !== 0) url = (url.indexOf("//") === 0) ? "https:" + url : "https://net52.cc" + url;
      subtitles.push({
        url,
        language: track.label || "Unknown",
        default: (track.label && track.label.toLowerCase().indexOf("english") !== -1) ? true : false
      });
    }
  }

  const ck = currentCookie();
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
        "Cookie": ck,
        "Origin": "https://net52.cc"
      },
      subtitles
    };
  });
}

module.exports = { getStreams };