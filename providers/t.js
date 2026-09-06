/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Uses Jikan API (MyAnimeList) for episode number resolution
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    JIKAN_API: "https://api.jikan.moe/v4",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

// Rate limiting for Jikan API (max 3 requests per second)
var jikanRateLimit = {
    lastRequest: 0,
    minInterval: 333 // 333ms between requests (3 per second)
};

function rateLimitJikan() {
    var now = Date.now();
    var waitTime = jikanRateLimit.minInterval - (now - jikanRateLimit.lastRequest);
    if (waitTime > 0) {
        return new Promise(resolve => setTimeout(resolve, waitTime));
    }
    jikanRateLimit.lastRequest = Date.now();
    return Promise.resolve();
}

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
        "Referer": referer || CONFIG.BASE_URL
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

function getTmdbIdFromImdb(imdbId) {
    var url = CONFIG.TMDB_BASE + "/find/" + encodeURIComponent(imdbId) + 
        "?api_key=" + CONFIG.TMDB_API_KEY + "&external_source=imdb_id";
    
    return fetch(url, {
        headers: {
            "User-Agent": CONFIG.USER_AGENT,
            "Accept": "application/json"
        }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data) return null;
        
        if (data.tv_results && data.tv_results.length > 0) {
            return data.tv_results[0].id;
        }
        
        if (data.movie_results && data.movie_results.length > 0) {
            return data.movie_results[0].id;
        }
        
        return null;
    })
    .catch(function() { return null; });
}

function getTitleFromImdb(imdbId) {
    var url = CONFIG.TMDB_BASE + "/find/" + encodeURIComponent(imdbId) + 
        "?api_key=" + CONFIG.TMDB_API_KEY + "&external_source=imdb_id";
    
    return fetch(url, {
        headers: {
            "User-Agent": CONFIG.USER_AGENT,
            "Accept": "application/json"
        }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data) return null;
        
        if (data.tv_results && data.tv_results.length > 0) {
            return data.tv_results[0].name || data.tv_results[0].original_name;
        }
        
        if (data.movie_results && data.movie_results.length > 0) {
            return data.movie_results[0].title || data.movie_results[0].original_title;
        }
        
        return null;
    })
    .catch(function() { return null; });
}

/**
 * Get MAL ID from IMDB using Jikan API
 */
function getMalIdFromImdb(imdbId) {
    return rateLimitJikan()
        .then(function() {
            var url = CONFIG.JIKAN_API + "/anime?q=imdb:" + encodeURIComponent(imdbId);
            
            return fetch(url, {
                headers: {
                    "User-Agent": CONFIG.USER_AGENT,
                    "Accept": "application/json"
                }
            })
            .then(function(r) { 
                if (!r.ok) {
                    console.log("[Anikoto] Jikan API error:", r.status);
                    return null;
                }
                return r.json(); 
            })
            .then(function(data) {
                if (!data || !data.data || data.data.length === 0) {
                    console.log("[Anikoto] No MAL entry found for IMDB:", imdbId);
                    return null;
                }
                
                var malId = data.data[0].mal_id;
                console.log("[Anikoto] Found MAL ID:", malId, "for IMDB:", imdbId);
                return malId;
            })
            .catch(function(err) {
                console.log("[Anikoto] Jikan error:", err.message);
                return null;
            });
        });
}

/**
 * Get episode mapping from MAL
 * MAL uses absolute episode numbers, which solves the season-splitting problem
 */
function getMALEpisodeMapping(malId, requestedEpisode) {
    if (!malId) {
        return Promise.resolve(null);
    }
    
    return rateLimitJikan()
        .then(function() {
            var url = CONFIG.JIKAN_API + "/anime/" + malId + "/episodes?page=1";
            
            return fetch(url, {
                headers: {
                    "User-Agent": CONFIG.USER_AGENT,
                    "Accept": "application/json"
                }
            })
            .then(function(r) { 
                if (!r.ok) {
                    console.log("[Anikoto] Jikan episodes error:", r.status);
                    return null;
                }
                return r.json(); 
            })
            .then(function(data) {
                if (!data || !data.data) {
                    console.log("[Anikoto] No episode data from Jikan");
                    return null;
                }
                
                // Check if the requested episode exists
                var totalEpisodes = data.data.length;
                console.log("[Anikoto] MAL has", totalEpisodes, "episodes");
                
                // For shows with season splits (like Dragon Ball Super)
                // We need to map the season/episode to absolute episode number
                // If we have IMDB mapping, use it; otherwise use the episode as-is
                
                // If requested episode > total episodes, it might be a seasonal mapping
                if (requestedEpisode > totalEpisodes) {
                    console.log("[Anikoto] Episode", requestedEpisode, "exceeds total MAL episodes:", totalEpisodes);
                    console.log("[Anikoto] This suggests a seasonal mapping is needed");
                    
                    // For Dragon Ball Super: Season 5 Episode 53 -> Episode 150
                    // Since we can't calculate this from MAL alone, we'll need a mapping
                    return null;
                }
                
                // If episode exists in MAL, use it directly
                console.log("[Anikoto] Episode", requestedEpisode, "exists in MAL, using it directly");
                return requestedEpisode;
            })
            .catch(function(err) {
                console.log("[Anikoto] Jikan episodes error:", err.message);
                return null;
            });
        });
}

/**
 * Special hardcoded mappings for shows with season splits
 * These are based on the actual MAL episode numbering
 */
