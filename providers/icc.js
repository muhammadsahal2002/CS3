// mobile_icc.js – ICC FTP Server (with ID validation)
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

let sessionCache = null;
let tokenCache = null;

function log(msg) { console.log("[ICCFTP] " + msg); }

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

function isTitleMatch(title1, title2) {
  if (!title1 || !title2) return false;
  const n1 = normalizeTitleForSearch(title1);
  const n2 = normalizeTitleForSearch(title2);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

async function getSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

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

// ========== GET PLAYER TITLE AND VIDEO URL ==========
async function getPlayerInfo(id) {
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

    // Extract actual title from player page
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

    return { title: actualTitle, videoUrl: videoUrl };

  } catch (err) {
    log("Get player info error: " + err.message);
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

    // Score and sort
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

    scoredResults.sort(function(a, b) { return b.score - a.score; });

    let videoUrl = null;
    let selected = null;

    // Try each result and check if the player page title matches
    for (const item of scoredResults) {
      if (item.score < 0) {
        log('Skipping "' + item.t + '" (score too low: ' + item.score + ')');
        continue;
      }
      
      log('Checking ID ' + item.id + ' ("' + item.t + '", score: ' + item.score + ')');
      
      const playerInfo = await getPlayerInfo(item.id);
      if (!playerInfo) {
        log('  ❌ Failed to load player page');
        continue;
      }

      log('  Player title: "' + playerInfo.title + '"');
      
      // Check if the player title matches the expected title
      if (isTitleMatch(playerInfo.title, title)) {
        log('  ✅ Title matches!');
        videoUrl = playerInfo.videoUrl;
        selected = item;
        break;
      } else {
        log('  ❌ Title mismatch: expected "' + title + '", got "' + playerInfo.title + '"');
      }
    }

    // If no match found, try the first result anyway (as fallback)
    if (!videoUrl && scoredResults.length > 0) {
      log("No valid title match, trying first result as fallback");
      const playerInfo = await getPlayerInfo(scoredResults[0].id);
      if (playerInfo) {
        videoUrl = playerInfo.videoUrl;
        selected = scoredResults[0];
        log('Fallback using: "' + playerInfo.title + '"');
      }
    }

    if (!videoUrl || !selected) {
      log("No valid video URL found");
      return [];
    }

    log('Selected: "' + selected.t + '" (ID: ' + selected.id + ')');
    log("Video URL: " + videoUrl);

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