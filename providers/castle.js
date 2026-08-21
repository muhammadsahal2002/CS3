/**
 * Netmirror / imgcdn Provider for Nuvio
 * Netflix mirror streams via tv.imgcdn.kim
 */

"use strict";

var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0"
};

function apiHeaders(token) {
    return {
        "User-Agent": CONFIG.UA,
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "ott": "nf",
        "usertoken": token || "",
        "cache-control": "no-cache, no-store, must-revalidate"
    };
}

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function getToken() {
    return fetch(CONFIG.BASE + "/newtv/main.php", {
        headers: {
            "User-Agent": CONFIG.UA,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "ott": "nf",
            "page": "all"
        }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        return data && data.usertoken ? data.usertoken : null;
    })
    .catch(function() { return null; });
}

function getTmdbTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            return mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
        })
        .catch(function() { return null; });
}

function search(title, token) {
    var url = CONFIG.BASE + "/newtv/search.php?s=" + encodeURIComponent(title);

    return fetch(url, { headers: apiHeaders(token) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.searchResult || !data.searchResult.length) return null;

            var q = normalize(title);
            var best = null;
            var bestScore = -1;

            for (var i = 0; i < data.searchResult.length; i++) {
                var item = data.searchResult[i];
                var t = normalize(item.t);
                var score = 0;

                if (t === q) score = 100;
                else if (t.indexOf(q) !== -1) score = 70;
                else if (q.indexOf(t) !== -1) score = 50;

                // Prefer exact language variants less if title is plain
                if (score > bestScore) {
                    bestScore = score;
                    best = item;
                }
            }

            return best || data.searchResult[0];
        })
        .catch(function() { return null; });
}

function getPlayer(id, token) {
    var url = CONFIG.BASE + "/newtv/player.php?id=" + encodeURIComponent(id);

    return fetch(url, { headers: apiHeaders(token) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.status !== "ok" || !data.video_link) return null;
            return {
                url: data.video_link,
                referer: data.referer || CONFIG.REFERER,
                title: data.title || ""
            };
        })
        .catch(function() { return null; });
}

function getStreams(tmdbId, mediaType, season, episode) {
    mediaType = mediaType || "movie";

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) return [];

            return getToken().then(function(token) {
                if (!token) return [];

                return search(title, token).then(function(match) {
                    if (!match) return [];

                    return getPlayer(match.id, token).then(function(player) {
                        if (!player) return [];

                        return [{
                            name: "Netmirror",
                            title: "HD",
                            url: player.url,
                            quality: "1080p",
                            headers: {
                                "Referer": player.referer,
                                "User-Agent": CONFIG.UA,
                                "Origin": "https://tv.imgcdn.kim"
                            }
                        }];
                    });
                });
            });
        })
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };