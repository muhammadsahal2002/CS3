// primevideo.js – net52.cc mobile Prime Video (pv)
// =================================================================
"use strict";

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";
var TOKEN_URL = "https://raw.githubusercontent.com/muhammadsahal2002/adfree/refs/heads/master/token.json";
var BASE = "https://net52.cc";
var PV = BASE + "/mobile/pv";

var UA = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.85 Mobile Safari/537.36 /OS.Gatu v3.1";

var cookieHeader = "";
var userHash = ""; // decoded t_hash_t for playlist query

function log(msg) {
    console.log("[PrimePV] " + msg);
}

function ts() {
    return Math.floor(Date.now() / 1000);
}

function decodeToken(v) {
    if (!v) return "";
    try {
        return decodeURIComponent(String(v));
    } catch (e) {
        return String(v);
    }
}

function headers(xhr) {
    var h = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Referer": BASE + "/mobile/home?app=1",
        "Cookie": cookieHeader
    };
    if (xhr) h["X-Requested-With"] = xhr;
    return h;
}

function fetchToken() {
    return fetch(TOKEN_URL)
        .then(function(r) {
            if (!r.ok) throw new Error("Token HTTP " + r.status);
            return r.json();
        })
        .then(function(json) {
            userHash = decodeToken(json.token || json.t_hash_t);
            if (!userHash || userHash.indexOf("::") === -1) {
                throw new Error("Bad token in token.json");
            }
            // ott=pv is required for Prime
            cookieHeader = "t_hash_t=" + userHash + "; hd=on; ott=pv; lang=hin";
            if (json.t_hash) {
                cookieHeader += "; t_hash=" + decodeToken(json.t_hash);
            }
            log("Token OK");
            return userHash;
        });
}

function getTmdbTitle(tmdbId, mediaType) {
    var url = TMDB_BASE + "/" + (mediaType === "movie" ? "movie" : "tv") +
        "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) throw new Error("TMDB failed");
            return d.title || d.name;
        });
}

function search(query) {
    // PV search – response has searchResult (may not have status:"y")
    var url = PV + "/search.php?s=" + encodeURIComponent(query) +
        "&t=" + ts() + "&ADSearch=false";
    return fetch(url, { headers: headers("XMLHttpRequest") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.searchResult) {
                throw new Error("Search failed (token/ott?)");
            }
            return data.searchResult || [];
        });
}

function getPost(id) {
    var url = PV + "/post.php?id=" + encodeURIComponent(id) + "&t=" + ts();
    return fetch(url, { headers: headers("XMLHttpRequest") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || data.status !== "y") throw new Error("Post failed");
            return data;
        });
}

function getEpisodes(seasonId, seriesId) {
    var all = [];
    var page = 1;

    function next() {
        // Same pattern as NF, under /pv/
        var url = PV + "/episodes.php?s=" + encodeURIComponent(seasonId) +
            "&series=" + encodeURIComponent(seriesId) + "&t=" + ts();
        if (page > 1) url += "&page=" + page;

        return fetch(url, { headers: headers("XMLHttpRequest") })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data) return all;
                if (data.episodes) all = all.concat(data.episodes);
                if (data.nextPageShow === 1) {
                    page = data.nextPage || (page + 1);
                    return next();
                }
                return all;
            })
            .catch(function() {
                return all;
            });
    }
    return next();
}

function getPlaylist(id, title) {
    // Captured: playlist.php?id=...&t=Title&tm=...&lang=hin&hd=on&userhash=decoded_t_hash_t
    var url = PV + "/playlist.php?id=" + encodeURIComponent(id) +
        "&t=" + encodeURIComponent(title) +
        "&tm=" + ts() +
        "&lang=hin&hd=on&userhash=" + encodeURIComponent(userHash);

    return fetch(url, { headers: headers("app.netmirror.nmv2") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.length || !data[0].sources) {
                throw new Error("Empty playlist");
            }
            return data[0];
        });
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    return fetchToken()
        .then(function() {
            return getTmdbTitle(tmdbId, mediaType);
        })
        .then(function(title) {
            log("Title: " + title);
            return search(title).then(function(results) {
                if (!results.length) throw new Error("No results for " + title);
                var selected = results[0];
                log("Selected: " + selected.t + " (" + selected.id + ")");
                return getPost(selected.id).then(function(post) {
                    return { title: title, selected: selected, post: post };
                });
            });
        })
        .then(function(ctx) {
            var post = ctx.post;
            var selected = ctx.selected;
            var title = ctx.title;

            // Movie
            if (post.type === "m" || mediaType === "movie") {
                log("Movie");
                return getPlaylist(selected.id, post.title || title);
            }

            // Series
            var seasonList = post.season || [];
            var targetSeasonId = null;
            for (var i = 0; i < seasonList.length; i++) {
                if (parseInt(seasonList[i].s, 10) === season) {
                    targetSeasonId = seasonList[i].id;
                    break;
                }
            }
            if (!targetSeasonId) {
                throw new Error("Season " + season + " not found");
            }
            log("Season " + season + " → " + targetSeasonId);

            // Prefer episodes.php; fallback to post.episodes if same season
            return getEpisodes(targetSeasonId, selected.id).then(function(eps) {
                if (!eps.length && post.episodes && post.episodes.length) {
                    // post may only have last selected season eps
                    eps = post.episodes.filter(function(e) {
                        return e && String(e.s).replace(/^S/i, "") === String(season);
                    });
                }
                if (!eps.length) throw new Error("No episodes for season " + season);

                var target = null;
                for (var j = 0; j < eps.length; j++) {
                    var n = parseInt(String(eps[j].ep).replace(/^E/i, ""), 10);
                    if (n === episode) {
                        target = eps[j];
                        break;
                    }
                }
                if (!target) throw new Error("Episode " + episode + " not found");
                log("EP: " + target.t + " id=" + target.id);
                return getPlaylist(target.id, post.title || title);
            });
        })
        .then(function(playlist) {
            return playlist.sources.map(function(src) {
                var file = src.file || "";
                var url = file.indexOf("http") === 0 ? file : BASE + file;
                return {
                    name: "Prime Video",
                    title: src.label || "Auto",
                    url: url,
                    quality: src.label || "Auto",
                    headers: {
                        "Referer": BASE + "/",
                        "Origin": BASE,
                        "User-Agent": UA,
                        "Cookie": cookieHeader
                    }
                };
            });
        })
        .catch(function(err) {
            log("ERROR: " + (err && err.message ? err.message : String(err)));
            return [];
        });
}

module.exports = { getStreams: getStreams };