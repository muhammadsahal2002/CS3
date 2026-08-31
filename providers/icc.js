// mobile_icc.js – ICC FTP Server (Simplified)
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

let sessionCache = null;
let tokenCache = null;

function log(msg) { console.log("[ICCFTP] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function extractId(url) {
  if (!url) return "";
  var after = url.split("play=");
  if (after.length < 2) return "";
  return after[1].split("&")[0] || "";
}

function createLink(id) {
  if (!id) return "";
  var session = sessionCache || "";
  if (session) {
    return BASE_URL + "/player.php?session=" + session + "&play=" + id;
  }
  return BASE_URL + "/player.php?play=" + id;
}

function fixImage(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return BASE_URL + "/" + path;
}

function normalizeTitleForSearch(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ========== SESSION & TOKEN (using fetch) ==========
async function fetchSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

  log("Getting session and token...");

  try {
    // Step 1: Get session from homepage
    log("Fetching homepage: " + BASE_URL);
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) {
      log("Homepage error: HTTP " + resp.status);
      throw new Error("Failed to connect: HTTP " + resp.status);
    }
    
    const html = await resp.text();
    log("Homepage length: " + html.length);

    // Extract session
    let session = "";
    const sessionMatch = html.match(/session=([a-f0-9]{40,})/);
    if (sessionMatch) {
      session = sessionMatch[1];
      log("Session found: " + session.substring(0, 20) + "...");
    } else {
      const cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
      if (cookieMatch) {
        session = cookieMatch[1];
        log("Session from cookie: " + session.substring(0, 20) + "...");
      }
    }

    if (!session) {
      log("No session found in HTML");
      // Try to get session from the URL in the page
      const urlMatch = html.match(/dashboard\.php\?session=([a-f0-9]+)/);
      if (urlMatch) {
        session = urlMatch[1];
        log("Session from URL: " + session.substring(0, 20) + "...");
      }
    }

    if (!session) {
      throw new Error("Could not extract session");
    }
    sessionCache = session;

    // Step 2: Get token from dashboard
    const dashboardUrl = BASE_URL + "/dashboard.php?session=" + session + "&category=0";
    log("Fetching dashboard: " + dashboardUrl);
    
    const dashResp = await fetch(dashboardUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    
    if (!dashResp.ok) {
      log("Dashboard error: HTTP " + dashResp.status);
      throw new Error("Failed to get dashboard: HTTP " + dashResp.status);
    }
    
    const dashHtml = await dashResp.text();
    log("Dashboard length: " + dashHtml.length);

    let token = "";
    const tokenMatch = dashHtml.match(/name="token"\s+value="([^"]+)"/);
    if (tokenMatch) {
      token = tokenMatch[1];
      log("Token found: " + token);
    }

    if (!token) {
      throw new Error("Could not extract token");
    }
    tokenCache = token;

    log("Session and token ready");
    return { session, token };

  } catch (err) {
    log("Error: " + err.message);
    throw err;
  }
}

// ========== TMDB HELPERS ==========
async function getTmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("TMDB error: HTTP " + resp.status);
  const data = await resp.json();
  const title = data.title || data.name;
  const year = data.release_date ? data.release_date.substring(0,4) :
               (data.first_air_date ? data.first_air_date.substring(0,4) : "");
  return { title, year };
}

// ========== SEARCH ==========
async function searchICC(query) {
  if (!query || query.trim().length === 0) return [];

  log("Searching: " + query);

  try {
    const { session, token } = await fetchSessionAndToken();
    const url = BASE_URL + "/dashboard.php?session=" + session;
    const body = "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim());

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": BASE_URL + "/"
      },
      body: body
    });

    if (!resp.ok) {
      log("Search error: HTTP " + resp.status);
      return [];
    }

    const html = await resp.text();
    log("Search response length: " + html.length);

    // Parse with regex to avoid cheerio dependency issues
    const results = [];
    
    // Find all play links
    const playRegex = /<a[^>]*href=["'][^"']*play=([^"']+)["'][^>]*>/gi;
    let match;
    const foundIds = new Set();
    
    while ((match = playRegex.exec(html)) !== null) {
      const fullId = match[1];
      const id = fullId.split("&")[0];
      if (!id || foundIds.has(id)) continue;
      foundIds.add(id);
      
      // Try to find title near this link
      let title = "";
      const linkStart = match.index;
      const searchEnd = Math.min(linkStart + 500, html.length);
      const searchStart = Math.max(0, linkStart - 500);
      const context = html.substring(searchStart, searchEnd);
      
      // Look for title in nearby text
      const titleMatch = context.match(/<div[^>]*class=["'][^"']*title["'][^>]*>([^<]+)<\/div>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
      if (!title) {
        const altMatch = context.match(/alt=["']([^"']+)["']/i);
        if (altMatch) title = altMatch[1].trim();
      }
      if (!title) {
        // Try to find text between <a> tags
        const textMatch = context.match(/>([^<]+)<\/a>/i);
        if (textMatch) title = textMatch[1].trim();
      }
      
      if (title) {
        log("Found: " + title + " (ID: " + id + ")");
        results.push({
          id: id,
          t: title,
          y: null
        });
      }
    }

    log("Found " + results.length + " results");
    return results;

  } catch (err) {
    log("Search error: " + err.message);
    return [];
  }
}

