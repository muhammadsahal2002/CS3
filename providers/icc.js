// mobile_icc.js – ICC FTP Server
// Follows the same pattern as mobile_nf.js
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

// ========== SESSION & TOKEN (like fetchToken in Netflix) ==========
async function fetchSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

  log("Getting session and token...");

  try {
    // Step 1: Get session from homepage (like Kotlin getSession)
    const resp = await fetch(BASE_URL, {
      headers: {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Referer": "http://10.16.100.202/"
      }
    });
    
    if (!resp.ok) throw new Error("Failed to connect: HTTP " + resp.status);
    
    const html = await resp.text();
    log("Homepage length: " + html.length);

    // Extract session (same as Kotlin regex)
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

    if (!session) throw new Error("Could not extract session");
    sessionCache = session;

    // Step 2: Get token from dashboard (like Kotlin getToken)
    const dashboardUrl = BASE_URL + "/dashboard.php?session=" + session + "&category=0";
    log("Fetching dashboard...");
    
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
      log("Token found: " + token);
    }

    if (!token) throw new Error("Could not extract token");
    tokenCache = token;

    log("Session and token ready");
    return { session, token };

  } catch (err) {
    log("Error: " + err.message);
    throw err;
  }
}

// ========== TMDB HELPERS (like Netflix) ==========
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

// ========== ICC FTP SEARCH (like search in Netflix) ==========
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

    // Parse results (same as Kotlin selectors)
    const results = [];
    const cheerio = require("cheerio-without-node-native");
    const $ = cheerio.load(html);

    $(".post a.image[href*='play='], .post-wrapper > a[href*='play=']").each(function() {
      const a = $(this);
      const href = a.attr("href") || "";
      const id = extractId(href);
      if (!id) return;

      const post = a.closest(".post");
      let title = post ? post.find(".title").text().trim() : "";
      if (!title) title = a.find("img").attr("alt") || "";
      if (!title) return;

      const image = a.find("img").attr("src") || "";

      // Try to extract year from title
      let year = null;
      const yearMatch = title.match(/\((\d{4})\)/);
      if (yearMatch) year = yearMatch[1];

      results.push({
        id: id,
        t: title,
        y: year,
        image: fixImage(image)
      });
    });

    log("Found " + results.length + " results for: " + query);
    return results;

  } catch (err) {
    log("Search error: " + err.message);
    return [];
  }
}

async function searchWithFallback(originalTitle, year) {
  // Try exact title first
  let results = await searchICC(originalTitle);
  if (results.length > 0) {
    log("Found " + results.length + " results with title: " + originalTitle);
    // Filter by year if available
    if (year) {
      const filtered = results.filter(item => item.y === year);
      if (filtered.length > 0) {
        log("Filtered to " + filtered.length + " results with year " + year);
        return filtered;
      }
    }
    return results;
  }

  // Try normalized title
  const normalized = normalizeTitleForSearch(originalTitle);
  log("No results, trying normalized: " + normalized);
  results = await searchICC(normalized);
  if (results.length === 0) return [];

  if (year) {
    const filtered = results.filter(item => item.y === year);
    if (filtered.length > 0) {
      log("Filtered to " + filtered.length + " results with year " + year);
      return filtered;
    }
  }
  return results;
}

// ========== ICC FTP LOAD (like getPost in Netflix) ==========
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

    const cheerio = require("cheerio-without-node-native");
    const $ = cheerio.load(html);
    const modal = $(".modal-dialog");

    // Extract title (like Kotlin)
    let title = modal.find(".modal-title").text().trim();
    if (!title) {
      title = $("title").text().replace("ICC FTP SERVER", "").trim();
    }

    // Extract metadata (like Kotlin table parsing)
    let year = null;
    let genre = "";
    let description = "";
    let category = "";
    const videoUrls = [];

    modal.find("table.ewTable tr").each(function() {
      const cells = $(this).find("td");
      if (cells.length >= 2) {
        const label = $(cells[0]).text().trim().replace(":", "");
        const value = $(cells[1]).text().trim();
        switch (label) {
          case "Generic Name": genre = value; break;
          case "Category": category = value; break;
          case "Year": year = parseInt(value) || null; break;
          case "Discription":
          case "Description": description = value; break;
        }
      }
    });

    // Extract poster
    let poster = "";
    const img = modal.find("img");
    if (img.length) poster = fixImage(img.attr("src"));

    // Extract video URLs (like Kotlin)
    modal.find("a[href]").each(function() {
      const href = $(this).attr("href") || "";
      if (href.includes(".mp4") || href.includes(".mkv") || href.includes(".avi")) {
        const full = href.startsWith("http") ? href : BASE_URL + "/" + href;
        videoUrls.push(full);
        log("Found video: " + full);
      }
    });

    // Also check video tags
    if (videoUrls.length === 0) {
      $("video source, video").each(function() {
        const src = $(this).attr("src") || $(this).attr("data-src") || "";
        if (src) {
          const full = src.startsWith("http") ? src : BASE_URL + "/" + src;
          videoUrls.push(full);
          log("Found video (tag): " + full);
        }
      });
    }

    // Determine if series (like Kotlin)
    const isSeries = title.toLowerCase().includes("season") ||
      title.toLowerCase().includes("episode") ||
      category.toLowerCase().includes("serials");

    return {
      id: id,
      title: title,
      year: year,
      poster: poster,
      description: description,
      genre: genre,
      category: category,
      type: isSeries ? "t" : "m",
      videoUrls: videoUrls,
      main_id: null
    };

  } catch (err) {
    log("Load error: " + err.message);
    throw err;
  }
}

// ========== MAIN getStreams (like Netflix) ==========
async function getStreams(tmdbId, mediaType, season, episode) {
  log("========================================");
  log("Searching for TMDB ID: " + tmdbId);
  log("Type: " + mediaType);
  log("========================================");

  try {
    // Step 1: Get title from TMDB (like Netflix)
    const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
    const title = tmdbInfo.title;
    const year = tmdbInfo.year;
    const isMovieType = (mediaType === "movie");
    log('TMDB: "' + title + '" (' + year + ') [' + (isMovieType ? 'Movie' : 'Series') + ']');

    // Step 2: Search ICC FTP with the title (like Netflix searchWithFallback)
    const results = await searchWithFallback(title, year);
    if (!results || results.length === 0) {
      log("No results found for: " + title);
      return [];
    }

    log("Found " + results.length + " results");

    // Step 3: Select best match (like Netflix pickBestResult)
    let selected = results[0];
    let bestScore = -1;
    const targetTitle = title.toLowerCase();

    for (const item of results) {
      const itemTitle = item.t.toLowerCase();
      let score = 0;
      
      // Exact match
      if (itemTitle === targetTitle) score = 100;
      // Contains title
      else if (itemTitle.includes(targetTitle)) score = 70;
      // Title contains item
      else if (targetTitle.includes(itemTitle)) score = 50;
      // Year match
      if (item.y === year && year) score += 10;

      if (score > bestScore) {
        bestScore = score;
        selected = item;
      }
    }

    log('Selected: "' + selected.t + '" (ID: ' + selected.id + ')');

    // Step 4: Load the content (like Netflix getPost)
    const post = await getPost(selected.id);
    log('Type: ' + post.type + ', title: ' + post.title);
    log('Video URLs: ' + post.videoUrls.length);

    if (!post.videoUrls || post.videoUrls.length === 0) {
      log("No video URLs found");
      return [];
    }

    // Step 5: Build streams (like Netflix playlist.sources.map)
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