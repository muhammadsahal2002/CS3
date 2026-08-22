// newtv.js – TV API (tv.imgcdn.kim) – Works with movies & TV series
// =================================================================
// Update USERTOKEN when it expires (capture from TV app).

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
    USERTOKEN: "d945e9dc888dc22741a1eeb3abc489a5::9f4baa0702c2486030ff927d1d96dfdc::1787328769::db",
    OTT: "pv"
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

// Fetch episodes for a given season ID, returns array of episode objects.
function fetchSeasonEpisodes(seasonId) {
    var allEpisodes = [];
    var page = 1;
    var hasNext = true;

    function fetchPage(p) {
        var url = CONFIG.BASE + "/newtv/episodes.php?id=" + seasonId + "&page=" + p;
        return fetchJson(url, { headers: headers() })
            .then(function(data) {
                if (!data || !data.episodes) return [];
                var eps = data.episodes.filter(function(e) { return e !== null; });
                allEpisodes = allEpisodes.concat(eps);
                if (data.nextPageShow === 1) {
                    return fetchPage(p + 1);
                } else {
                    return allEpisodes;
                }
            });
    }
    return fetchPage(page);
}

function getStreams(tmdbId, mediaType, season, episode) {
    if (!tmdbId) return Promise.reject(new Error('No TMDB ID provided'));

    var title;

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(t) {
            title = t;
            log("Title: " + title);
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

            // If it's a movie or we don't have season/episode, just play the main content
            if (post.type === "m" || season === undefined || episode === undefined) {
                var contentId = post.main_id || post.id;
                log("Movie or no season/episode, using ID: " + contentId);
                return getPlayer(contentId);
            }

            // It's a TV series
            log("TV series detected, looking for S" + season + "E" + episode);

            // Find the season ID from the season list
            var seasonList = post.season || [];
            var targetSeasonId = null;
            for (var i = 0; i < seasonList.length; i++) {
                var sObj = seasonList[i];
                // Extract season number from string like "Season 1 (13 EP)"
                var match = sObj.s.match(/Season (\d+)/);
                if (match) {
                    var num = parseInt(match[1], 10);
                    if (num === season) {
                        targetSeasonId = sObj.id;
                        break;
                    }
                }
            }

            if (!targetSeasonId) {
                // Sometimes the season list may not have all seasons; we might need to fetch them differently
                // As fallback, try to use the first season? But better to throw.
                throw new Error("Season " + season + " not found in series data.");
            }

            log("Season ID: " + targetSeasonId);

            // Fetch episodes for that season
            return fetchSeasonEpisodes(targetSeasonId)
                .then(function(episodes) {
                    if (!episodes || !episodes.length) {
                        throw new Error("No episodes found for season " + season);
                    }

                    // Find the episode by number
                    var targetEp = null;
                    for (var j = 0; j < episodes.length; j++) {
                        var epObj = episodes[j];
                        // epObj.ep is the episode number as string (e.g., "1")
                        if (parseInt(epObj.ep, 10) === episode) {
                            targetEp = epObj;
                            break;
                        }
                    }

                    if (!targetEp) {
                        throw new Error("Episode " + episode + " not found in season " + season);
                    }

                    log("Found episode: " + targetEp.t + " (ID: " + targetEp.id + ")");
                    return getPlayer(targetEp.id);
                });
        })
        .then(function(player) {
            if (!player) throw new Error('Failed to get player info');
            return [{
                name: 'PRIME VIDEO',
                title: 'Auto',
                url: player.video_link,
                quality: 'Auto',
                headers: { Referer: player.referer || CONFIG.REFERER }
            }];
        });
}

module.exports = { getStreams: getStreams };