async function searchWithFallback(originalTitle, year) {
  let results = await searchICC(originalTitle);
  if (results.length > 0) return results;

  const normalized = normalizeTitleForSearch(originalTitle);
  log("No results, trying normalized: " + normalized);
  return await searchICC(normalized);
}

// ========== LOAD ==========
async function getPost(id) {
  log("Loading ID: " + id);

  try {
    const { session } = await fetchSessionAndToken();
    const url = BASE_URL + "/player.php?session=" + session + "&play=" + id;
    
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": BASE_URL + "/"
      }
    });

    if (!resp.ok) {
      log("Player error: HTTP " + resp.status);
      throw new Error("Failed to load player");
    }

    const html = await resp.text();
    log("Player HTML length: " + html.length);

    // Extract video URLs using regex
    const videoUrls = [];
    const videoRegex = /<a[^>]*href=["']([^"']*\.(mp4|mkv|avi)[^"']*)["']/gi;
    let match;
    while ((match = videoRegex.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith("http")) {
        url = BASE_URL + "/" + url;
      }
      videoUrls.push(url);
      log("Found video: " + url);
    }

    // Also check video tags
    const videoTagRegex = /<video[^>]*src=["']([^"']+)["']/gi;
    while ((match = videoTagRegex.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith("http")) {
        url = BASE_URL + "/" + url;
      }
      if (videoUrls.indexOf(url) === -1) {
        videoUrls.push(url);
        log("Found video (tag): " + url);
      }
    }

    // Extract title
    let title = "";
    const titleMatch = html.match(/<div[^>]*class=["'][^"']*modal-title["'][^>]*>([^<]+)<\/div>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    if (!title) {
      const pageTitle = html.match(/<title>([^<]+)<\/title>/i);
      if (pageTitle) {
        title = pageTitle[1].replace("ICC FTP SERVER", "").trim();
      }
    }

    // Determine if series
    const isSeries = title.toLowerCase().includes("season") || 
                     title.toLowerCase().includes("episode") ||
                     html.toLowerCase().includes("serials");

    return {
      id: id,
      title: title || "Unknown",
      type: isSeries ? "t" : "m",
      videoUrls: videoUrls,
      main_id: null
    };

  } catch (err) {
    log("Load error: " + err.message);
    throw err;
  }
}

// ========== MAIN ==========
async function getStreams(tmdbId, mediaType, season, episode) {
  log("========================================");
  log("Searching for TMDB ID: " + tmdbId);
  log("Type: " + mediaType);
  log("========================================");

  try {
    const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
    log('TMDB: "' + tmdbInfo.title + '" (' + tmdbInfo.year + ')');

    const results = await searchWithFallback(tmdbInfo.title, tmdbInfo.year);
    if (!results || results.length === 0) {
      log("No results found");
      return [];
    }

    log("Found " + results.length + " results");

    // Pick first result
    const selected = results[0];
    log('Selected: "' + selected.t + '" (ID: ' + selected.id + ')');

    const post = await getPost(selected.id);
    log('Type: ' + post.type + ', title: ' + post.title);
    log('Video URLs: ' + post.videoUrls.length);

    if (!post.videoUrls || post.videoUrls.length === 0) {
      log("No video URLs found");
      return [];
    }

    // Build streams
    const streams = post.videoUrls.map(function(url) {
      let quality = "Auto";
      const lower = url.toLowerCase();
      if (lower.includes("1080p") || lower.includes("1920x1080")) quality = "Full HD";
      else if (lower.includes("720p") || lower.includes("1280x720")) quality = "Mid HD";
      else if (lower.includes("480p") || lower.includes("854x480")) quality = "Low HD";

      return {
        name: "ICC FTP",
        title: quality,
        url: url,
        quality: quality,
        headers: {
          "Referer": BASE_URL + "/",
          "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
          "Range": "bytes=0-"
        }
      };
    });

    log("Returning " + streams.length + " streams");
    return streams;

  } catch (err) {
    log("ERROR: " + err.message);
    return [];
  }
}

module.exports = { getStreams };