// primevideo.js – Prime Video (pv) with subtitles
"use strict";

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";
var TOKEN_URL = "https://jsonhosting.com/api/json/eb20e727/raw";
var BASE = "https://net52.cc";
var PV = BASE + "/mobile/pv";

var UA = "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.85 Mobile Safari/537.36 /OS.Gatu v3.1";

var cookieHeader = "";
var rawToken = "";

function log(msg) {
    console.log("[PrimePV] " + msg);
}

function ts() {
    return Math.floor(Date.now() / 1000);
}

function normalizeTitle(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeTitleForSearch(str) {
    return String(str || "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ---------- Language priority (Hindi > English > others) ----------
function langPriority(title) {
    var t = (title || "").toLowerCase();
    if (/\bhindi\b/.test(t)) return 100;
    if (/\benglish\b/.test(t)) return 90;
    if (!/\b(tamil|telugu|malayalam|kannada|bengali|marathi)\b/.test(t)) return 50;
    return 10;
}

function headers(xhr) {
    var h = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Referer": BASE + "/mobile/home?app=1",
        "Origin": BASE,
        "Cookie": cookieHeader,
        "X-Requested-With": xhr || "XMLHttpRequest"
    };
    return h;
}

function fetchToken() {
    return fetch(TOKEN_URL)
        .then(function(r) {
            if (!r.ok) throw new Error("Token HTTP " + r.status);
            return r.json();
        })
        .then(function(json) {
            var record = json.record || {};
            rawToken = record.token || "";
            var t_hash_t = record.t_hash_t || "";
            var t_hash = record.t_hash || record.t_hash_encoded || record.addhash || "";

            if (!rawToken || rawToken.indexOf("::") === -1) {
                throw new Error("Invalid token format");
            }

            cookieHeader = "t_hash_t=" + t_hash_t;
            if (t_hash) {
                cookieHeader += "; t_hash=" + t_hash;
            }
            cookieHeader += "; ott=pv; hd=on";

            log("Token OK: " + rawToken.substring(0, 30) + "...");
            log("Cookie: " + cookieHeader);
            return rawToken;
        });
}

function getTmdbInfo(tmdbId, mediaType) {
    var url = TMDB_BASE + "/" + (mediaType === "movie" ? "movie" : "tv") +
        "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) throw new Error("TMDB failed");
            var title = d.title || d.name;
            var year = d.release_date ? d.release_date.substring(0,4) : 
                       (d.first_air_date ? d.first_air_date.substring(0,4) : "");
            return { title: title, year: year };
        });
}

function search(query) {
    var url = PV + "/search.php?s=" + encodeURIComponent(query) +
        "&t=" + ts() + "&ADSearch=false";
    return fetch(url, { headers: headers("XMLHttpRequest") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.searchResult) {
                return [];
            }
            return data.searchResult || [];
        });
}

function searchWithFallback(originalTitle, year) {
    var normalized = normalizeTitleForSearch(originalTitle);

    return search(originalTitle)
        .then(function(results) {
            if (results && results.length > 0) {
                return results;
            }
            log("No results for original title, trying normalized: " + normalized);
            return search(normalized);
        })
        .then(function(results) {
            if (!results || results.length === 0) {
                return [];
            }
            if (year) {
                var filtered = results.filter(function(item) {
                    return item.y === year;
                });
                if (filtered.length > 0) {
                    return filtered;
                }
            }
            return results;
        });
}

function getPost(id) {
    var url = PV + "/post.php?id=" + encodeURIComponent(id) + "&t=" + ts();
    return fetch(url, { headers: headers("XMLHttpRequest") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || data.status !== "y") {
                throw new Error("Post failed: " + (data.error || "unknown"));
            }
            return data;
        });
}

function getEpisodes(seasonId, seriesId) {
    var all = [];
    var page = 1;

    function next() {
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
            .catch(function() { return all; });
    }
    return next();
}

