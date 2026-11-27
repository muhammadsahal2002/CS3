// mobile_nf.js – Netflix (nf) – IMDb Title Search + Series Fix
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
// Cloudflare Worker (token source) - EDIT THESE TWO
const CF_URL = "https://nftoken.taharimbadhon27.workers.dev/";
const CF_KEY = "wx9am76cgk";
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
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=alternative_titles`;
  const data = await fetchJson(url);
  const title = data.title || data.name;
  const year = data.release_date ? data.release_date.substring(0,4) :
               (data.first_air_date ? data.first_air_date.substring(0,4) : "");
  return { title, year, originalTitle: data.original_title || data.original_name || "", titles: tmdbTitles(data) };
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
// ---------- Smart selection: title + type (movie/series) + year + season ----------
var SEL_TAG_RE = /^(hindi|english|tamil|telugu|malayalam|kannada|bengali|marathi|punjabi|gujarati|urdu|dubbed|dual audio|multi audio|\d{4}|season\s*\d+|s\d+|part\s*\d+)\b/i;
var SEL_STOP = { the: 1, a: 1, an: 1, and: 1 };

function selClean(t) {
  t = String(t || "");
  var prev;
  do {
    prev = t;
    t = t.replace(/\s*[\(\[]([^\)\]]*)[\)\]]\s*$/, function(m, inner) { return SEL_TAG_RE.test(inner.trim()) ? "" : m; });
  } while (t !== prev);
  return t.replace(/[\s:\-]+season\s*\d+\s*$/i, "");
}
function selTokens(s) {
  s = String(s || "").toLowerCase();
  if (s.normalize) s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  return s ? s.split(" ").filter(function(w) { return !SEL_STOP[w]; }) : [];
}
function selTitleScore(candTitle, wants) {
  var a = selTokens(selClean(candTitle));
  if (!a.length) return 0;
  var best = 0;
  for (var i = 0; i < wants.length; i++) {
    var b = selTokens(wants[i]);
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
function selYearBonus(itemYear, year, isMovie) {
  var a = parseInt(itemYear, 10), b = parseInt(year, 10);
  if (!a || !b) return 0;
  if (a === b) return 40;
  if (isMovie) return Math.abs(a - b) === 1 ? 15 : -30;
  return -5;
}

async function selectBest(results, info, isMovieType, season) {
  if (!results || !results.length) return null;
  var wants = info.titles || [info.title];
  var pre = results.map(function(it) { return { it: it, s: selTitleScore(it.t, wants) }; });
  pre.sort(function(x, y) { return y.s - x.s; });
  var top = pre.filter(function(x) { return x.s >= 40; }).slice(0, 8);
  if (!top.length) top = pre.slice(0, 4);

  var scored = await Promise.all(top.map(async function(x) {
    var post;
    try { post = await getPost(x.it.id); } catch (e) { return null; }
    var isM = post.type === "m" || (!post.type && !(post.season && post.season.length));
    if (isM !== isMovieType) {
      log("  skip \"" + x.it.t + "\" (wrong type: " + (isM ? "movie" : "series") + ")");
      return null;
    }
    var ts = Math.max(x.s, selTitleScore(post.title || "", wants));
    var iy = post.year || x.it.y;
    var score = ts + selYearBonus(iy, info.year, isMovieType) + Math.round(langPriority(x.it.t) / 10);
    if (!isMovieType) {
      var has = (post.season || []).some(function(s) { return parseInt(s.s, 10) === season; });
      if (!has) { log("  skip \"" + x.it.t + "\" (no season " + season + ")"); return null; }
      score += 25;
    }
    var accepted = ts >= 70 || (ts >= 45 && parseInt(iy, 10) === parseInt(info.year, 10));
    log("  candidate \"" + x.it.t + "\" title=" + ts + " year=" + iy + " score=" + score + (accepted ? "" : " (rejected)"));
    return accepted ? { item: x.it, post: post, score: score } : null;
  }));
  var ok = scored.filter(Boolean).sort(function(a, b) { return b.score - a.score; });
  return ok.length ? ok[0] : null;
}

async function pickMatch(results, info, isMovieType, season) {
  var pick = await selectBest(results, info, isMovieType, season);
  if (pick) return pick;
  var tried = {};
  tried[selTokens(info.title).join(" ")] = 1;
  var extra = [info.originalTitle].concat((info.titles || []).slice(2, 4));
  for (var i = 0; i < extra.length; i++) {
    var q = extra[i];
    var key = selTokens(q).join(" ");
    if (!q || !key || tried[key]) continue;
    tried[key] = 1;
    log("No match yet, searching: \"" + q + "\"");
    var r2 = [];
    try { r2 = await search(q); } catch (e) {}
    pick = await selectBest(r2, info, isMovieType, season);
    if (pick) return pick;
  }
  throw new Error("No matching " + (isMovieType ? "movie" : "series") + " for \"" + info.title + "\" (" + info.year + ")");
}

function tmdbTitles(d) {
  var list = [d.title || d.name, d.original_title || d.original_name];
  var alt = d.alternative_titles ? (d.alternative_titles.titles || d.alternative_titles.results || []) : [];
  alt.forEach(function(a) {
    if (a && a.title && /^(IN|US|GB)$/.test(a.iso_3166_1 || "") && list.length < 12) list.push(a.title);
  });
  var out = [];
  list.forEach(function(t) { if (t && out.indexOf(t) < 0) out.push(t); });
  return out;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  await fetchToken();

  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  const isMovieType = (mediaType === "movie");
  log(`TMDB: "${title}" (${year}) [${isMovieType ? 'Movie' : 'Series'}]`);

  const results = await searchWithFallback(title, year).catch(() => []);
  log("Search results: " + results.length);

  const pick = await pickMatch(results, tmdbInfo, isMovieType, season);
  const selected = pick.item;
  const post = pick.post;
  log(`Selected: "${selected.t}" (${post.year || selected.y}) type=${post.type}`);

  let contentId;

  // ---- FIX: Treat "t" as TV series ----
  const isMovie = isMovieType;

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