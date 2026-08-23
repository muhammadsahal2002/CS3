// primevideo.js – Prime Video API (net52.cc/mobile/pv)
// =================================================================
// Based on the Hotstar script but adapted for Prime Video.
// Adds `ott=pv` cookie, `userhash` and `lang` to playlist requests.

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

const TOKEN_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/token.json";
const BASE_URL = "https://net52.cc/mobile/pv";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 17; SM-S928B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.139 Mobile Safari/537.36",
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
let userHash = null;

function log(msg) { console.log("[PrimeVideo] " + msg); }

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
  // Prime Video requires ott=pv in the cookie
  cookieHeader = `t_hash_t=${json.t_hash_t}; t_hash=${json.addhash}; hd=on; ott=pv`;
  // userhash is the decoded t_hash_t (same as used in the URL parameter)
  userHash = decodeURIComponent(json.t_hash_t);
  log("Token loaded with ott=pv");
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
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
  return resp.json();
}

// ---------- API calls ----------
async function search(query) {
  // Prime Video uses the same search endpoint, but with ott=pv cookie
  const url = `https://net52.cc/mobile/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
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
    let url = `https://net52.cc/mobile/episodes.php?s=${seasonId}&series=${seriesId}&t=${getTimestamp()}`;
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

async function getPlaylist(id, title, lang = "hin") {
  // Prime Video playlist requires lang and userhash parameters
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}&lang=${lang}&hd=on&userhash=${encodeURIComponent(userHash)}`;
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
// Additional parameter: lang (default 'hin') for audio language
async function getStreams(tmdbId, mediaType, season, episode, lang = "hin") {
  await fetchToken();

  const title = await getTmdbTitle(tmdbId, mediaType);
  log(`Title: ${title}`);

  const results = await search(title);
  if (!results.length) throw new Error(`No results for "${title}"`);
  // For Prime Video, prefer IDs that look like PV IDs (starting with 0 and alphanumeric)
  let selected = results.find(r => r.id && /^0[A-Z0-9]{10,}$/.test(r.id)) || results[0];
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

    // Find the season ID by matching the number directly
    for (const s of seasonList) {
      // s.s is the season number as a string, e.g., "1", "2", ...
      if (parseInt(s.s, 10) === season) {
        targetSeasonId = s.id;
        break;
      }
    }

    if (!targetSeasonId) {
      throw new Error(`Season ${season} not found in series data`);
    }
    log(`Season ID: ${targetSeasonId}`);

    // Fetch all episodes for this season (handles pagination)
    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) throw new Error(`No episodes for season ${season}`);

    // Find the target episode by matching the number after "E"
    let targetEp = null;
    for (const ep of episodes) {
      // ep.ep is like "E1", "E2", ...
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

  // Get playlist (sources) for the content, passing language
  const playlist = await getPlaylist(contentId, title, lang);
  if (!playlist.sources || !playlist.sources.length) {
    throw new Error("No sources in playlist");
  }

  // Build stream objects
  const streams = playlist.sources.map(src => {
    const fileUrl = src.file.startsWith("http") ? src.file : `https://net52.cc${src.file}`;
    return {
      name: "Prime Video",
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