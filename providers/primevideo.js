// primevideo.js – Prime Video API (Debug Version)
// =================================================================
const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";

const TOKEN_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/token.json";
const BASE_URL = "https://net52.cc/mobile/pv";

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
let userHash = null;

function log(msg) { console.log("[PrimeVideo] " + msg); }
function getTimestamp() { return Math.floor(Date.now() / 1000); }

async function fetchToken() {
  if (tokenCache) return tokenCache;
  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Failed to fetch token: HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.t_hash_t || !json.addhash) throw new Error("Missing token fields");
  tokenCache = json;
  
  // Build cookie with ott=pv (from logs)
  cookieHeader = `t_hash_t=${json.t_hash_t}; t_hash=${json.addhash}; hd=on; ott=pv`;
  
  // userhash = decoded t_hash_t (from logs)
  userHash = decodeURIComponent(json.t_hash_t);
  
  log(`Cookie: ${cookieHeader}`);
  log(`UserHash: ${userHash}`);
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
  const data = await resp.json();
  log(`Response: ${JSON.stringify(data).substring(0, 200)}...`);
  return data;
}

// ---------- PV API calls ----------
async function search(query) {
  const url = `https://net52.cc/mobile/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (!data.searchResult) throw new Error("Search failed");
  return data.searchResult;
}

async function getPost(id) {
  const url = `${BASE_URL}/post.php?id=${id}&t=${getTimestamp()}`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Post failed");
  return data;
}

async function getPlaylist(id, title, lang = "hin") {
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}&lang=${lang}&hd=on&userhash=${encodeURIComponent(userHash)}`;
  log(`Playlist URL: ${url}`);
  const headers = buildHeaders({}, "app.netmirror.nmv2");
  const data = await fetchJson(url, { headers });
  if (!Array.isArray(data) || !data.length) {
    throw new Error("Empty playlist response");
  }
  return data[0];
}

// ---------- TMDB helper ----------
async function getTmdbTitle(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  return data.title || data.name;
}

// ---------- Main exported function ----------
async function getStreams(tmdbId, mediaType, season, episode, lang = "hin") {
  try {
    log("=== Starting Prime Video Stream Fetch ===");
    await fetchToken();

    const title = await getTmdbTitle(tmdbId, mediaType);
    log(`TMDB title: ${title}`);

    const results = await search(title);
    log(`Search results: ${JSON.stringify(results)}`);
    if (!results.length) throw new Error(`No results for "${title}"`);
    
    // Find PV result
    let selected = null;
    for (const r of results) {
      if (r.id && /^[0-9A-Z]{10,}$/.test(r.id)) {
        selected = r;
        break;
      }
    }
    if (!selected) selected = results[0];
    log(`Selected: ${selected.t} (ID: ${selected.id})`);

    const post = await getPost(selected.id);
    log(`Post type: ${post.type}, title: ${post.title}`);
    
    let contentId;

    if (post.type === "m" || season === undefined || episode === undefined) {
      contentId = post.main_id || selected.id;
      log(`Movie mode - using ID: ${contentId}`);
    } else {
      log(`Series mode - looking for S${season}E${episode}`);
      const seasonList = post.season || [];
      log(`Seasons available: ${JSON.stringify(seasonList)}`);
      
      let targetSeasonId = null;
      for (const s of seasonList) {
        const seasonNum = parseInt(s.s, 10);
        log(`Checking season: ${s.s} -> ${seasonNum}`);
        if (seasonNum === season) {
          targetSeasonId = s.id;
          log(`Found season ${season} with ID ${targetSeasonId}`);
          break;
        }
      }
      if (!targetSeasonId) throw new Error(`Season ${season} not found`);

      // For PV, we need to get episodes differently
      // Let's try using the episodes from post first (if available)
      let targetEp = null;
      const episodes = post.episodes || [];
      log(`Episodes from post: ${JSON.stringify(episodes)}`);
      
      for (const ep of episodes) {
        if (ep && ep.ep) {
          const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
          log(`Checking episode: ${ep.ep} -> ${epNum}`);
          if (epNum === episode) {
            targetEp = ep;
            break;
          }
        }
      }
      
      if (!targetEp) {
        // Try fetching episodes from season endpoint
        log("Trying to fetch episodes from season endpoint...");
        const url = `https://net52.cc/mobile/episodes.php?s=${targetSeasonId}&series=${selected.id}&t=${getTimestamp()}`;
        const headers = buildHeaders({}, "XMLHttpRequest");
        const data = await fetchJson(url, { headers });
        const allEpisodes = data.episodes || [];
        log(`Fetched ${allEpisodes.length} episodes`);
        
        for (const ep of allEpisodes) {
          if (ep && ep.ep) {
            const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
            if (epNum === episode) {
              targetEp = ep;
              break;
            }
          }
        }
      }
      
      if (!targetEp) throw new Error(`Episode ${episode} not found`);
      contentId = targetEp.id;
      log(`Episode found: ${targetEp.t} (ID: ${contentId})`);
    }

    const playlist = await getPlaylist(contentId, title, lang);
    log(`Playlist sources: ${playlist.sources ? playlist.sources.length : 0}`);
    
    if (!playlist.sources || !playlist.sources.length) {
      throw new Error("No sources in playlist");
    }

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

    log(`=== Success! Returning ${streams.length} streams ===`);
    return streams;
    
  } catch (error) {
    log(`ERROR: ${error.message}`);
    log(`Stack: ${error.stack}`);
    throw error;
  }
}

module.exports = { getStreams };