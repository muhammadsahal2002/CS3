// primevideo.js – Prime Video API with debug info as quality options
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
let debugSteps = [];

function log(step, data = null) {
  const msg = data ? `${step}: ${JSON.stringify(data)}` : step;
  console.log("[PrimeVideo] " + msg);
  debugSteps.push({ step, msg, data });
}

function getTimestamp() { return Math.floor(Date.now() / 1000); }

async function fetchToken() {
  if (tokenCache) return tokenCache;
  log("🔑 Fetching token from GitHub");
  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Failed to fetch token: HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.t_hash_t || !json.addhash) throw new Error("Missing token fields");
  tokenCache = json;
  
  cookieHeader = `t_hash_t=${json.t_hash_t}; t_hash=${json.addhash}; hd=on; ott=pv`;
  userHash = decodeURIComponent(json.t_hash_t);
  
  log("✅ Token loaded", { 
    t_hash_t: json.t_hash_t.substring(0, 30) + '...',
    addhash: json.addhash.substring(0, 30) + '...'
  });
  log("🔑 UserHash", userHash.substring(0, 50) + '...');
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
  log(`🌐 Requesting`, url.substring(0, 80) + '...');
  const resp = await fetch(url, options);
  if (!resp.ok) {
    log(`❌ HTTP Error ${resp.status}`, url);
    throw new Error(`HTTP ${resp.status} on ${url}`);
  }
  const data = await resp.json();
  log(`✅ Response received`, { status: resp.status, keys: Object.keys(data).join(', ') });
  return data;
}

// ---------- PV API calls ----------
async function search(query) {
  const url = `https://net52.cc/mobile/search.php?s=${encodeURIComponent(query)}&t=${getTimestamp()}&ADSearch=false`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (!data.searchResult) throw new Error("Search failed");
  log(`📋 Search results found`, data.searchResult.length);
  return data.searchResult;
}

async function getPost(id) {
  const url = `${BASE_URL}/post.php?id=${id}&t=${getTimestamp()}`;
  const headers = buildHeaders({}, "XMLHttpRequest");
  const data = await fetchJson(url, { headers });
  if (data.status !== "y") throw new Error("Post failed");
  log(`📄 Post details`, { type: data.type, title: data.title, hasSeason: !!data.season });
  return data;
}

async function getPlaylist(id, title, lang = "hin") {
  const url = `${BASE_URL}/playlist.php?id=${id}&t=${encodeURIComponent(title)}&tm=${getTimestamp()}&lang=${lang}&hd=on&userhash=${encodeURIComponent(userHash)}`;
  const headers = buildHeaders({}, "app.netmirror.nmv2");
  const data = await fetchJson(url, { headers });
  if (!Array.isArray(data) || !data.length) {
    log(`❌ Empty playlist`, { id, title });
    throw new Error("Empty playlist response");
  }
  const sourceCount = data[0].sources ? data[0].sources.length : 0;
  log(`🎬 Playlist loaded`, { sources: sourceCount });
  return data[0];
}

// ---------- TMDB helper ----------
async function getTmdbTitle(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  const title = data.title || data.name;
  log(`🎯 TMDB title`, title);
  return title;
}

