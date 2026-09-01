// mobile_icc.js – ICC FTP Server (JavaScript version of Kotlin plugin)
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

let sessionCache = null;
let tokenCache = null;

function log(msg) { console.log("[ICCFTP] " + msg); }

function getTimestamp() { return Math.floor(Date.now() / 1000); }

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

function extractYearFromTitle(title) {
  if (!title) return null;
  var match = title.match(/\((\d{4})\)/);
  if (match) return match[1];
  var match2 = title.match(/\b(19\d{2}|20\d{2})\b/);
  if (match2) return match2[1];
  return null;
}

function normalizeTitleForSearch(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isTitleMatch(title1, title2) {
  if (!title1 || !title2) return false;
  const n1 = normalizeTitleForSearch(title1);
  const n2 = normalizeTitleForSearch(title2);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

// ========== SESSION & TOKEN (exactly like Kotlin) ==========
async function getSession() {
  if (sessionCache && sessionCache.length > 0) {
    return sessionCache;
  }

  try {
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to connect");
    const html = await resp.text();

    // Extract session using regex (same as Kotlin)
    let session = "";
    const sessionMatch = html.match(/session=([a-f0-9]{40,})/);
    if (sessionMatch) {
      session = sessionMatch[1];
    } else {
      const cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
      if (cookieMatch) session = cookieMatch[1];
    }
    
    sessionCache = session || "";
    return sessionCache;

  } catch (err) {
    log("Session error: " + err.message);
    return "";
  }
}

async function getToken(session) {
  if (tokenCache && tokenCache.length > 0) {
    return tokenCache;
  }

  try {
    const url = BASE_URL + "/dashboard.php?session=" + session + "&category=0";
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": BASE_URL + "/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to get dashboard");
    const html = await resp.text();

    // Extract token from hidden input (same as Kotlin)
    const tokenMatch = html.match(/name="token"\s+value="([^"]+)"/);
    tokenCache = tokenMatch ? tokenMatch[1] : "";
    return tokenCache;

  } catch (err) {
    log("Token error: " + err.message);
    return "";
  }
}

// ========== TMDB ==========
async function getTmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("TMDB error");
  const data = await resp.json();
  return {
    title: data.title || data.name,
    year: data.release_date ? data.release_date.substring(0,4) :
          (data.first_air_date ? data.first_air_date.substring(0,4) : "")
  };
}

