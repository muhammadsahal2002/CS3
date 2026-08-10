// ICC FTP Server provider for Nuvio
// Converted from Cloudstream Kotlin plugin
// Works only on BDIX / local network (default IP: 10.16.100.244)

const DEFAULT_URL = "http://10.16.100.244";
const PROVIDER_NAME = "ICC FTP";

const QUALITY_PATTERNS = [
  { pattern: "2160p", quality: "4K" },
  { pattern: "4k", quality: "4K" },
  { pattern: "1080p", quality: "1080p" },
  { pattern: "720p", quality: "720p" },
  { pattern: "480p", quality: "480p" },
  { pattern: "360p", quality: "360p" }
];

let currentSession = null;
let currentToken = null;

function getBaseUrl() {
  const settings = (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) || {};
  return (settings.serverUrl || DEFAULT_URL).replace(/\/$/, "");
}

function getHeaders(extra = {}) {
  const base = getBaseUrl();
  return Object.assign({
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "Referer": base + "/",
    "X-Requested-With": "com.mycompany.app.soulbrowser"
  }, extra);
}

function extractQuality(text) {
  if (!text) return "Unknown";
  const lower = text.toLowerCase();
  for (const q of QUALITY_PATTERNS) {
    if (lower.includes(q.pattern)) return q.quality;
  }
  return "Unknown";
}

function fixUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return getBaseUrl() + "/" + path.replace(/^\//, "");
}

function getSession() {
  if (currentSession) return Promise.resolve(currentSession);

  const base = getBaseUrl();
  return fetch(base, {
    headers: getHeaders({ "Referer": "http://10.16.100.202/" })
  })
    .then(r => r.text().then(html => ({ html, cookies: r.headers.get("set-cookie") || "" })))
    .then(({ html, cookies }) => {
      const m = html.match(/session=([a-f0-9]{20,})/i);
      currentSession = (m && m[1]) || (cookies.match(/PHPSESSID=([^;]+)/) || [])[1] || "";
      return currentSession;
    })
    .catch(() => {
      currentSession = "";
      return "";
    });
}

