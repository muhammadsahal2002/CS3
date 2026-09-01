// mobile_icc.js – ICC FTP Server
// Based on captured requests from the working app
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "Referer": BASE_URL + "/",
  "Connection": "keep-alive",
  "X-Requested-With": "com.mycompany.app.soulbrowser"
};

let sessionCache = null;
let tokenCache = null;

function log(msg) { console.log("[ICCFTP] " + msg); }

function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

// ========== HELPERS ==========
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

function extractYearFromTitle(title) {
  if (!title) return null;
  var match = title.match(/\((\d{4})\)/);
  if (match) return match[1];
  var match2 = title.match(/\b(19\d{2}|20\d{2})\b/);
  if (match2) return match2[1];
  return null;
}

// ========== SESSION & TOKEN ==========
async function fetchSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

  log("Getting session and token...");

  try {
    // Step 1: Get session from homepage
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to connect: HTTP " + resp.status);
    
    const html = await resp.text();
    log("Homepage length: " + html.length);

    // Extract session (like Kotlin regex)
    let session = "";
    var sessionMatch = html.match(/session=([a-f0-9]{40,})/);
    if (sessionMatch) {
      session = sessionMatch[1];
    } else {
      var cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
      if (cookieMatch) session = cookieMatch[1];
    }

    if (!session) throw new Error("Could not extract session");
    sessionCache = session;
    log("Session: " + session.substring(0, 20) + "...");

    // Step 2: Get token from dashboard
    const dashboardUrl = BASE_URL + "/dashboard.php?session=" + session + "&category=0";
    const dashResp = await fetch(dashboardUrl, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": DEFAULT_HEADERS["Accept"],
        "Referer": BASE_URL + "/"
      }
    });
    
    if (!dashResp.ok) throw new Error("Failed to get dashboard: HTTP " + dashResp.status);
    
    const dashHtml = await dashResp.text();
    log("Dashboard length: " + dashHtml.length);

    let token = "";
    var tokenMatch = dashHtml.match(/name="token"\s+value="([^"]+)"/);
    if (tokenMatch) {
      token = tokenMatch[1];
      log("Token: " + token);
    }

    if (!token) throw new Error("Could not extract token");
    tokenCache = token;

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

  log("Searching ICC FTP for: " + query);

  try {
    const { session, token } = await fetchSessionAndToken();
    const url = BASE_URL + "/dashboard.php?session=" + session;
    const body = "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim());

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Origin": BASE_URL,
        "Referer": url,
        "X-Requested-With": DEFAULT_HEADERS["X-Requested-With"]
      },
      body: body
    });

    if (!resp.ok) {
      log("Search error: HTTP " + resp.status);
      return [];
    }

    const html = await resp.text();
    log("Search response length: " + html.length);

    const results = [];
    const seenIds = new Set();

    // Parse .post items (like the HTML shows)
    // Pattern: <div class="post"> <a href="...play=ID"> <img src="image"> <div class="title">TITLE</div>
    const postRegex = /<div[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*play=([^&"]+)[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/gi;
    
    let match;
    while ((match = postRegex.exec(html)) !== null) {
      const id = match[1].trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      
      const image = match[2] || "";
      let title = match[3] ? match[3].trim() : "";
      
      if (!title) {
        // Try to get from alt attribute
        const altMatch = html.substring(Math.max(0, match.index - 200), match.index + 500).match(/alt=["']([^"']+)["']/);
        if (altMatch) title = altMatch[1];
      }
      
      if (!title) continue;
      
      const year = extractYearFromTitle(title);
      
      log("Found: " + title + " (ID: " + id + ", Year: " + (year || 'unknown') + ")");
      
      results.push({
        id: id,
        t: title,
        y: year,
        image: fixImage(image)
      });
    }

    // Fallback: simpler pattern
    if (results.length === 0) {
      log("Trying fallback pattern...");
      const simpleRegex = /play=([^&"']+)/g;
      let simpleMatch;
      while ((simpleMatch = simpleRegex.exec(html)) !== null) {
        const id = simpleMatch[1].trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        
        const context = html.substring(Math.max(0, simpleMatch.index - 300), Math.min(html.length, simpleMatch.index + 500));
        let title = "";
        
        const titleRegex = /<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/i;
        const titleMatch = context.match(titleRegex);
        if (titleMatch) title = titleMatch[1].trim();
        
        if (!title) {
          const altRegex = /alt=["']([^"']+)["']/i;
          const altMatch = context.match(altRegex);
          if (altMatch) title = altMatch[1].trim();
        }
        
        if (!title) continue;
        
        const year = extractYearFromTitle(title);
        
        log("Found (fallback): " + title + " (ID: " + id + ")");
        
        results.push({
          id: id,
          t: title,
          y: year,
          image: null
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

// ========== LOAD ==========
async function loadICC(id) {
  log("Loading ID: " + id);

  try {
    // Step 1: Send visit command (like the working app)
    const { session } = await fetchSessionAndToken();
    
    await fetch(BASE_URL + "/command.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": BASE_URL + "/dashboard.php?session=" + session,
        "X-Requested-With": "XMLHttpRequest"
      },
      body: "id=" + id + "&type=visit"
    }).catch(function() { return null; });

    // Step 2: Get player page
    const playerUrl = BASE_URL + "/player.php?session=" + session + "&play=" + id;
    log("Player URL: " + playerUrl);
    
    const resp = await fetch(playerUrl, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Accept": DEFAULT_HEADERS["Accept"],
        "X-Requested-With": "com.mycompany.app.soulbrowser",
        "Referer": BASE_URL + "/dashboard.php?session=" + session
      }
    });

    if (!resp.ok) {
      log("Player error: HTTP " + resp.status);
      throw new Error("Failed to load player");
    }

    const html = await resp.text();
    log("Player HTML length: " + html.length);

    // Extract video URL from <source> tag (like the working app)
    // <source src='http://10.16.100.212/.../Titanic%20(1997)%201080p%20BluRay.mp4'>
    const videoUrls = [];
    
    // Pattern for video source
    const sourceRegex = /<source[^>]*src='([^']*)'[^>]*>/gi;
    let match;
    while ((match = sourceRegex.exec(html)) !== null) {
      let url = match[1];
      if (url && url.includes(".mp4")) {
        if (!url.startsWith("http")) {
          url = BASE_URL + "/" + url;
        }
        videoUrls.push(url);
        log("Found video source: " + url);
      }
    }

    // Also check for download link (like the modal shows)
    // <a href="http://10.16.100.212/.../Titanic%20(1997)%201080p%20BluRay.mp4" download>
    const downloadRegex = /<a[^>]*href=["']([^"']*\.mp4[^"']*)["'][^>]*download/i;
    while ((match = downloadRegex.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith("http")) {
        url = BASE_URL + "/" + url;
      }
      if (videoUrls.indexOf(url) === -1) {
        videoUrls.push(url);
        log("Found download link: " + url);
      }
    }

    // Extract title
    let title = "";
    const titleMatch = html.match(/<span[^>]*style="[^"]*font-size: 30px[^"]*"[^>]*>([^<]*)<\/span>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    if (!title) {
      const pageTitle = html.match(/<title>([^<]*)<\/title>/i);
      if (pageTitle) {
        title = pageTitle[1].replace("ICC FTP SERVER", "").trim();
      }
    }

    // Extract year
    let year = null;
    const yearMatch = html.match(/<td>Year:<\/td>\s*<td>(\d{4})<\/td>/i);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }

    // Extract category
    let category = "";
    const categoryMatch = html.match(/<td>Category:<\/td>\s*<td>([^<]*)<\/td>/i);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
    }

    // Determine if series
    const isSeries = title.toLowerCase().includes("season") ||
      title.toLowerCase().includes("episode") ||
      category.toLowerCase().includes("serials");

    return {
      id: id,
      title: title || "Unknown",
      year: year,
      category: category,
      type: isSeries ? "t" : "m",
      videoUrls: videoUrls
    };

  } catch (err) {
    log("Load error: " + err.message);
    throw err;
  }
}

// ========== MAIN getStreams ==========
async function getStreams(tmdbId, mediaType, season, episode) {
  log("========================================");
  log("Searching for TMDB ID: " + tmdbId);
  log("Type: " + mediaType);
  log("========================================");

  try {
    const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
    const title = tmdbInfo.title;
    const targetYear = tmdbInfo.year;
    const isMovieType = (mediaType === "movie");
    log('TMDB: "' + title + '" (' + targetYear + ') [' + (isMovieType ? 'Movie' : 'Series') + ']');

    // Search
    let results = await searchICC(title);
    if (!results || results.length === 0) {
      const normalized = normalizeTitleForSearch(title);
      log("No results, trying normalized: " + normalized);
      results = await searchICC(normalized);
    }
    
    if (!results || results.length === 0) {
      log("No results found");
      return [];
    }

    log("Found " + results.length + " total results");

    // Score and select best match
    let candidates = results;
    let bestMatch = null;
    let bestScore = -999;
    const targetTitle = title.toLowerCase();
    const targetNormalized = normalizeTitleForSearch(targetTitle);

    for (const item of candidates) {
      const itemTitle = item.t.toLowerCase();
      const itemNormalized = normalizeTitleForSearch(itemTitle);
      let score = 0;

      // Exact match
      if (itemTitle === targetTitle || itemNormalized === targetNormalized) {
        score = 100;
      }
      // Contains the full title
      else if (itemNormalized.includes(targetNormalized)) {
        score = 80;
      }
      // Title is contained in the result
      else if (targetNormalized.includes(itemNormalized)) {
        score = 60;
      }
      // Partial word matches
      else {
        const words = targetNormalized.split(" ");
        let matched = 0;
        for (const word of words) {
          if (word.length > 2 && itemNormalized.includes(word)) {
            matched++;
          }
        }
        score = (matched / words.length) * 50;
      }

      // Bonus for year match
      if (item.y === targetYear) {
        score += 30;
      }

      // Penalty for wrong year (if year is known)
      if (targetYear && item.y && item.y !== targetYear) {
        score -= 40;
      }

      // Penalty for unrelated titles
      if (itemTitle.includes("666") || itemTitle.includes("resurrection")) {
        score -= 50;
      }

      log('Score for "' + item.t + '": ' + score);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    if (!bestMatch) {
      log("No match found, using first result");
      bestMatch = candidates[0];
    }

    log('Selected: "' + bestMatch.t + '" (ID: ' + bestMatch.id + ', Score: ' + bestScore + ')');

    // Load the content
    const post = await loadICC(bestMatch.id);
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
          "User-Agent": DEFAULT_HEADERS["User-Agent"],
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