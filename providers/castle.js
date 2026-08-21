// newtv.js – TV API fallback (plays video, may lack audio)
// =========================================================
// If you need audio, you must update the mobile cookie (see instructions below).

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
    // ⚠️ Replace this token when it expires (it's from your TV app capture)
    USERTOKEN: "d945e9dc888dc22741a1eeb3abc489a5::9f4baa0702c2486030ff927d1d96dfdc::1787328769::db",
    OTT: "nf"
};

function log(msg) { console.log("[NewTV] " + msg); }

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.UA,
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "ott": CONFIG.OTT,
        "usertoken": CONFIG.USERTOKEN
    };
    if (extra) {
        for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    }
    return h;
}

function fetchJson(url, options) {
    options = options || {};
    log("fetchJson: " + url);
    return fetch(url, options)
        .then(function(res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        });
}

function fetchText(url, options) {
    options = options || {};
    log("fetchText: " + url);
    return fetch(url, options)
        .then(function(res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.text();
        });
}

function getTmdbTitle(tmdbId, mediaType) {
    var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url)
        .then(function(data) {
            var title = data.title || data.name;
            log("TMDB title: " + title);
            return title;
        });
}

function searchNewTV(query) {
    var url = CONFIG.BASE + "/newtv/search.php?s=" + encodeURIComponent(query);
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (!data || !data.searchResult) return [];
            log("Search results: " + data.searchResult.length);
            return data.searchResult;
        });
}

function getPost(id) {
    var url = CONFIG.BASE + "/newtv/post.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok") {
                log("Post status not ok: " + data.status);
                return null;
            }
            log("Post title: " + data.title);
            return data;
        });
}

function getPlayer(id) {
    var url = CONFIG.BASE + "/newtv/player.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok" || !data.video_link) {
                log("Player failed: " + JSON.stringify(data));
                return null;
            }
            log("Player video_link obtained");
            return data;
        });
}

function getStreams(tmdbId, mediaType, season, episode) {
    if (!tmdbId) return Promise.reject(new Error('No TMDB ID provided'));

    var title, playerData;

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(t) {
            title = t;
            return searchNewTV(title);
        })
        .then(function(results) {
            if (!results.length) throw new Error('No results found for "' + title + '"');
            var item = results[0];
            log("Selected: " + item.t + " (ID: " + item.id + ")");
            return getPost(item.id);
        })
        .then(function(post) {
            if (!post) throw new Error('Failed to get post info');
            var contentId = post.main_id || post.id;
            return getPlayer(contentId);
        })
        .then(function(player) {
            if (!player) throw new Error('Failed to get player info');
            playerData = player;
            // Return the master M3U8 URL (no parsing)
            return [{
                name: 'NewTV',
                title: 'Auto (Master)',
                url: player.video_link,
                quality: 'Auto',
                headers: { Referer: player.referer || CONFIG.REFERER }
            }];
        })
        .catch(function(err) {
            log("ERROR: " + err.message);
            throw err;
        });
}

module.exports = { getStreams: getStreams };