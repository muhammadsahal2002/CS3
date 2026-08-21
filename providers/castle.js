/**
 * NewTV / Netmirror Provider for Nuvio
 * Returns master m3u8 (fixes audio)
 */

"use strict";

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
    OTT: "nf"
};

function headers(token) {
    return {
        "User-Agent": CONFIG.UA,
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "ott": CONFIG.OTT,
        "usertoken": token || ""
    };
}

function getToken() {
    return fetch(CONFIG.BASE + "/newtv/main.php", {
        headers: {
            "User-Agent": CONFIG.UA,
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "NetmirrorNewTV v1.0",
            "ott": CONFIG.OTT,
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
    var endpoint = mediaType === "movie" ? "movie" : "tv";
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;

    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            return data.title || data.name || data.original_title || data.original_name || null;
        })
        .catch(function() { return null; });
}

function searchNewTV(query, token) {
    var url = CONFIG.BASE + "/newtv/search.php?s=" + encodeURIComponent(query);

    return fetch(url, { headers: headers(token) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.searchResult || !data.searchResult.length) return null;
            return data.searchResult[0];
        })
        .catch(function() { return null; });
}

function getPlayer(id, token) {
    var url = CONFIG.BASE + "/newtv/player.php?id=" + encodeURIComponent(id);

    return fetch(url, { headers: headers(token) })
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

                return searchNewTV(title, token).then(function(match) {
                    if (!match) return [];

                    return getPlayer(match.id, token).then(function(player) {
                        if (!player) return [];

                        // Return MASTER m3u8 only – keeps audio tracks working
                        return [{
                            name: "NewTV",
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