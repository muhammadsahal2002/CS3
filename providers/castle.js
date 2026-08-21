// newtv.js – Master-only version (Nuvio handles selection)

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
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
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
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

function getTmdbTitle(tmdbId, mediaType) {
    var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url)
        .then(function(data) { return data.title || data.name; });
}

function searchNewTV(query) {
    var url = CONFIG.BASE + "/newtv/search.php?s=" + encodeURIComponent(query);
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (!data || !data.searchResult) return [];
            return data.searchResult;
        });
}

function getPost(id) {
    var url = CONFIG.BASE + "/newtv/post.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok") return null;
            return data;
        });
}

function getPlayer(id) {
    var url = CONFIG.BASE + "/newtv/player.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok" || !data.video_link) return null;
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
            // Return ONLY the master M3U8 – let Nuvio parse and select the best stream
            return [{
                name: 'NewTV',
                title: 'Auto (Master)',
                url: player.video_link,
                quality: 'Auto',
                headers: { Referer: player.referer || CONFIG.REFERER }
            }];
        });
}

module.exports = { getStreams: getStreams };