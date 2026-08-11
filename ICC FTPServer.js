/**
 * netmirror - Fixed Nuvio Provider
 * Based on actual APK network traffic
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ============== CONSTANTS ==============
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";

var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php",
    hls: "/mobile/hls/",
    img: "poster/v",
    epImg: "epimg/150"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php",
    hls: "/mobile/pv/hls/",
    img: "pv/v",
    epImg: "pvepimg"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    hls: "/mobile/hs/hls/",
    img: "hs/v",
    epImg: "hsepimg"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php",
    hls: "/mobile/hs/hls/",
    img: "hs/v",
    epImg: "hsepimg"
  }
};

var NEW_TV_BASE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Requested-With": "NetmirrorNewTV v1.0",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
  "Accept": "application/json, text/plain, */*"
};

var NEW_TV_DOMAINS = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
];

// ============== UTILITY ==============
var resolvedApiUrl = "https://net52.cc";
var cookieValue = "";
var cookieTimestamp = 0;

function safeAtob(encoded) {
  if (typeof atob === "function") {
    return atob(encoded);
  }
  return Buffer.from(encoded, "base64").toString("binary");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== CHECK.PHP ==============
function checkPhp() {
  return __async(this, null, function* () {
    try {
      console.log("[NetMirror] Checking API...");
      const response = yield fetch("https://mobiledetects.com/check.php", {
        method: "GET",
        headers: {
          "accept": "application/json, text/plain, */*",
          "cache-control": "no-cache",
          "pragma": "no-cache",
          "expires": "0",
          "Host": "mobiledetects.com",
          "Connection": "Keep-Alive",
          "Accept-Encoding": "gzip",
          "User-Agent": "okhttp/4.9.2"
        }
      });
      const data = yield response.json();
      console.log("[NetMirror] check.php response received");
      return data;
    } catch (error) {
      console.error("[NetMirror] check.php failed:", error.message);
      return null;
    }
  });
}

// ============== BYPASS ==============
function bypass(ott) {
  return __async(this, null, function* () {
    if (cookieValue && Date.now() - cookieTimestamp < 54e6) {
      return cookieValue;
    }
    
    try {
      console.log("[NetMirror] Running bypass...");
      
      yield checkPhp();
      
      const newUrl = "https://net52.cc";
      const userAgent = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";
      
      const homeResponse = yield fetch(`${newUrl}/mobile/home?app=1`, {
        headers: {
          "User-Agent": userAgent,
          "X-Requested-With": "app.netmirror.netmirrornew"
        }
      });
      
      const homeHtml = yield homeResponse.text();
      const match = homeHtml.match(/<body[^>]*data-addhash=["']([^"']+)["']/i);
      
      if (!match) {
        console.error("[NetMirror] Failed to extract data-addhash");
        return "";
      }
      
      const addhash = match[1];
      console.log("[NetMirror] Addhash:", addhash);
      
      const triggerUrl = `https://userver.net52.cc/?jjoii=${encodeURIComponent(addhash)}&a=y&t=${Math.floor(Date.now() / 1000)}`;
      yield fetch(triggerUrl, {
        headers: { "User-Agent": userAgent }
      });
      
      const verifyUrl = `${newUrl}/mobile/verify2.php`;
      
      for (let attempt = 1; attempt <= 7; attempt++) {
        yield sleep(10000);
        console.log(`[NetMirror] Polling verify2.php (attempt ${attempt}/7)...`);
        
        const verifyResponse = yield fetch(verifyUrl, {
          method: "POST",
          headers: {
            "User-Agent": userAgent,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: `verify=${encodeURIComponent(addhash)}`
        });
        
        const verifyText = yield verifyResponse.text();
        console.log("[NetMirror] Poll response:", verifyText.substring(0, 100));
        
        if (verifyText.includes('"statusup":"All Done"')) {
          let newCookie = "";
          const headers = verifyResponse.headers;
          
          if (headers) {
            let setCookie = headers.get("set-cookie") || headers.get("Set-Cookie") || headers.get("SET-COOKIE");
            if (setCookie) {
              const match2 = setCookie.match(/t_hash_t=([^;]+)/);
              if (match2) newCookie = match2[1];
            }
          }
          
          if (newCookie) {
            cookieValue = newCookie;
            cookieTimestamp = Date.now();
            console.log("[NetMirror] Cookie obtained:", cookieValue);
            return cookieValue;
          }
        }
      }
      
      console.error("[NetMirror] Verification timed out");
    } catch (e) {
      cookieValue = "";
      console.error("[NetMirror] Bypass failed:", e.message);
    }
    
    return "";
  });
}

function buildNewTvHeaders(ott, extra = {}) {
  return __spreadValues(__spreadProps(__spreadValues({}, NEW_TV_BASE_HEADERS), {
    "Ott": ott
  }), extra);
}

// ============== MOBILE HEADERS ==============
function buildMobileHeaders(ott, cookie, extra = {}) {
  const cookieStr = cookie ? `t_hash_t=${cookie}; ott=${ott}; hd=on` : "";
  
  const headers = {
    "Host": "net52.cc",
    "Connection": "keep-alive",
    "sec-ch-ua-platform": "Android",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1",
    "Accept": "*/*",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Android WebView\";v=\"150\"",
    "sec-ch-ua-mobile": "?1",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Referer": "https://net52.cc/mobile/home?app=1",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8"
  };
  
  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }
  
  return __spreadValues(headers, extra);
}

function buildPlaylistHeaders(ott, cookie, extra = {}) {
  const cookieStr = cookie ? `t_hash_t=${cookie}; ott=${ott}; hd=on` : "";
  
  const headers = {
    "Host": "net52.cc",
    "Connection": "keep-alive",
    "sec-ch-ua-platform": "Android",
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Android WebView\";v=\"150\"",
    "sec-ch-ua-mobile": "?1",
    "Accept": "*/*",
    "X-Requested-With": "app.netmirror.nmv2",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "Referer": "https://net52.cc/mobile/home?app=1",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8"
  };
  
  if (cookieStr) {
    headers["Cookie"] = cookieStr;
  }
  
  return __spreadValues(headers, extra);
}

// ============== GET STREAMS ==============
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      console.log("[NetMirror] getStreams:", tmdbId, mediaType, season, episode);
      
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      
      const tmdbType = mediaType === "tv" ? "tv" : "movie";
      const tmdbResp = yield fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json"
        }
      });
      
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      
      if (!title) {
        console.error("[NetMirror] Could not fetch title");
        return [];
      }
      
      console.log("[NetMirror] TMDB Title:", title);
      
      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }
      
      for (const platformKey of platforms) {
        try {
          const streams = yield fetchFromPlatform(platformKey, title, mediaType, season, episode);
          if (streams && streams.length > 0) {
            console.log("[NetMirror] Found streams from:", platformKey);
            return streams;
          }
        } catch (e) {
          console.log("[NetMirror] Platform failed:", platformKey, e.message);
        }
      }
      
      return [];
    } catch (error) {
      console.error("[NetMirror] getStreams error:", error.message);
      return [];
    }
  });
}

