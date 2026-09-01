// mobile_icc.js – ICC FTP Server (Fixed)
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

// ========== HELPER FUNCTIONS ==========
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
  const match = title.match(/\((\d{4})\)/);
  if (match) return match[1];
  // Also try "1997" without parentheses
  const match2 = title.match(/\b(19\d{2}|20\d{2})\b/);
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
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to connect: HTTP " + resp.status);
    
    const html = await resp.text();
    log("Homepage length: " + html.length);

    let session = "";
    const sessionMatch = html.match(/session=([a-f0-9]{40,})/);
    if (sessionMatch) {
      session = sessionMatch[1];
    } else {
      const cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
      if (cookieMatch) session = cookieMatch[1];
    }

    if (!session) throw new Error("Could not extract session");
    sessionCache = session;
    log("Session: " + session.substring(0, 20) + "...");

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
    const tokenMatch = dashHtml.match(/name="token"\s+value="([^"]+)"/);
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

// ========== ICC FTP SEARCH ==========
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

    // Parse using regex
    const playRegex = /<a[^>]*href=[^>]*play=([^&"]+)[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/gi;
    
    let match;
    while ((match = playRegex.exec(html)) !== null) {
      const id = match[1].trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      
      const image = match[2] || "";
      let title = match[3] || "";
      
      if (!title) {
        const altMatch = html.substring(Math.max(0, match.index - 200), match.index + 500).match(/alt=["']([^"']+)["']/);
        if (altMatch) title = altMatch[1];
      }
      
      if (!title) continue;
      title = title.trim();
      
      const year = extractYearFromTitle(title);
      
      log("Found: " + title + " (ID: " + id + ", Year: " + (year || 'unknown') + ")");
      
      results.push({
        id: id,
        t: title,
        y: year,
        image: fixImage(image)
      });
    }

    if (results.length === 0) {
      // Fallback pattern
      const simplePlayRegex = /play=([^&"']+)/g;
      let simpleMatch;
      while ((simpleMatch = simplePlayRegex.exec(html)) !== null) {
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

    log("Found " + results.length + " results for: " + query);
    return results;

  } catch (err) {
    log("Search error: " + err.message);
    return [];
  }
}

// ========== ICC FTP LOAD ==========
async function getPost(id) {
  log("Loading ID: " + id);

  try {
    const { session } = await fetchSessionAndToken();
    const url = BASE_URL + "/player.php?session=" + session + "&play=" + id;
    
    const resp = await fetch(url, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": BASE_URL + "/"
      }
    });

    if (!resp.ok) {
      log("Player error: HTTP " + resp.status);
      throw new Error("Failed to load player");
    }

    const html = await resp.text();
    log("Player HTML length: " + html.length);

    // Extract title
    let title = "";
    const titleMatch = html.match(/<div[^>]*class="[^"]*modal-title[^"]*"[^>]*>([^<]*)<\/div>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    if (!title) {
      const pageTitleMatch = html.match(/<title>([^<]*)<\/title>/i);
      if (pageTitleMatch) {
        title = pageTitleMatch[1].replace("ICC FTP SERVER", "").trim();
      }
    }

    // Extract year
    let year = null;
    const yearMatch = html.match(/<td>Year<\/td>\s*<td>(\d{4})<\/td>/i);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }

    // Extract category
    let category = "";
    const categoryMatch = html.match(/<td>Category<\/td>\s*<td>([^<]*)<\/td>/i);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
    }

    // Extract poster
    let poster = "";
    const posterMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    if (posterMatch) {
      poster = fixImage(posterMatch[1]);
    }

    // Extract video URLs
    const videoUrls = [];
    const videoRegex = /<a[^>]*href="([^"]*\.(mp4|mkv|avi)[^"]*)"[^>]*>/gi;
    let match;
    while ((match = videoRegex.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith("http")) {
        url = BASE_URL + "/" + url;
      }
      if (videoUrls.indexOf(url) === -1) {
        videoUrls.push(url);
        log("Found video: " + url);
      }
    }

    if (videoUrls.length === 0) {
      const videoTagRegex = /<video[^>]*src="([^"]*)"[^>]*>/gi;
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
    }

    // Determine if series
    const isSeries = title.toLowerCase().includes("season") ||
      title.toLowerCase().includes("episode") ||
      category.toLowerCase().includes("serials");

    return {
      id: id,
      title: title || "Unknown",
      year: year,
      poster: poster,
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

    // ====== BETTER MATCHING ======
    // Step 1: Filter by year first (most important)
    let yearMatches = [];
    if (targetYear) {
      yearMatches = results.filter(item => item.y === targetYear);
      log("Year matches (" + targetYear + "): " + yearMatches.length);
    }

    // Step 2: If year matches exist, use those
    let candidates = yearMatches.length > 0 ? yearMatches : results;

    // Step 3: Score each candidate
    const targetTitle = title.toLowerCase();
    const targetNormalized = normalizeTitleForSearch(targetTitle);

    let bestMatch = null;
    let bestScore = -999;

    for (const item of candidates) {
      const itemTitle = item.t.toLowerCase();
      const itemNormalized = normalizeTitleForSearch(itemTitle);
      let score = 0;

      // Exact match (highest priority)
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
        score += 20;
      }

      // Penalty for wrong year (if year is known)
      if (targetYear && item.y && item.y !== targetYear) {
        score -= 30;
      }

      // Bonus for titles with "English" or "Hindi" (often better quality)
      if (itemTitle.includes("english") || itemTitle.includes("hindi")) {
        score += 5;
      }

      // Penalty for titles with "666", "Resurrection", etc. (often unrelated)
      if (itemTitle.includes("666") || itemTitle.includes("resurrection")) {
        score -= 40;
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
    const post = await getPost(bestMatch.id);
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