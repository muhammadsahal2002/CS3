// mobile_icc.js – ICC FTP Server (net52.cc/mobile)
// Follows the same pattern as mobile_nf.js
"use strict";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const TMDB_BASE = "https://api.themoviedb.org/3";
const BASE_URL = "http://10.16.100.244";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.85 Mobile Safari/537.36 /OS.Gatu v3.1",
  "Accept": "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Referer": "http://10.16.100.244/",
  "Connection": "keep-alive",
  "X-Requested-With": "com.mycompany.app.soulbrowser"
};

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

// ---------- Session & Token (like fetchToken in Netflix) ----------
async function fetchSessionAndToken() {
  if (sessionCache && tokenCache) {
    return { session: sessionCache, token: tokenCache };
  }

  log("Getting session and token...");

  // Step 1: Get session from homepage
  const resp = await fetch(BASE_URL, {
    headers: {
      "User-Agent": DEFAULT_HEADERS["User-Agent"],
      "Referer": "http://10.16.100.202/"
    }
  });
  if (!resp.ok) throw new Error(`Failed to connect: HTTP ${resp.status}`);
  const html = await resp.text();

  // Extract session
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
  log(`Session: ${session.substring(0, 20)}...`);

  // Step 2: Get token from dashboard
  const dashboardUrl = `${BASE_URL}/dashboard.php?session=${session}&category=0`;
  const dashResp = await fetch(dashboardUrl, { headers: DEFAULT_HEADERS });
  if (!dashResp.ok) throw new Error(`Failed to get dashboard: HTTP ${dashResp.status}`);
  const dashHtml = await dashResp.text();

  let token = "";
  const tokenMatch = dashHtml.match(/name="token"\s+value="([^"]+)"/);
  if (tokenMatch) {
    token = tokenMatch[1];
  }
  if (!token) throw new Error("Could not extract token");
  tokenCache = token;
  log(`Token: ${token}`);

  return { session, token };
}

function buildHeaders(extra = {}, requestedWith = "XMLHttpRequest") {
  const h = { ...DEFAULT_HEADERS };
  if (requestedWith) h["X-Requested-With"] = requestedWith;
  if (extra) Object.assign(h, extra);
  return h;
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);
  return resp.json();
}

