// newtv.js – Mobile API with cookie refresh support
// ==================================================
// TO UPDATE COOKIE: open the mobile app, capture a request to net52.cc,
// copy the entire "Cookie" header value and replace COOKIE_STRING below.

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var MOBILE_BASE = "https://net52.cc";

// ⚠️ REPLACE THIS with a fresh cookie from the mobile app
var COOKIE_STRING = "addhash=c94ef87a73a4b351c13d2cb296c475d8%3A%3A3b360d4c9771fecbb86700e6e5bbce8c%3A%3A1787334942%3A%3Adb; t_hash_t=b47f04cf1defdfc512bbe5cfcff39f67%3A%3A40dbfe59d9ad79a595fd88c8e353cc48%3A%3A1787335030%3A%3Adb%3A%3Am";

var USER_AGENT = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";

function log(msg) { console.log("[NewTV] " + msg); }

function fetchMobileJson(url) {
    log("fetch: " + url);
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
    })
    .then(function(data) {
        log("response keys: " + JSON.stringify(Object.keys(data)));
        return data;
    });
}

function fetchMobileText(url) {
    log("fetchText: " + url);
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
    return fetchMobileJson(url)
        .then(function(data) {
            if (data.status !== "y" || !data.searchResult) {
                log("Search failed or no results");
                return [];
            }
            return data.searchResult;
        });
}

// ----- Mobile Playlist -----
function getMobilePlaylist(id, title) {
    var timestamp = Math.floor(Date.now() / 1000);
    var url = MOBILE_BASE + "/mobile/playlist.php?id=" + id + "&t=" + encodeURIComponent(title) + "&tm=" + timestamp;
    return fetchMobileJson(url)
        .then(function(data) {
            log("Playlist response type: " + typeof data + ", length: " + (data ? data.length : 0));
            if (!data || !data.length) {
                log("Empty or invalid playlist response");
                return [];
            }
            // data is an array; first element has "sources"
            var sources = data[0] && data[0].sources ? data[0].sources : [];
            log("Found " + sources.length + " sources");
            return sources;
        });
}

// ----- Fallback TV API (only works for some movies, may give images) -----
function getTvApiStream(id) {
    var url = "https://tv.imgcdn.kim/newtv/player.php?id=" + id;
    return fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "ott": "nf",
            "usertoken": "d945e9dc888dc22741a1eeb3abc489a5::9f4baa0702c2486030ff927d1d96dfdc::1787328769::db"
        }
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        if (data.status === "ok" && data.video_link) {
            return [{
                name: "NewTV (fallback)",
                title: "Master M3U8",
                url: data.video_link,
                quality: "Auto",
                headers: { Referer: data.referer || "https://net52.cc" }
            }];
        }
        return [];
    });
}

// ----- Main Export -----
function getStreams(tmdbId, mediaType, season, episode) {
    if (!tmdbId) return Promise.reject(new Error('No TMDB ID provided'));

    var title, searchResults, selectedId;

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(t) {
            title = t;
            log("Title: " + title);
            return searchMobile(title);
        })
        .then(function(results) {
            if (!results.length) {
                log("No search results, trying TV API fallback");
                // Try TV API with known ID? We'll use tmdbId as fallback search? 
                // For now, we'll try to get a player directly from tv.imgcdn.
                return getTvApiStream(tmdbId).then(function(streams) {
                    if (streams.length) return streams;
                    throw new Error("No streams found anywhere");
                });
            }
            var item = results[0];
            selectedId = item.id;
            log("Selected: " + item.t + " (ID: " + selectedId + ")");
            return getMobilePlaylist(selectedId, item.t);
        })
        .then(function(sources) {
            if (!sources || !sources.length) {
                log("No mobile sources, trying TV API");
                return getTvApiStream(selectedId || tmdbId);
            }
            // Build full stream objects
            var streamList = sources.map(function(src) {
                var fullUrl = MOBILE_BASE + src.file;
                var quality = src.label || "Auto";
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
            log("Returning " + streamList.length + " streams");
            return streamList;
        })
        .catch(function(err) {
            log("ERROR: " + err.message);
            throw err;
        });
}

module.exports = { getStreams: getStreams };