// ---------- Main exported function ----------
async function getStreams(tmdbId, mediaType, season, episode, lang = "hin") {
  // Reset debug steps
  debugSteps = [];
  log(`🚀 START: ${mediaType} ID:${tmdbId} S${season || '?'}E${episode || '?'}`, { lang });
  
  try {
    await fetchToken();

    const title = await getTmdbTitle(tmdbId, mediaType);
    const results = await search(title);
    if (!results.length) throw new Error(`No results for "${title}"`);
    
    // Find PV result (alphanumeric ID pattern)
    let selected = null;
    for (const r of results) {
      if (r.id && /^[0-9A-Z]{10,}$/.test(r.id)) {
        selected = r;
        break;
      }
    }
    if (!selected) selected = results[0];
    log(`✅ Selected result`, { title: selected.t, id: selected.id });

    const post = await getPost(selected.id);
    let contentId;

    if (post.type === "m" || season === undefined || episode === undefined) {
      contentId = post.main_id || selected.id;
      log(`🎬 Movie mode`, { contentId });
    } else {
      log(`📺 Series mode`, { season, episode });
      const seasonList = post.season || [];
      log(`📋 Available seasons`, seasonList.map(s => s.s));
      
      let targetSeasonId = null;
      for (const s of seasonList) {
        const seasonNum = parseInt(s.s, 10);
        if (seasonNum === season) {
          targetSeasonId = s.id;
          log(`✅ Found season ${season}`, { id: targetSeasonId });
          break;
        }
      }
      if (!targetSeasonId) throw new Error(`Season ${season} not found`);

      // Try episodes from post first
      let targetEp = null;
      const episodes = post.episodes || [];
      log(`📋 Episodes in post`, episodes.length);
      
      for (const ep of episodes) {
        if (ep && ep.ep) {
          const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
          if (epNum === episode) {
            targetEp = ep;
            log(`✅ Found episode in post`, { title: ep.t, id: ep.id });
            break;
          }
        }
      }
      
      if (!targetEp) {
        log(`📡 Fetching episodes from season endpoint`);
        const url = `https://net52.cc/mobile/episodes.php?s=${targetSeasonId}&series=${selected.id}&t=${getTimestamp()}`;
        const headers = buildHeaders({}, "XMLHttpRequest");
        const data = await fetchJson(url, { headers });
        const allEpisodes = data.episodes || [];
        log(`📋 Season episodes fetched`, allEpisodes.length);
        
        for (const ep of allEpisodes) {
          if (ep && ep.ep) {
            const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
            if (epNum === episode) {
              targetEp = ep;
              log(`✅ Found episode`, { title: ep.t, id: ep.id });
              break;
            }
          }
        }
      }
      
      if (!targetEp) throw new Error(`Episode ${episode} not found`);
      contentId = targetEp.id;
    }

    const playlist = await getPlaylist(contentId, title, lang);
    if (!playlist.sources || !playlist.sources.length) {
      throw new Error("No sources in playlist");
    }

    // Build stream objects
    const streams = playlist.sources.map((src, index) => {
      const fileUrl = src.file.startsWith("http") ? src.file : `https://net52.cc${src.file}`;
      return {
        name: "Prime Video",
        title: src.label || "Auto",
        url: fileUrl,
        quality: src.label || `Source ${index + 1}`,
        headers: {
          Referer: "https://net52.cc/",
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
          "Cookie": cookieHeader,
          "Origin": "https://net52.cc"
        }
      };
    });

    // Add debug streams - each step as a separate quality option
    debugSteps.forEach((step, index) => {
      streams.push({
        name: `🔍 ${step.step}`,
        title: step.msg.substring(0, 50),
        url: "data:text/plain," + encodeURIComponent(step.msg + (step.data ? '\nData: ' + JSON.stringify(step.data, null, 2) : '')),
        quality: `Step ${index + 1}/${debugSteps.length}`,
        headers: {}
      });
    });

    // Add a final success stream
    streams.push({
      name: "✅ SUCCESS",
      title: `${streams.length - debugSteps.length - 1} video streams + ${debugSteps.length} debug steps`,
      url: "data:text/plain," + encodeURIComponent(debugSteps.map(s => s.msg).join('\n')),
      quality: "Complete",
      headers: {}
    });

    log(`🎉 COMPLETE: ${streams.length} total options`);
    return streams;
    
  } catch (error) {
    log(`💥 ERROR`, error.message);
    
    // Build error streams
    const errorStreams = [];
    
    // Add debug steps as error streams
    debugSteps.forEach((step, index) => {
      errorStreams.push({
        name: `🔍 ${step.step}`,
        title: step.msg.substring(0, 50),
        url: "data:text/plain," + encodeURIComponent(step.msg + (step.data ? '\nData: ' + JSON.stringify(step.data, null, 2) : '')),
        quality: `Step ${index + 1}/${debugSteps.length}`,
        headers: {}
      });
    });
    
    // Add the error itself
    errorStreams.push({
      name: "❌ ERROR",
      title: error.message,
      url: "data:text/plain," + encodeURIComponent(
        'ERROR: ' + error.message + '\n\n' +
        error.stack + '\n\n' +
        'Full Debug Log:\n' +
        debugSteps.map(s => s.msg).join('\n')
      ),
      quality: "❌ Failed",
      headers: {}
    });
    
    log(`❌ Returning ${errorStreams.length} error streams`);
    return errorStreams;
  }
}

module.exports = { getStreams };