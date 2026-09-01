// mobile_icc.js – ICC FTP Server
// Working version – extracts video URLs correctly
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
    log("Session: " + session.substring(0, 20) + "...");

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
      log("Token: " + tokenCache);
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

// ========== GET VIDEO URL ==========
async function getVideoUrl(id) {
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

    // Extract video URL from <source> tag
    const sourceMatch = html.match(/<source[^>]*src=['"]([^'"]+)['"][^>]*>/i);
    if (sourceMatch) {
      return sourceMatch[1];
    }
    
    // Fallback: download link
    const downloadMatch = html.match(/<a[^>]*href=['"]([^'"]*\.mp4[^'"]*)['"][^>]*download/i);
    if (downloadMatch) {
      return downloadMatch[1];
    }

    return null;

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

    // Get video URL
    const videoUrl = await getVideoUrl(best.id);
    if (!videoUrl) {
      log("No video URL found");
      return [];
    }

    log("Video URL: " + videoUrl);

    // Quality
    let quality = "Auto";
    const lower = videoUrl.toLowerCase();
    if (lower.includes("1080p")) quality = "Full HD";
    else if (lower.includes("720p")) quality = "Mid HD";
    else if (lower.includes("480p")) quality = "Low HD";

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