// ========== SEARCH (exactly like Kotlin) ==========
async function searchICC(query) {
  if (query.isBlank()) return [];

  try {
    const session = await getSession();
    if (!session) return [];

    const token = await getToken(session);
    if (!token) return [];

    const url = BASE_URL + "/dashboard.php?session=" + session;
    const body = "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim());

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Origin": BASE_URL,
        "Referer": url,
        "X-Requested-With": "com.mycompany.app.soulbrowser"
      },
      body: body
    });

    if (!resp.ok) return [];
    const html = await resp.text();

    // Parse using cheerio or regex
    // The Kotlin plugin uses: .post a.image[href*='play=']
    // This selects search results, NOT the slider
    
    const results = [];
    const seenIds = new Set();
    
    // Use regex to find .post a.image with play=ID
    // Pattern: <a class="image" href="...play=ID..."> <img> <div class="title">TITLE</div>
    const postRegex = /<a[^>]*class="[^"]*image[^"]*"[^>]*href="[^"]*play=([^&"]+)[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/gi;
    
    let match;
    while ((match = postRegex.exec(html)) !== null) {
      const id = match[1].trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      
      let title = match[2] ? match[2].trim() : "";
      if (!title) continue;
      
      const year = extractYearFromTitle(title);
      results.push({ id: id, t: title, y: year });
    }

    // If no results, try the Kotlin selector pattern
    if (results.length === 0) {
      const kotlinRegex = /<a[^>]*href="[^"]*play=([^&"]+)[^"]*"[^>]*>[\s\S]*?<img[^>]*src="[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/gi;
      while ((match = kotlinRegex.exec(html)) !== null) {
        const id = match[1].trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        
        let title = match[2] ? match[2].trim() : "";
        if (!title) continue;
        
        const year = extractYearFromTitle(title);
        results.push({ id: id, t: title, y: year });
      }
    }

    return results;

  } catch (err) {
    log("Search error: " + err.message);
    return [];
  }
}

// ========== LOAD (exactly like Kotlin) ==========
async function loadICC(id) {
  try {
    const session = await getSession();
    if (!session) return null;

    // Visit command (like Kotlin)
    try {
      await fetch(BASE_URL + "/command.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
          "Referer": BASE_URL + "/dashboard.php?session=" + session,
          "X-Requested-With": "XMLHttpRequest"
        },
        body: "id=" + id + "&type=visit"
      });
    } catch (_) { /* ignore */ }

    // Player page (like Kotlin)
    const playerUrl = BASE_URL + "/player.php?session=" + session + "&play=" + id;
    const resp = await fetch(playerUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": BASE_URL + "/dashboard.php?session=" + session,
        "X-Requested-With": "com.mycompany.app.soulbrowser"
      }
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    // Extract title (like Kotlin modal-title)
    let title = "";
    const titleMatch = html.match(/<h3[^>]*class="[^"]*modal-title[^"]*"[^>]*>([^<]*)<\/h3>/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    if (!title) {
      const pageTitle = html.match(/<title>([^<]*)<\/title>/i);
      if (pageTitle) {
        title = pageTitle[1].replace("ICC FTP SERVER", "").trim();
      }
    }

    // Extract year (like Kotlin table parsing)
    let year = null;
    const yearMatch = html.match(/<td>Year:<\/td>\s*<td>(\d{4})<\/td>/i);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }

    // Extract category (like Kotlin)
    let category = "";
    const categoryMatch = html.match(/<td>Category:<\/td>\s*<td>([^<]*)<\/td>/i);
    if (categoryMatch) {
      category = categoryMatch[1].trim();
    }

    // Extract poster (like Kotlin)
    let poster = "";
    const posterMatch = html.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    if (posterMatch) {
      poster = fixImage(posterMatch[1]);
    }

    // Extract video URLs (like Kotlin)
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
      }
    }

    // Also check video tags (like Kotlin)
    if (videoUrls.length === 0) {
      const tagRegex = /<video[^>]*src="([^"]*)"[^>]*>/gi;
      while ((match = tagRegex.exec(html)) !== null) {
        let url = match[1];
        if (!url.startsWith("http")) {
          url = BASE_URL + "/" + url;
        }
        if (videoUrls.indexOf(url) === -1) {
          videoUrls.push(url);
        }
      }
    }

    // Determine if series (like Kotlin)
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
    return null;
  }
}

// ========== MAIN getStreams ==========
async function getStreams(tmdbId, mediaType, season, episode) {
  log("========================================");
  log("Searching: " + tmdbId);
  log("========================================");

  try {
    const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
    const title = tmdbInfo.title;
    const targetYear = tmdbInfo.year;
    log('TMDB: "' + title + '" (' + targetYear + ')');

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

    log("Found " + results.length + " results");

    // Find best match
    let best = results[0];
    let bestScore = -999;
    const targetNormalized = normalizeTitleForSearch(title);

    for (const item of results) {
      const itemNormalized = normalizeTitleForSearch(item.t);
      let score = 0;

      if (itemNormalized === targetNormalized) score = 100;
      else if (itemNormalized.includes(targetNormalized)) score = 80;
      else if (targetNormalized.includes(itemNormalized)) score = 60;
      else {
        const words = targetNormalized.split(" ");
        let matched = 0;
        for (const w of words) {
          if (w.length > 2 && itemNormalized.includes(w)) matched++;
        }
        score = (matched / words.length) * 50;
      }

      if (item.y === targetYear) score += 30;
      if (targetYear && item.y && item.y !== targetYear) score -= 40;

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    log('Selected: "' + best.t + '" (ID: ' + best.id + ')');

    // Load the content
    const data = await loadICC(best.id);
    if (!data || !data.videoUrls || data.videoUrls.length === 0) {
      log("No video URLs found");
      return [];
    }

    log('Loaded: "' + data.title + '"');
    log('Video URLs: ' + data.videoUrls.length);

    // Build streams (like Kotlin loadLinks)
    const streams = data.videoUrls.map(function(url) {
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
    log("Error: " + err.message);
    return [];
  }
}

module.exports = { getStreams };