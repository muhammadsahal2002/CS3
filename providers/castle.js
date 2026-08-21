// newtv.js – Mobile API (net52.cc) with cookies
// Replace COOKIE_STRING when it expires.

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

// Mobile API base (from mobiledetects.com/check.php)
var MOBILE_BASE = "https://net52.cc";

// Cookie captured from mobile app – expires, update when needed
var COOKIE_STRING = "addhash=c94ef87a73a4b351c13d2cb296c475d8%3A%3A3b360d4c9771fecbb86700e6e5bbce8c%3A%3A1787334942%3A%3Adb; t_hash_t=b47f04cf1defdfc512bbe5cfcff39f67%3A%3A40dbfe59d9ad79a595fd88c8e353cc48%3A%3A1787335030%3A%3Adb%3A%3Am";

var USER_AGENT = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";

// Helper: fetch JSON with mobile headers and cookies
function fetchMobile(url) {
    return fetch(url, {
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": COOKIE_STRING,
            "Referer": "https://net52.cc/mobile/home?app=1"
        }
    })
    .then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    });
}

// Helper: fetch text (for M3U8)
function fetchMobileText(url) {
    return fetch(url, {
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": COOKIE_STRING,
            "Referer": "https://net52.cc/mobile/home?app=1"
        }
    })
    .then(function(res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
    });
}

// ----- TMDB -----
function getTmdbTitle(tmdbId, mediaType) {
    var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetch(url)
        .then(function(res) { return res.json(); })
        .then(function(data) { return data.title || data.name; });
}

// ----- Mobile Search -----
function searchMobile(query) {
    var url = MOBILE_BASE + "/mobile/search.php?s=" + encodeURIComponent(query) + "&ADSearch=false";
    return fetchMobile(url)
        .then(function(data) {
            if (data.status !== "y" || !data.searchResult) return [];
            return data.searchResult;
        });
}

// ----- Mobile Playlist -----
function getMobilePlaylist(id, title) {
    var url = MOBILE_BASE + "/mobile/playlist.php?id=" + id + "&t=" + encodeURIComponent(title) + "&tm=" + Math.floor(Date.now()/1000);
    return fetchMobile(url)
        .then(function(data) {
            // data is an array with one object containing "sources"
            if (!data || !data.length) return [];
            var sources = data[0].sources || [];
            return sources;
        });
}

// ----- Main Export -----
function getStreams(tmdbId, mediaType, season, episode) {
    if (!tmdbId) return Promise.reject(new Error('No TMDB ID provided'));

    var title, searchResults, selectedId;

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(t) {
            title = t;
            console.log("[NewTV] Title: " + title);
            return searchMobile(title);
        })
        .then(function(results) {
            if (!results.length) throw new Error('No results found for "' + title + '"');
            // Pick the first match (you can improve matching logic)
            var item = results[0];
            selectedId = item.id;
            console.log("[NewTV] Selected: " + item.t + " (ID: " + selectedId + ")");
            return getMobilePlaylist(selectedId, item.t);
        })
        .then(function(sources) {
            if (!sources.length) throw new Error('No sources found');
            // We'll use the first source (usually "Auto" or "Mid HD")
            // Prefer source with "hd=off" or "q=720p" – we return all
            var streamList = sources.map(function(src) {
                // `file` is relative path starting with /mobile/hls/...
                var fullUrl = MOBILE_BASE + src.file;
                var label = src.label || "Auto";
                var quality = label;
                return {
                    name: "NewTV",
                    title: quality,
                    url: fullUrl,
                    quality: quality,
                    headers: {
                        "Referer": "https://net52.cc/",
                        "User-Agent": USER_AGENT,
                        "Cookie": COOKIE_STRING
                    }
                };
            });
            console.log("[NewTV] Returning " + streamList.length + " streams");
            return streamList;
        });
}

module.exports = { getStreams: getStreams };