// ============== FETCH FROM PLATFORM ==============
function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    if (!platform) return null;
    
    const cookie = yield bypass(platform.ott);
    
    // Search
    const searchUrl = `${resolvedApiUrl}${platform.search}?s=${encodeURIComponent(title)}&t=${Math.floor(Date.now() / 1000)}&ADSearch=false`;
    console.log("[NetMirror] Search:", searchUrl);
    
    const searchResp = yield fetch(searchUrl, {
      headers: buildMobileHeaders(platform.ott, cookie)
    });
    
    const searchData = yield searchResp.json();
    
    if (!searchData.searchResult || searchData.searchResult.length === 0) {
      return null;
    }
    
    const result = searchData.searchResult[0];
    const contentId = result.id;
    
    // Get details
    const postUrl = `${resolvedApiUrl}${platform.post}?id=${contentId}&t=${Math.floor(Date.now() / 1000)}`;
    console.log("[NetMirror] Details:", postUrl);
    
    const postResp = yield fetch(postUrl, {
      headers: buildMobileHeaders(platform.ott, cookie)
    });
    
    const postData = yield postResp.json();
    
    let targetId = contentId;
    
    if (mediaType === "tv") {
      // Find the specific episode
      let foundEpisode = null;
      
      if (postData.episodes) {
        const episodes = postData.episodes.filter(e => e !== null);
        foundEpisode = episodes.find(ep => {
          const epNum = parseInt(ep.ep.replace("E", ""));
          const sNum = parseInt(ep.s.replace("S", ""));
          return sNum === season && epNum === episode;
        });
      }
      
      if (foundEpisode) {
        targetId = foundEpisode.id;
        console.log("[NetMirror] Found episode:", foundEpisode.t);
      } else {
        console.log("[NetMirror] Episode not found:", season, episode);
        return null;
      }
    }
    
    // Get playlist
    const playlistUrl = `${resolvedApiUrl}${platform.playlist}?id=${targetId}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now() / 1000)}`;
    console.log("[NetMirror] Playlist:", playlistUrl);
    
    const playlistResp = yield fetch(playlistUrl, {
      headers: buildPlaylistHeaders(platform.ott, cookie)
    });
    
    const playlistData = yield playlistResp.json();
    
    if (!playlistData || playlistData.length === 0) {
      return null;
    }
    
    const item = playlistData[0];
    if (!item.sources || item.sources.length === 0) {
      return null;
    }
    
    const streams = [];
    for (const source of item.sources) {
      let streamUrl = source.file;
      if (!streamUrl.startsWith("http")) {
        streamUrl = `${resolvedApiUrl}${streamUrl}`;
      }
      
      const qualityMatch = source.file.match(/[?&]q=([^&]+)/);
      const quality = qualityMatch ? qualityMatch[1] : (source.label === "Auto" ? "Auto" : source.label);
      
      streams.push({
        name: `NetMirror (${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)})`,
        title: `${title} - ${source.label || quality}`,
        url: streamUrl,
        quality: quality,
        type: "m3u8",
        headers: buildPlaylistHeaders(platform.ott, cookie)
      });
    }
    
    return streams;
  });
}