function getHardcodedMapping(imdbId, season, episode) {
    // Dragon Ball Super: TMDB has 1 season, MAL/Anikoto has 5 seasons
    // Season 1: Ep 1-26, Season 2: Ep 27-49, Season 3: Ep 50-76, 
    // Season 4: Ep 77-97, Season 5: Ep 98-131
    if (imdbId === "tt4644488") {
        var seasonStarts = {
            1: 1,
            2: 27,
            3: 50,
            4: 77,
            5: 98
        };
        
        if (seasonStarts[season]) {
            var mapped = seasonStarts[season] + episode - 1;
            console.log("[Anikoto] Hardcoded mapping for Dragon Ball Super:", 
                       "Season", season, "Episode", episode, "->", mapped);
            return mapped;
        }
    }
    
    // Naruto Shippuden: Similar season splits
    if (imdbId === "tt0988824") {
        // Naruto Shippuden has 20+ seasons in some databases
        // But uses absolute episode numbering in MAL
        var seasonStarts = {
            1: 1,
            2: 33,
            3: 54,
            4: 72,
            5: 89,
            6: 113,
            7: 144,
            8: 152,
            9: 176,
            10: 197,
            11: 222,
            12: 243,
            13: 276,
            14: 296,
            15: 321,
            16: 349,
            17: 362,
            18: 373,
            19: 394,
            20: 414
        };
        
        if (seasonStarts[season]) {
            var mapped = seasonStarts[season] + episode - 1;
            console.log("[Anikoto] Hardcoded mapping for Naruto Shippuden:", 
                       "Season", season, "Episode", episode, "->", mapped);
            return mapped;
        }
    }
    
    // Add more shows as needed
    
    return null;
}

/**
 * Resolve episode mapping using Jikan and hardcoded fallbacks
 */
function resolveMapping(imdbId, season, episode) {
    if (!imdbId) {
        return Promise.resolve(null);
    }

    // First check hardcoded mappings
    var hardcoded = getHardcodedMapping(imdbId, season, episode);
    if (hardcoded !== null) {
        return Promise.resolve({ mal_episode: hardcoded, mapping_type: "hardcoded" });
    }

    // Try to get MAL ID and mapping
    return getMalIdFromImdb(imdbId)
        .then(function(malId) {
            if (!malId) {
                console.log("[Anikoto] No MAL ID found, using original episode");
                return null;
            }
            
            return getMALEpisodeMapping(malId, episode)
                .then(function(mappedEpisode) {
                    if (mappedEpisode !== null) {
                        console.log("[Anikoto] Jikan mapping:", episode, "->", mappedEpisode);
                        return { mal_episode: mappedEpisode, mapping_type: "jikan" };
                    }
                    
                    // If Jikan didn't find a mapping, try to use the episode as-is
                    console.log("[Anikoto] Using original episode:", episode);
                    return { mal_episode: episode, mapping_type: "original" };
                });
        })
        .catch(function(err) {
            console.log("[Anikoto] Mapping error:", err.message);
            return null;
        });
}

function searchAnime(title) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);

    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {
                var $el = $(el);
                var a = $el.find("a.name.d-title, a[data-jp]").first();
                if (!a.length) return;

                var href = a.attr("href");
                var t = (a.attr("data-jp") || a.text() || "").trim();
                if (!href || !t) return;

                results.push({
                    title: t,
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    isMovie: /movie|film|special|ova/i.test(t)
                });
            });

            if (results.length === 0) return null;

            var q = normalize(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var score = 0;

                if (t === q) score = 100;
                else if (t.indexOf(q) !== -1) score = 70;
                else if (q.indexOf(t) !== -1) score = 40;

                if (!r.isMovie) score += 20;
                if (r.isMovie) score -= 30;

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            return best || results[0];
        })
        .catch(function() { return null; });
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

function getStreams(id, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    var isImdbId = typeof id === 'string' && id.startsWith('tt');
    var imdbId = isImdbId ? id : null;
    var tmdbId = isImdbId ? null : id;

    console.log("[Anikoto] getStreams:", { id, mediaType, season, episode, isImdbId });

    var titlePromise = tmdbId 
        ? getTitle(tmdbId, mediaType)
        : (imdbId ? getTitleFromImdb(imdbId) : Promise.resolve(null));

    return titlePromise
        .then(function(title) {
            if (!title) {
                console.log("[Anikoto] No title found");
                return [];
            }

            console.log("[Anikoto] Title:", title);

            var imdbPromise = imdbId 
                ? Promise.resolve(imdbId)
                : (tmdbId ? getImdbId(tmdbId, mediaType) : Promise.resolve(null));

            return imdbPromise.then(function(resolvedImdbId) {
                console.log("[Anikoto] IMDB ID:", resolvedImdbId);
                
                var mappedEpisode = episode;
                var mappingPromise = resolvedImdbId
                    ? resolveMapping(resolvedImdbId, season, episode)
                    : Promise.resolve(null);

                return mappingPromise.then(function(mapping) {
                    if (mapping && mapping.mal_episode) {
                        mappedEpisode = mapping.mal_episode;
                        console.log("[Anikoto] Mapped to:", mappedEpisode, 
                                   "(via", mapping.mapping_type || "unknown", ")");
                    } else {
                        console.log("[Anikoto] No mapping, using original:", episode);
                    }

                    return searchAnime(title).then(function(best) {
                        if (!best) return [];

                        return getAnimeId(best.url).then(function(animeId) {
                            if (!animeId) return [];

                            return getDubEpisode(animeId, mappedEpisode, best.url)
                                .then(function(ep) {
                                    if (!ep) return [];

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
            console.log("[Anikoto] Error:", err.message || err);
            return [];
        });
}

module.exports = { getStreams };