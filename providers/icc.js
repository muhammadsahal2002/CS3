// mobile_icc.js – ICC FTP Server (Final)
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

let sessionCache = null;
let tokenCache = null;

function log(msg) { console.log("[ICCFTP] " + msg); }

// ========== HELPERS ==========
function extractId(url) {
  if (!url) return "";
  var after = url.split("play=");
  if (after.length < 2) return "";
  return after[1].split("&")[0] || "";
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

// ========== SESSION & TOKEN ==========
async function getSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

  log("Getting session...");

  try {
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to connect");
    const html = await resp.text();

    let session = "";
    var sessionMatch = html.match(/session=([a-f0-9]{40,})/);
    if (sessionMatch) {
      session = sessionMatch[1];
    } else {
      var cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
      if (cookieMatch) session = cookieMatch[1];
    }
    if (!session) throw new Error("No session");
    sessionCache = session;

    const dashUrl = BASE_URL + "/dashboard.php?session=" + session + "&category=0";
    const dashResp = await fetch(dashUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": BASE_URL + "/"
      }
    });
    
    if (!dashResp.ok) throw new Error("Failed to get dashboard");
    const dashHtml = await dashResp.text();

    var tokenMatch = dashHtml.match(/name="token"\s+value="([^"]+)"/);
    if (tokenMatch) {
      tokenCache = tokenMatch[1];
    }
    if (!tokenCache) throw new Error("No token");

    return { session: sessionCache, token: tokenCache };

  } catch (err) {
    log("Error: " + err.message);
    throw err;
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

// ========== SEARCH ==========
async function searchICC(query) {
  if (!query || query.trim().length === 0) return [];

  try {
    const { session, token } = await getSessionAndToken();
    const url = BASE_URL + "/dashboard.php?session=" + session;
    const body = "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim());

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": url,
        "X-Requested-With": "com.mycompany.app.soulbrowser"
      },
      body: body
    });

    if (!resp.ok) return [];
    const html = await resp.text();

    const results = [];
    const seenIds = new Set();

    // Remove slider section
    let searchHtml = html;
    const sliderMatch = html.match(/<div[^>]*class="[^"]*slider[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<div[^>]*class="[^"]*news-container[^"]*"[^>]*>/i);
    if (sliderMatch) {
      const sliderEnd = sliderMatch.index + sliderMatch[0].length;
      searchHtml = html.substring(sliderEnd);
    }

    // Parse search results
    const postRegex = /<div[^>]*class="[^"]*post[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*play=([^&"]+)[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*title[^"]*"[^>]*>([^<]*)<\/div>/gi;
    
    let match;
    while ((match = postRegex.exec(searchHtml)) !== null) {
      const id = match[1].trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      
      let title = match[2] ? match[2].trim() : "";
      if (!title) continue;
      
      const year = extractYearFromTitle(title);
      results.push({ id: id, t: title, y: year });
    }

    return results;

  } catch (err) {
    log("Search error: " + err.message);
    return [];
  }
}

// ========== GET VIDEO URL WITH VALIDATION ==========
async function getVideoUrl(id, expectedTitle) {
  try {
    const { session } = await getSessionAndToken();
    
    const url = BASE_URL + "/player.php?session=" + session + "&play=" + id;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Referer": BASE_URL + "/dashboard.php?session=" + session,
        "X-Requested-With": "com.mycompany.app.soulbrowser"
      }
    });

    if (!resp.ok) return null;
    const html = await resp.text();

    // Extract the actual title from the player page
    let actualTitle = "";
    const titleMatch = html.match(/<span[^>]*style="[^"]*font-size: 30px[^"]*"[^>]*>([^<]*)<\/span>/i);
    if (titleMatch) {
      actualTitle = titleMatch[1].trim();
    }
    if (!actualTitle) {
      const pageTitle = html.match(/<title>([^<]*)<\/title>/i);
      if (pageTitle) {
        actualTitle = pageTitle[1].replace("ICC FTP SERVER", "").trim();
      }
    }

    // Extract video URL
    let videoUrl = null;
    const sourceMatch = html.match(/<source[^>]*src=['"]([^'"]+)['"][^>]*>/i);
    if (sourceMatch) {
      videoUrl = sourceMatch[1];
    }
    
    if (!videoUrl) {
      const downloadMatch = html.match(/<a[^>]*href=['"]([^'"]*\.mp4[^'"]*)['"][^>]*download/i);
      if (downloadMatch) {
        videoUrl = downloadMatch[1];
      }
    }

    if (!videoUrl) return null;

    // Validate: Check if the actual title matches the expected title
    if (expectedTitle && actualTitle) {
      const expectedNorm = normalizeTitleForSearch(expectedTitle);
      const actualNorm = normalizeTitleForSearch(actualTitle);
      
      if (expectedNorm !== actualNorm && !actualNorm.includes(expectedNorm) && !expectedNorm.includes(actualNorm)) {
        log("Title mismatch: expected '" + expectedTitle + "', got '" + actualTitle + "'");
        return null;
      }
    }

    return videoUrl;

  } catch (err) {
    log("Get video error: " + err.message);
    return null;
  }
}

// ========== MAIN ==========
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

    // Score and sort results
    const targetNormalized = normalizeTitleForSearch(title);
    let scoredResults = results.map(function(item) {
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

      // Penalize known wrong mappings
      if (item.t.toLowerCase().includes("dc") || 
          item.t.toLowerCase().includes("666") || 
          item.t.toLowerCase().includes("resurrection")) {
        score -= 100;
      }

      return { ...item, score };
    });

    // Sort by score descending
    scoredResults.sort(function(a, b) { return b.score - a.score; });

    // Try each result until we find one with a matching video
    let videoUrl = null;
    let selected = null;

    for (const item of scoredResults) {
      log('Trying: "' + item.t + '" (ID: ' + item.id + ', Score: ' + item.score + ')');
      
      // Skip very low scores
      if (item.score < 0) {
        log('Skipping: score too low');
        continue;
      }
      
      const url = await getVideoUrl(item.id, title);
      if (url) {
        videoUrl = url;
        selected = item;
        log('✅ Valid video found!');
        break;
      }
    }

    // If no valid URL found, try the first result anyway (as fallback)
    if (!videoUrl && scoredResults.length > 0) {
      log("No valid URL found with validation, trying first result as fallback");
      const url = await getVideoUrl(scoredResults[0].id, null);
      if (url) {
        videoUrl = url;
        selected = scoredResults[0];
      }
    }

    if (!videoUrl || !selected) {
      log("No valid video URL found");
      return [];
    }

    log('Selected: "' + selected.t + '" (ID: ' + selected.id + ')');
    log("Video URL: " + videoUrl);

    // Quality
    let quality = "Auto";
    const lower = videoUrl.toLowerCase();
    if (lower.includes("1080p") || lower.includes("1920x1080")) quality = "Full HD";
    else if (lower.includes("720p") || lower.includes("1280x720")) quality = "Mid HD";
    else if (lower.includes("480p") || lower.includes("854x480")) quality = "Low HD";

    return [{
      name: "ICC FTP",
      title: quality,
      url: videoUrl,
      quality: quality,
      headers: {
        "Referer": BASE_URL + "/",
        "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36",
        "Range": "bytes=0-"
      }
    }];

  } catch (err) {
    log("Error: " + err.message);
    return [];
  }
}

module.exports = { getStreams };