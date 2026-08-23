// mobile_newtv.js – Full debug for series
// =================================================================
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

const TOKEN_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/token.json";
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

function log(msg) { console.log("[MobileNewTV] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

async function fetchToken() {
  if (tokenCache) return tokenCache;
  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Failed to fetch token: HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.t_hash_t || !json.addhash) {
    throw new Error("Token JSON missing t_hash_t or addhash");
  }
  tokenCache = json;
  cookieHeader = `t_hash_t=${json.t_hash_t}; t_hash=${json.addhash}; hd=on`;
  log("Token loaded");
  return json;
}

function buildHeaders(extra = {}, requestedWith = "XMLHttpRequest") {
  const h = { ...DEFAULT_HEADERS };
  if (cookieHeader) h["Cookie"] = cookieHeader;
  if (requestedWith) h["X-Requested-With"] = requestedWith;
  if (extra) Object.assign(h, extra);
  return h;
}

async function fetchJson(url, options = {}) {
  log(`Fetching: ${url}`);
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
  return resp.json();
}

// ---------- API calls ----------
async function search(query) {
  const url = `${BASE_URL}/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Search failed: " + (data.error || "unknown"));
  log(`Search results: ${data.searchResult ? data.searchResult.length : 0} items`);
  return data.searchResult || [];
}

async function getPost(id) {
  const url = `${BASE_URL}/post.php?id=${id}&t=${getTimestamp()}`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Post failed: " + (data.error || "unknown"));
  log(`Post type: ${data.type}, title: ${data.title}`);
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
    log(`Fetched ${data.episodes.length} episodes for season (page ${page})`);
    allEpisodes = allEpisodes.concat(data.episodes);
    if (data.nextPageShow === 1 && data.nextPage) {
      page = data.nextPage;
    } else {
      hasNext = false;
    }
  }
  log(`Total episodes for season: ${allEpisodes.length}`);
  return allEpisodes;
}

async function getPlaylist(id, title) {
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}`;
  const headers = buildHeaders({}, "app.netmirror.nmv2");
  const data = await fetchJson(url, { headers });
  if (!Array.isArray(data) || data.length === 0) {
    log("Playlist response is not an array or empty");
    throw new Error("Empty playlist response");
  }
  log(`Playlist received for ID ${id}, sources: ${data[0].sources ? data[0].sources.length : 0}`);
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
  log(`TMDB title: ${title}`);

  const results = await search(title);
  if (!results.length) throw new Error(`No results for "${title}"`);
  const selected = results[0];
  log(`Selected: ${selected.t} (ID: ${selected.id})`);

  const post = await getPost(selected.id);
  log(`Post object keys: ${Object.keys(post).join(', ')}`);

  let contentId;

  if (post.type === "m" || season === undefined || episode === undefined) {
    contentId = post.main_id || selected.id;
    log(`Movie / no episode, using ID: ${contentId}`);
  } else {
    // ---------- TV SERIES ----------
    const seasonList = post.season || [];
    log(`Season list: ${JSON.stringify(seasonList)}`);
    let targetSeasonId = null;

    // Find the season ID by matching the number directly
    for (const s of seasonList) {
      log(`Checking season: s.s = "${s.s}", s.id = "${s.id}"`);
      if (parseInt(s.s, 10) === season) {
        targetSeasonId = s.id;
        log(`Found season ${season} with ID ${targetSeasonId}`);
        break;
      }
    }

    if (!targetSeasonId) {
      throw new Error(`Season ${season} not found in series data`);
    }

    // Fetch episodes
    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) throw new Error(`No episodes for season ${season}`);

    // Find target episode
    let targetEp = null;
    for (const ep of episodes) {
      const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
      log(`Episode: ep.ep = "${ep.ep}" -> epNum = ${epNum}, id = ${ep.id}, title = ${ep.t}`);
      if (epNum === episode) {
        targetEp = ep;
        log(`Found target episode: ${ep.t} (ID: ${ep.id})`);
        break;
      }
    }

    if (!targetEp) {
      throw new Error(`Episode ${episode} not found in season ${season}`);
    }
    contentId = targetEp.id;
  }

  // Get playlist
  const playlist = await getPlaylist(contentId, title);
  if (!playlist.sources || !playlist.sources.length) {
    log("Playlist sources are empty or missing");
    throw new Error("No sources in playlist");
  }

  // Build stream objects
  const streams = playlist.sources.map(src => {
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
      }
    };
  });

  log(`Returning ${streams.length} streams`);
  return streams;
}

module.exports = { getStreams };