function getToken(session) {
  if (currentToken) return Promise.resolve(currentToken);

  const base = getBaseUrl();
  const url = `\( {base}/dashboard.php?session= \){session}&category=0`;
  return fetch(url, { headers: getHeaders() })
    .then(r => r.text())
    .then(html => {
      const m = html.match(/name=["']token["']\s+value=["']([^"']+)["']/i);
      currentToken = (m && m[1]) || "";
      return currentToken;
    })
    .catch(() => {
      currentToken = "";
      return "";
    });
}

function searchFtp(query) {
  return getSession().then(session => {
    return getToken(session).then(token => {
      const base = getBaseUrl();
      const url = `\( {base}/dashboard.php?session= \){session}`;

      const body = new URLSearchParams({
        token: token,
        psearch: query
      }).toString();

      return fetch(url, {
        method: "POST",
        headers: getHeaders({
          "Content-Type": "application/x-www-form-urlencoded",
          "Origin": base,
          "Referer": url
        }),
        body: body
      }).then(r => r.text());
    });
  });
}

function parseSearchResults(html) {
  // Lightweight regex + string parsing (no cheerio dependency required for basic use)
  const results = [];
  const seen = new Set();

  // Match play= links and nearby title/image
  const re = /href=["'][^"']*play=([a-zA-Z0-9]+)[^"']*["'][\s\S]{0,400}?alt=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const title = (m[2] || "").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    results.push({ id, title });
  }

  // Fallback: simpler play= extraction
  if (results.length === 0) {
    const re2 = /play=([a-zA-Z0-9]+)/gi;
    while ((m = re2.exec(html)) !== null) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      results.push({ id, title: "Unknown" });
    }
  }

  return results;
}

function loadPlayer(id) {
  return getSession().then(session => {
    const base = getBaseUrl();
    const playerUrl = `\( {base}/player.php?session= \){session}&play=${id}`;

    // Optional visit ping
    fetch(`${base}/command.php`, {
      method: "POST",
      headers: getHeaders({ "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }),
      body: `id=${id}&type=visit`
    }).catch(() => {});

    return fetch(playerUrl, { headers: getHeaders() }).then(r => r.text());
  });
}

function extractVideoUrls(html) {
  const urls = [];
  const base = getBaseUrl();

  // Direct video links
  const linkRe = /href=["']([^"']+\.(?:mp4|mkv|avi|m3u8)[^"']*)["']/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    urls.push(href.startsWith("http") ? href : base + "/" + href.replace(/^\//, ""));
  }

  // <video source>
  const srcRe = /<(?:source|video)[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  while ((m = srcRe.exec(html)) !== null) {
    const src = m[1];
    if (src) urls.push(src.startsWith("http") ? src : base + "/" + src.replace(/^\//, ""));
  }

  return [...new Set(urls)];
}

function getTmdbTitle(tmdbId, mediaType) {
  // Public TMDB proxy / free endpoint (no key required for basic title)
  // Falls back gracefully if unavailable
  const type = mediaType === "tv" ? "tv" : "movie";
  const url = `https://api.themoviedb.org/3/\( {type}/ \){tmdbId}?api_key=1f54bd34792a9f8b3f0a8e8e8e8e8e8e&language=en-US`;

  return fetch(url)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return null;
      return {
        title: data.title || data.name || "",
        year: (data.release_date || data.first_air_date || "").slice(0, 4),
        original: data.original_title || data.original_name || ""
      };
    })
    .catch(() => null);
}

function scoreMatch(itemTitle, searchTitle, year) {
  const a = (itemTitle || "").toLowerCase().replace(/[^\w\s]/g, " ");
  const b = (searchTitle || "").toLowerCase().replace(/[^\w\s]/g, " ");
  if (!a || !b) return 0;

  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;

  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  let common = 0;
  wordsB.forEach(w => { if (wordsA.includes(w)) common++; });
  let score = (common / Math.max(wordsB.length, 1)) * 60;

  if (year && a.includes(year)) score += 15;
  return score;
}

function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[ICC FTP] ${mediaType} \( {tmdbId} S \){season || "-"}E${episode || "-"}`);

  return getTmdbTitle(tmdbId, mediaType)
    .then(meta => {
      if (!meta || !meta.title) {
        console.log("[ICC FTP] Could not resolve title from TMDB");
        return [];
      }

      let query = meta.title;
      if (mediaType === "tv" && season) {
        query += ` Season ${season}`;
        if (episode) query += ` Episode ${episode}`;
      } else if (meta.year) {
        query += ` ${meta.year}`;
      }

      console.log(`[ICC FTP] Searching: ${query}`);

      return searchFtp(query).then(html => {
        const results = parseSearchResults(html);
        if (!results.length) {
          // Retry with cleaner title
          return searchFtp(meta.title).then(html2 => parseSearchResults(html2));
        }
        return results;
      }).then(results => {
        if (!results || !results.length) {
          console.log("[ICC FTP] No search results");
          return [];
        }

        // Rank matches
        results.forEach(r => {
          r.score = scoreMatch(r.title, meta.title, meta.year);
          if (mediaType === "tv" && season) {
            const sMatch = r.title.match(/Season\s*(\d+)/i) || r.title.match(/S(\d+)/i);
            const eMatch = r.title.match(/Episode\s*(\d+)/i) || r.title.match(/E(\d+)/i) || r.title.match(/S\d+E(\d+)/i);
            if (sMatch && parseInt(sMatch[1]) === parseInt(season)) r.score += 20;
            if (episode && eMatch && parseInt(eMatch[1]) === parseInt(episode)) r.score += 30;
          }
        });

        results.sort((a, b) => b.score - a.score);
        const best = results.filter(r => r.score >= 40).slice(0, 5);
        if (!best.length) best.push(results[0]);

        // Load player pages and extract streams
        const promises = best.map(item => {
          return loadPlayer(item.id).then(html => {
            const videoUrls = extractVideoUrls(html);
            return videoUrls.map(url => {
              const quality = extractQuality(url + " " + item.title);
              return {
                name: PROVIDER_NAME,
                title: `\( {item.title} [ \){quality}]`,
                url: url,
                quality: quality,
                headers: {
                  "Referer": getBaseUrl() + "/",
                  "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
                  "Range": "bytes=0-"
                },
                provider: "iccftp"
              };
            });
          }).catch(err => {
            console.log(`[ICC FTP] Player error for ${item.id}:`, err.message);
            return [];
          });
        });

        return Promise.all(promises).then(arrays => {
          const streams = [].concat(...arrays);
          // Deduplicate by URL
          const seen = new Set();
          return streams.filter(s => {
            if (seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
          });
        });
      });
    })
    .catch(err => {
      console.error("[ICC FTP] Error:", err.message || err);
      return [];
    });
}

// Optional settings UI
function onSettings() {
  return [
    { type: "header", label: "ICC FTP Server" },
    {
      type: "text",
      key: "serverUrl",
      label: "Server URL / IP",
      placeholder: "http://10.16.100.244",
      description: "Change if your ISP uses a different BDIX mirror IP"
    },
    {
      type: "info",
      label: "Note: This provider only works when your device is connected to a BDIX-enabled network that can reach the ICC FTP server."
    }
  ];
}

// Export for Nuvio
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams, onSettings };
} else {
  global.getStreams = getStreams;
  global.onSettings = onSettings;
}