// ============== LOAD LINKS (for Nuvio) ==============
function loadLinks(data, isCasting, subtitleCallback, callback) {
  return __async(this, null, function* () {
    try {
      console.log("[NetMirror] loadLinks:", data);
      
      let linkData = data;
      if (typeof data === 'string') {
        try {
          linkData = JSON.parse(data);
        } catch (e) {
          linkData = { id: data };
        }
      }
      
      const contentId = linkData.id || linkData;
      const title = linkData.title || "Unknown";
      const platformKey = linkData.platform || "netflix";
      
      console.log("[NetMirror] Content ID:", contentId, "Platform:", platformKey);
      
      const platform = PLATFORM_MAP[platformKey];
      if (!platform) return false;
      
      const cookie = yield bypass(platform.ott);
      
      const playlistUrl = `${resolvedApiUrl}${platform.playlist}?id=${contentId}&t=${encodeURIComponent(title)}&tm=${Math.floor(Date.now() / 1000)}`;
      console.log("[NetMirror] Playlist:", playlistUrl);
      
      const playlistResp = yield fetch(playlistUrl, {
        headers: buildPlaylistHeaders(platform.ott, cookie)
      });
      
      const playlistData = yield playlistResp.json();
      
      if (!playlistData || playlistData.length === 0) return false;
      
      const item = playlistData[0];
      if (!item.sources || item.sources.length === 0) return false;
      
      for (const source of item.sources) {
        let streamUrl = source.file;
        if (!streamUrl.startsWith("http")) {
          streamUrl = `${resolvedApiUrl}${streamUrl}`;
        }
        
        const qualityMatch = source.file.match(/[?&]q=([^&]+)/);
        const quality = qualityMatch ? qualityMatch[1] : (source.label === "Auto" ? "Auto" : source.label);
        
        callback({
          name: `NetMirror (${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)})`,
          title: `${title} - ${source.label || quality}`,
          url: streamUrl,
          quality: quality,
          type: "m3u8",
          isM3U8: true,
          headers: buildPlaylistHeaders(platform.ott, cookie)
        });
      }
      
      // Add subtitles if available
      if (item.tracks) {
        for (const track of item.tracks) {
          if (track.kind === "captions" && track.file) {
            let subUrl = track.file;
            if (subUrl.startsWith("//")) {
              subUrl = "https:" + subUrl;
            } else if (!subUrl.startsWith("http")) {
              subUrl = `${resolvedApiUrl}${subUrl}`;
            }
            
            subtitleCallback({
              url: subUrl,
              label: track.label || "Subtitle",
              language: track.label || "en"
            });
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error("[NetMirror] loadLinks error:", error.message);
      return false;
    }
  });
}

// ============== ON SETTINGS ==============
function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Source Selection" },
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred Streaming Source",
        description: "Select which platform to try first.",
        options: [
          { label: "All Sources (Ordered)", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      },
      { type: "header", label: "Advanced" },
      {
        type: "toggle",
        key: "forceHd",
        label: "Force HD Quality",
        description: "Attempts to force HD quality when available.",
        defaultValue: true
      }
    ];
  });
}

// ============== EXPORTS ==============
module.exports = { 
  getStreams, 
  loadLinks, 
  onSettings 
};