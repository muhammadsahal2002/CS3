/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Fixed: Uses correct Ajax search API
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    MAPPING_API: "https://id-mapping-api-malid.hf.space/api/resolve",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Stargon/6.4.3 Chrome/151.0.7922.85 Mobile Safari/537.36"
};

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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
        "Cookie": "country_code=BD"
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

function getTitle(tmdbId, mediaType) {
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

// ============================================================
// 🔥 FIXED: Uses the correct Ajax search API
// ============================================================
function searchAnime(title) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    // ✅ CORRECT API endpoint (from your capture)
    var url = CONFIG.BASE_URL + "/ajax/anime/search?keyword=" + encodeURIComponent(searchTitle);

    console.log("[AnikotoTV] Searching: " + searchTitle);

    return fetch(url, { headers: ajaxHeaders() })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.status !== 200 || !data.result) {
                console.log("[AnikotoTV] Search API returned no results");
                return null;
            }

            // Parse the HTML from result.html
            var html = data.result.html;
            if (!html) {
                console.log("[AnikotoTV] No HTML in search results");
                return null;
            }

            var $ = cheerio.load(html);
            var results = [];

            $("a.item").each(function(i, el) {
                var $el = $(el);
                var href = $el.attr("href");
                var nameEl = $el.find(".name.d-title");
                var title = nameEl.text().trim();
                var jpTitle = nameEl.attr("data-jp") || null;

                if (href && title) {
                    results.push({
                        title: title,
                        jpTitle: jpTitle,
                        url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                        isMovie: /movie|film|special|ova/i.test(title)
                    });
                }
            });

            if (results.length === 0) {
                console.log("[AnikotoTV] No results parsed from HTML");
                return null;
            }

            console.log("[AnikotoTV] Found " + results.length + " results");

            var q = normalize(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var jp = r.jpTitle ? normalize(r.jpTitle) : null;
                var score = 0;

                // Check title match
                if (t === q) {
                    score = 100;
                } else if (t.indexOf(q) === 0) {
                    score = 85;
                } else if (t.indexOf(q) !== -1) {
                    score = 60;
                } else if (q.indexOf(t) !== -1) {
                    score = 30;
                } else {
                    var words = q.split(" ");
                    var matchCount = 0;
                    var totalWords = words.length;
                    for (var w = 0; w < words.length; w++) {
                        if (words[w] && words[w].length > 2 && t.indexOf(words[w]) !== -1) {
                            matchCount++;
                        }
                    }
                    if (matchCount > 0) {
                        score = Math.round((matchCount / Math.max(totalWords, 1)) * 35);
                    }
                }

                // Bonus for Japanese title match
                if (jp) {
                    if (jp === q) score = Math.max(score, 90);
                    else if (jp.indexOf(q) !== -1) score = Math.max(score, 70);
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            // Minimum score threshold
            if (bestScore < 25) {
                console.log("[AnikotoTV] No good match (best score: " + bestScore + ")");
                return null;
            }

            console.log("[AnikotoTV] Best match: " + best.title + " (score: " + bestScore + ")");
            return best;
        })
        .catch(function(err) {
            console.log("[AnikotoTV] Search error: " + err.message);
            return null;
        });
}

function getAnimeId(url) {
    // If we already have the URL, we need to extract the anime ID from it
    // The URL format is: https://anikoto.cz/watch/anime-name-xxxxx
    // We can either fetch the page or extract from URL pattern
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
            if (!data || !data.result) return null;

            var $ = cheerio.load(data.result);
            var found = null;

            $("a[data-ids]").each(function(i, el) {
                if (found) return;
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                if (num === episodeNum && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

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
            return $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id") || null;
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

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) {
                console.log("[AnikotoTV] No title found for TMDB ID: " + tmdbId);
                return [];
            }
            console.log("[AnikotoTV] Title: " + title);

            return getImdbId(tmdbId, mediaType)
                .then(function(imdbId) {
                    var mappedEpisode = episode;

                    var mappingPromise = imdbId
                        ? resolveMapping(imdbId, season, episode)
                        : Promise.resolve(null);

                    return mappingPromise.then(function(mapping) {
                        if (mapping && mapping.mal_episode) {
                            mappedEpisode = mapping.mal_episode;
                            console.log("[AnikotoTV] Mapped episode: " + episode + " → " + mappedEpisode);
                        }

                        return searchAnime(title).then(function(best) {
                            if (!best) {
                                console.log("[AnikotoTV] No match found for: " + title);
                                return [];
                            }

                            console.log("[AnikotoTV] Using: " + best.title + " (URL: " + best.url + ")");

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) {
                                    console.log("[AnikotoTV] Could not get anime ID");
                                    return [];
                                }
                                console.log("[AnikotoTV] Anime ID: " + animeId);

                                return getDubEpisode(animeId, mappedEpisode, best.url)
                                    .then(function(ep) {
                                        if (!ep) {
                                            console.log("[AnikotoTV] No DUB episode " + mappedEpisode + " found");
                                            return [];
                                        }

                                        return getDubServer(ep.ids, best.url)
                                            .then(function(linkId) {
                                                if (!linkId) {
                                                    console.log("[AnikotoTV] No DUB server found");
                                                    return [];
                                                }
                                                return getEmbed(linkId, best.url);
                                            })
                                            .then(function(embed) {
                                                if (!embed || embed.indexOf("megaplay") === -1) {
                                                    console.log("[AnikotoTV] No Megaplay embed found");
                                                    return [];
                                                }
                                                return resolveMegaplay(embed);
                                            })
                                            .then(function(stream) {
                                                if (!stream) {
                                                    console.log("[AnikotoTV] No stream found");
                                                    return [];
                                                }
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