function getPlaylist(id, title, lang) {
    var url = PV + "/playlist.php?id=" + encodeURIComponent(id) +
        "&t=" + encodeURIComponent(title) +
        "&tm=" + ts() +
        "&lang=null" +
        "&hd=on" +
        "&userhash=" + encodeURIComponent(rawToken);

    return fetch(url, { headers: headers("app.netmirror.nmv2") })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data || !data.length || !data[0].sources) {
                throw new Error("Empty playlist (maybe wrong language or expired token)");
            }
            return data[0];
        });
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    return fetchToken()
        .then(function() {
            return getTmdbInfo(tmdbId, mediaType);
        })
        .then(function(tmdbInfo) {
            var title = tmdbInfo.title;
            var year = tmdbInfo.year;
            var isMovieType = (mediaType === "movie");
            log("TMDB Title: " + title + " (" + year + ") [" + (isMovieType ? 'Movie' : 'Series') + "]");
            
            return searchWithFallback(title, year).then(function(results) {
                if (!results.length) throw new Error("No results for " + title);

                // ---- Filter results based on movie/series ----
                var filteredResults = results;
                
                if (isMovieType && year) {
                    // MOVIE: Strict year matching
                    filteredResults = results.filter(function(item) {
                        return item.y === year;
                    });
                    if (filteredResults.length === 0) {
                        // Try fetching year from post.php
                        log("No movies with year " + year + " in search results, checking post.php...");
                        var fetchPromises = results.map(function(item) {
                            return getPost(item.id)
                                .then(function(post) {
                                    var itemYear = post.year || "";
                                    if (itemYear === year) {
                                        return { ...item, y: itemYear, post: post };
                                    }
                                    return null;
                                })
                                .catch(function() { return null; });
                        });
                        return Promise.all(fetchPromises).then(function(resultsWithYear) {
                            var validResults = resultsWithYear.filter(function(item) { return item !== null; });
                            if (validResults.length === 0) {
                                throw new Error("No movies found with year " + year);
                            }
                            filteredResults = validResults;
                            log("Found " + filteredResults.length + " movies with year " + year + " from post.php");
                            return { title: title, year: year, results: filteredResults, isMovieType: isMovieType };
                        });
                    }
                    log("Found " + filteredResults.length + " movies with year " + year);
                } else {
                    // SERIES: Year matching is flexible
                    log("Series mode: Year matching is flexible");
                    // Fetch years from post.php for better logging
                    var fetchPromises = results.map(function(item) {
                        return getPost(item.id)
                            .then(function(post) {
                                var itemYear = post.year || "";
                                item.y = itemYear;
                                item.post = post;
                                return item;
                            })
                            .catch(function() { return item; });
                    });
                    return Promise.all(fetchPromises).then(function(updatedResults) {
                        if (year) {
                            var yearMatches = updatedResults.filter(function(item) { return item.y === year; });
                            if (yearMatches.length > 0) {
                                log("Found " + yearMatches.length + " results with year " + year + " (preferred)");
                                var nonMatches = updatedResults.filter(function(item) { return item.y !== year; });
                                filteredResults = yearMatches.concat(nonMatches);
                            } else {
                                log("No results with year " + year + ", using all results");
                                filteredResults = updatedResults;
                            }
                        }
                        return { title: title, year: year, results: filteredResults, isMovieType: isMovieType };
                    });
                }
                
                return { title: title, year: year, results: filteredResults, isMovieType: isMovieType };
            });
        })
        .then(function(ctx) {
            var title = ctx.title;
            var year = ctx.year;
            var results = ctx.results;
            var isMovieType = ctx.isMovieType;

            // ---- Language priority selection ----
            var best = null;
            var bestScore = -1;

            for (var i = 0; i < results.length; i++) {
                var item = results[i];
                var score = langPriority(item.t) * 10;
                if (year && item.y === year) score += 5;
                if (score > bestScore) {
                    bestScore = score;
                    best = item;
                }
            }

            var selected = best || results[0];
            if (best) {
                log("Selected: " + selected.t + " (" + selected.y + ") score=" + bestScore);
            } else {
                log("No language pick, using first: " + selected.t + " (" + selected.y + ")");
            }

            // ---- FIX: Handle post correctly ----
            var postPromise;
            if (selected.post) {
                // If post is already attached, use it
                postPromise = Promise.resolve(selected.post);
            } else {
                // Otherwise fetch it
                postPromise = getPost(selected.id);
            }
            
            return postPromise.then(function(postData) {
                var post = postData;
                return { title: title, selected: selected, post: post };
            });
        })
        .then(function(ctx) {
            var post = ctx.post;
            var selected = ctx.selected;
            var title = ctx.title;

            var langList = post.lang || [];
            var chosenLang = "eng";
            if (langList.length) {
                var eng = langList.find(function(l) { return l.s === "eng"; });
                chosenLang = eng ? eng.s : langList[0].s;
            }
            log("Selected language: " + chosenLang);

            if (post.type === "m" || mediaType === "movie") {
                log("Movie mode");
                return getPlaylist(selected.id, post.title || title, chosenLang)
                    .then(function(playlist) {
                        return { playlist: playlist, post: post, chosenLang: chosenLang };
                    });
            }

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

            return getEpisodes(targetSeasonId, selected.id).then(function(eps) {
                if (!eps.length && post.episodes && post.episodes.length) {
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
                return getPlaylist(target.id, post.title || title, chosenLang)
                    .then(function(playlist) {
                        return { playlist: playlist, post: post, chosenLang: chosenLang };
                    });
            });
        })
        .then(function(result) {
            var playlist = result.playlist;
            var subtitles = [];
            if (playlist.tracks && playlist.tracks.length) {
                subtitles = playlist.tracks.map(function(track) {
                    var url = track.file || "";
                    if (url && url.indexOf("http") !== 0) {
                        url = (url.indexOf("//") === 0) ? "https:" + url : "https://net52.cc" + url;
                    }
                    return {
                        url: url,
                        language: track.label || "Unknown",
                        default: (track.label && track.label.toLowerCase().indexOf("english") !== -1) ? true : false
                    };
                });
            }

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
                    },
                    subtitles: subtitles
                };
            });
        })
        .catch(function(err) {
            log("ERROR: " + (err && err.message ? err.message : String(err)));
            return [];
        });
}

module.exports = { getStreams: getStreams };