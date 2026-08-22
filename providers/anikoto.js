/**
 * AnikotoTV Provider for Nuvio
 * DUB only – Accurate search with year & type matching
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    MAPPING_API: "https://id-mapping-api-malid.hf.space/api/resolve",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };
    if (extra) {
        for (var k in extra) h[k] = extra[k];
    }
    return h;
}

function ajaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL,
        "Cookie": "country_code=BD; prefered_server_type=dub"
    };
}

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function getImdbId(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "/external_ids?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            return data && data.imdb_id ? data.imdb_id : null;
        })
        .catch(function() { return null; });
}

// Get title AND year from TMDB
function getTitleAndYear(tmdbId, mediaType) {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = CONFIG.TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            var title = mediaType === "tv" ? (data.name || data.original_name) : (data.title || data.original_title);
            var year = null;
            var date = mediaType === "tv" ? data.first_air_date : data.release_date;
            if (date) year = parseInt(date.split("-")[0], 10);
            return { title: title, year: year };
        })
        .catch(function() { return null; });
}

function resolveMapping(imdbId, season, episode) {
    var url = CONFIG.MAPPING_API +
        "?id=" + encodeURIComponent(imdbId) +
        "&s=" + season +
        "&e=" + episode;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.error) return null;
            return data;
        })
        .catch(function() { return null; });
}

// ================================================================
// 🔥 IMPROVED SEARCH: uses year & type for accurate matching
// ================================================================
function searchAnime(title, year, mediaType) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);

    console.log("[AnikotoTV] Searching: " + searchTitle + " (year: " + year + ", type: " + mediaType + ")");

    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) {
                console.log("[AnikotoTV] No HTML returned");
                return null;
            }

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {
                var $el = $(el);
                var a = $el.find("a.name.d-title, a[data-jp]").first();
                if (!a.length) return;

                var href = a.attr("href");
                var t = (a.attr("data-jp") || a.text() || "").trim();
                if (!href || !t) return;

                // Extract year and type from meta
                var meta = $el.find(".meta").text() || "";
                var yearMatch = meta.match(/\b(19|20)\d{2}\b/);
                var itemYear = yearMatch ? parseInt(yearMatch[0], 10) : null;
                var isMovie = /movie/i.test(meta) || /film/i.test(t) || (href && href.indexOf("/movie/") !== -1);

                results.push({
                    title: t,
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    year: itemYear,
                    isMovie: isMovie
                });
            });

            if (results.length === 0) {
                console.log("[AnikotoTV] No results found");
                return null;
            }

            var q = normalize(title);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var score = 0;

                // ---- Title match ----
                if (t === q) {
                    score += 100;
                } else if (t.indexOf(q) !== -1) {
                    score += 70;
                } else if (q.indexOf(t) !== -1) {
                    score += 40;
                } else {
                    var words = q.split(" ");
                    var matchCount = 0;
                    for (var w = 0; w < words.length; w++) {
                        if (words[w] && words[w].length > 2 && t.indexOf(words[w]) !== -1) {
                            matchCount++;
                        }
                    }
                    if (matchCount > 0) {
                        score += Math.round((matchCount / words.length) * 40);
                    }
                }

                // ---- Year match ----
                if (year && r.year) {
                    if (r.year === year) {
                        score += 60;
                    } else if (Math.abs(r.year - year) <= 1) {
                        score += 30;
                    } else {
                        score -= 20;
                    }
                }

                // ---- Type match ----
                var isMovieRequest = (mediaType === "movie");
                if (r.isMovie === isMovieRequest) {
                    score += 30;
                } else {
                    score -= 20;
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            // If best score is low, fall back to first result
            if (bestScore < 30) {
                console.log("[AnikotoTV] Low score (" + bestScore + "), using first result: " + results[0].title);
                return results[0];
            }

            console.log("[AnikotoTV] Best: " + best.title + " (score: " + bestScore + ")");
            return best;
        })
        .catch(function(err) {
            console.log("[AnikotoTV] Search error: " + err.message);
            return null;
        });
}

function getAnimeId(url) {
    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;
            var $ = cheerio.load(html);
            var id = $("[data-id]").first().attr("data-id");
            if (id) return id;
            var m = html.match(/data-id=["'](\d+)["']/);
            return m ? m[1] : null;
        })
        .catch(function() { return null; });
}

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.status !== 200 || !data.result) return null;

            var $ = cheerio.load(data.result);
            var found = null;

            // Try exact DUB match first
            $("a[data-ids]").each(function(i, el) {
                if (found) return;
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                if (num === episodeNum && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

            // If not found, try nearby DUB episodes
            if (!found) {
                var closest = null;
                var closestDiff = Infinity;
                $("a[data-ids]").each(function(i, el) {
                    var a = $(el);
                    if (a.attr("data-dub") === "1" && a.attr("data-ids")) {
                        var num = parseInt(a.attr("data-num") || "0", 10);
                        var diff = Math.abs(num - episodeNum);
                        if (diff < closestDiff) {
                            closestDiff = diff;
                            closest = { ids: a.attr("data-ids"), number: num };
                        }
                    }
                });
                if (closest && closestDiff <= 5) {
                    console.log("[AnikotoTV] Using nearby DUB episode " + closest.number + " (requested: " + episodeNum + ")");
                    found = closest;
                }
            }

            // If still nothing, try any DUB episode
            if (!found) {
                $("a[data-ids]").each(function(i, el) {
                    if (found) return;
                    var a = $(el);
                    if (a.attr("data-dub") === "1" && a.attr("data-ids")) {
                        var num = parseInt(a.attr("data-num") || "0", 10);
                        console.log("[AnikotoTV] Using first available DUB episode: " + num);
                        found = { ids: a.attr("data-ids"), number: num };
                    }
                });
            }

            return found;
        })
        .catch(function() { return null; });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            var linkId = $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id");
            if (!linkId) linkId = $('li[data-link-id]').first().attr("data-link-id");
            return linkId || null;
        })
        .catch(function() { return null; });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            if (typeof data.result === "string") return data.result;
            if (data.result.url) return data.result.url;
            return null;
        })
        .catch(function() { return null; });
}

function resolveMegaplay(embed) {
    if (!embed) return Promise.resolve(null);

    if (embed.indexOf("autostart") === -1) {
        embed += (embed.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
    }

    return fetch(embed, {
        headers: headers({
            "Referer": CONFIG.BASE_URL,
            "Origin": CONFIG.BASE_URL
        })
    })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(html) {
        if (!html) return null;

        var m = html.match(/data-id=["'](\d+)["']/);
        if (!m) return null;

        return fetch("https://megaplay.buzz/stream/getSources?id=" + m[1], {
            headers: {
                "User-Agent": CONFIG.USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": embed,
                "Accept": "application/json"
            }
        }).then(function(r) { return r.ok ? r.json() : null; });
    })
    .then(function(data) {
        if (!data || !data.sources) return null;

        var file = data.sources.file || (data.sources[0] && data.sources[0].file);
        if (!file) return null;

        return {
            url: file,
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        };
    })
    .catch(function() { return null; });
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    console.log("[AnikotoTV] ========================================");
    console.log("[AnikotoTV] TMDB: " + tmdbId + ", Type: " + mediaType + ", S" + season + "E" + episode);

    return getTitleAndYear(tmdbId, mediaType)
        .then(function(info) {
            if (!info) {
                console.log("[AnikotoTV] No title/year found");
                return [];
            }
            var title = info.title;
            var year = info.year;
            console.log("[AnikotoTV] Title: " + title + ", Year: " + year);

            return getImdbId(tmdbId, mediaType)
                .then(function(imdbId) {
                    var mappedEpisode = episode;
                    var mappingPromise = imdbId ? resolveMapping(imdbId, season, episode) : Promise.resolve(null);
                    return mappingPromise.then(function(mapping) {
                        if (mapping && mapping.mal_episode) {
                            mappedEpisode = mapping.mal_episode;
                            console.log("[AnikotoTV] Mapped episode: " + episode + " → " + mappedEpisode);
                        }

                        return searchAnime(title, year, mediaType).then(function(best) {
                            if (!best) {
                                console.log("[AnikotoTV] No match found");
                                return [];
                            }

                            console.log("[AnikotoTV] Using: " + best.title + " (URL: " + best.url + ")");

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) {
                                    console.log("[AnikotoTV] Could not get anime ID");
                                    return [];
                                }
                                console.log("[AnikotoTV] Anime ID: " + animeId);

                                // For movies, try to get stream directly using animeId
                                if (mediaType === "movie") {
                                    return getDubServer(animeId, best.url)
                                        .then(function(linkId) {
                                            if (!linkId) return [];
                                            return getEmbed(linkId, best.url);
                                        })
                                        .then(function(embed) {
                                            if (!embed || embed.indexOf("megaplay") === -1) return [];
                                            return resolveMegaplay(embed);
                                        })
                                        .then(function(stream) {
                                            if (!stream) return [];
                                            console.log("[AnikotoTV] ✅ Movie stream found!");
                                            return [{
                                                name: "AnikotoTV",
                                                title: "1080p",
                                                url: stream.url,
                                                quality: "1080p",
                                                headers: stream.headers
                                            }];
                                        });
                                }

                                // TV series: get episode
                                return getDubEpisode(animeId, mappedEpisode, best.url)
                                    .then(function(ep) {
                                        if (!ep) {
                                            console.log("[AnikotoTV] No DUB episode " + mappedEpisode);
                                            return [];
                                        }
                                        console.log("[AnikotoTV] Found episode: " + ep.number);
                                        return getDubServer(ep.ids, best.url)
                                            .then(function(linkId) {
                                                if (!linkId) return [];
                                                return getEmbed(linkId, best.url);
                                            })
                                            .then(function(embed) {
                                                if (!embed || embed.indexOf("megaplay") === -1) return [];
                                                return resolveMegaplay(embed);
                                            })
                                            .then(function(stream) {
                                                if (!stream) return [];
                                                console.log("[AnikotoTV] ✅ Stream found!");
                                                return [{
                                                    name: "AnikotoTV",
                                                    title: "1080p DUB",
                                                    url: stream.url,
                                                    quality: "1080p",
                                                    headers: stream.headers
                                                }];
                                            });
                                    });
                            });
                        });
                    });
                });
        })
        .catch(function(err) {
            console.log("[AnikotoTV] Error: " + err.message);
            return [];
        });
}

module.exports = { getStreams };