async function getTmdbInfo(tmdbId, mediaType) {
  const endpoint = mediaType === "movie" ? "movie" : "tv";
  const url = `${TMDB_BASE}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url);
  const title = data.title || data.name;
  const year = data.release_date ? data.release_date.substring(0,4) :
               (data.first_air_date ? data.first_air_date.substring(0,4) : "");
  return { title, year };
}

// ---------- ICC FTP Search (like search in Netflix) ----------
async function searchICC(query) {
  if (!query || query.trim().length === 0) return [];

  const { session, token } = await fetchSessionAndToken();
  const url = `${BASE_URL}/dashboard.php?session=${session}`;
  const body = `token=${encodeURIComponent(token)}&psearch=${encodeURIComponent(query.trim())}`;

  log(`Searching: "${query}"`);
  const resp = await fetch(url, {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/x-www-form-urlencoded"
    }, "XMLHttpRequest"),
    body: body
  });

  if (!resp.ok) {
    log(`Search failed: HTTP ${resp.status}`);
    return [];
  }

  const html = await resp.text();
  
  // Parse HTML for results
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

    results.push({
      id: id,
      t: title,
      y: null, // ICC FTP doesn't always have year
      image: fixImage(image)
    });
  });

  log(`Found ${results.length} results for "${query}"`);
  return results;
}

async function searchWithFallback(originalTitle, year) {
  let results = await searchICC(originalTitle);
  
  if (results.length > 0) {
    log(`Found ${results.length} results with title: "${originalTitle}"`);
    return results;
  }

  const normalized = normalizeTitleForSearch(originalTitle);
  log(`No results, trying normalized: "${normalized}"`);
  results = await searchICC(normalized);
  if (results.length === 0) return [];

  return results;
}

// ---------- ICC FTP Post (like getPost in Netflix) ----------
async function getPost(id) {
  const { session } = await fetchSessionAndToken();
  const url = `${BASE_URL}/player.php?session=${session}&play=${id}`;
  
  log(`Loading ID: ${id}`);
  const resp = await fetch(url, { headers: buildHeaders() });
  if (!resp.ok) throw new Error(`Failed to load player: HTTP ${resp.status}`);
  
  const html = await resp.text();
  const cheerio = require("cheerio-without-node-native");
  const $ = cheerio.load(html);
  const modal = $(".modal-dialog");

  const title = modal.find(".modal-title").text().trim() || 
                $("title").text().replace("ICC FTP SERVER", "").trim();
  
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

  // Find video links
  modal.find("a[href]").each(function() {
    const href = $(this).attr("href") || "";
    if (href.includes(".mp4") || href.includes(".mkv") || href.includes(".avi")) {
      videoUrls.push(href.startsWith("http") ? href : BASE_URL + "/" + href);
    }
  });

  if (videoUrls.length === 0) {
    $("video source, video").each(function() {
      const src = $(this).attr("src") || $(this).attr("data-src") || "";
      if (src) {
        videoUrls.push(src.startsWith("http") ? src : BASE_URL + "/" + src);
      }
    });
  }

  const isSeries = title.toLowerCase().includes("season") ||
    title.toLowerCase().includes("episode") ||
    category.toLowerCase().includes("serials");

  return {
    id: id,
    title: title,
    year: year,
    genre: genre,
    description: description,
    category: category,
    type: isSeries ? "t" : "m",
    videoUrls: videoUrls,
    main_id: null
  };
}

// ---------- ICC FTP Playlist (like getPlaylist in Netflix) ----------
async function getPlaylist(videoUrls, title) {
  if (!videoUrls || !videoUrls.length) {
    throw new Error("No video URLs found");
  }

  // ICC FTP doesn't have playlist.php, we return direct video URLs
  const sources = videoUrls.map(url => {
    let quality = "Unknown";
    const lower = url.toLowerCase();
    if (lower.includes("1080p")) quality = "Full HD";
    else if (lower.includes("720p")) quality = "Mid HD";
    else if (lower.includes("480p")) quality = "Low HD";

    return {
      file: url,
      label: quality,
      type: "video/mp4"
    };
  });

  return {
    sources: sources,
    tracks: [] // ICC FTP doesn't have subtitles
  };
}

// ---------- Main getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  const isMovieType = (mediaType === "movie");
  log(`TMDB: "${title}" (${year}) [${isMovieType ? 'Movie' : 'Series'}]`);

  // Search ICC FTP
  const results = await searchWithFallback(title, year);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log(`Found ${results.length} results`);
  
  // Try to find best match
  let selected = results[0];
  const targetTitle = title.toLowerCase();
  for (const item of results) {
    const itemTitle = item.t.toLowerCase();
    if (itemTitle === targetTitle) {
      selected = item;
      break;
    }
    if (itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle)) {
      selected = item;
    }
  }
  log(`Selected: "${selected.t}" (ID: ${selected.id})`);

  // Get post details
  const post = await getPost(selected.id);
  log(`Type: ${post.type}, title: ${post.title}`);

  let contentId;
  let videoUrls;

  // Handle movie vs series
  if (post.type === "m" || isMovieType) {
    // Movie
    videoUrls = post.videoUrls;
    log(`Movie, found ${videoUrls.length} video(s)`);
  } else {
    // Series - ICC FTP may not have structured episodes
    // For now, just use the video URLs from the post
    videoUrls = post.videoUrls;
    log(`Series mode, found ${videoUrls.length} video(s)`);
  }

  if (!videoUrls || !videoUrls.length) {
    throw new Error("No video sources found");
  }

  // Get playlist (convert to Netflix-like format)
  const playlist = await getPlaylist(videoUrls, post.title || title);
  if (!playlist.sources || !playlist.sources.length) {
    throw new Error("No sources in playlist");
  }

  const qualities = playlist.sources.map(s => s.label || 'unknown');
  log(`Available qualities: ${qualities.join(', ')}`);

  // Build stream objects
  return playlist.sources.map(src => {
    return {
      name: "ICC FTP",
      title: src.label || "Auto",
      url: src.file,
      quality: src.label || "Auto",
      headers: {
        Referer: BASE_URL + "/",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Range": "bytes=0-"
      }
    };
  });
}

module.exports = { getStreams };