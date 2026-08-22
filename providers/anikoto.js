/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Uses MAL mapping API for correct episode numbers
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

function searchAnime(title, year) {
    // Step 1: Normalize the search title
    var searchTitle = String(title || "")
        // Replace common separators with space
        .replace(/[:\-–—]/g, " ")
        // Remove parenthetical content (like (TV), (movie), etc.)
        .replace(/\([^)]*\)/g, "")
        // Remove special characters but keep letters, numbers, and spaces
        .replace(/[^a-zA-Z0-9\s]/g, "")
        // Normalize multiple spaces
        .replace(/\s+/g, " ")
        .trim();
    
    // If title is empty after normalization, use original
    if (!searchTitle) searchTitle = String(title || "").trim();
    
    // Create search variations
    var searchQueries = [searchTitle];
    
    // If title has multiple words, try first 3 words (removes extra descriptors)
    var words = searchTitle.split(/\s+/);
    if (words.length > 3) {
        searchQueries.push(words.slice(0, 3).join(" "));
    }
    
    // Try without common suffixes
    var suffixes = ["the", "anime", "series", "show", "tv", "movie"];
    var titleNoSuffix = searchTitle;
    for (var i = 0; i < suffixes.length; i++) {
        var suffix = suffixes[i];
        if (titleNoSuffix.toLowerCase().endsWith(" " + suffix)) {
            titleNoSuffix = titleNoSuffix.substring(0, titleNoSuffix.length - suffix.length - 1).trim();
            break;
        }
    }
    if (titleNoSuffix !== searchTitle && titleNoSuffix.length > 3) {
        searchQueries.push(titleNoSuffix);
    }
    
    // Remove duplicates
    searchQueries = searchQueries.filter(function(q, i) { 
        return q && searchQueries.indexOf(q) === i; 
    });
    
    // If year is provided, try searching with year
    if (year) {
        searchQueries.push(searchTitle + " " + year);
        if (titleNoSuffix !== searchTitle) {
            searchQueries.push(titleNoSuffix + " " + year);
        }
    }
    
    // Try first query
    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchQueries[0]);
    
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
                var type = $el.find(".type").text().trim() || "";
                
                if (!href || !t) return;

                results.push({
                    title: t,
                    titleNormalized: normalizeForMatching(t),
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    isMovie: /movie|film|special|ova/i.test(t) || /movie|film|special|ova/i.test(type),
                    type: type
                });
            });

            if (results.length === 0) return null;

            // Normalize search title for matching
            var searchNormalized = normalizeForMatching(searchTitle);
            
            // First pass: Try exact title match (case insensitive, normalized)
            var exactMatch = null;
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.titleNormalized === searchNormalized) {
                    exactMatch = r;
                    break;
                }
            }
            
            if (exactMatch) return exactMatch;

            // Second pass: Try contains match with scoring
            var bestMatch = null;
            var bestScore = -999;
            
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var score = 0;
                
                // Check if search term is in result or vice versa
                if (r.titleNormalized.indexOf(searchNormalized) !== -1) {
                    score = 50;
                } else if (searchNormalized.indexOf(r.titleNormalized) !== -1) {
                    score = 40;
                }
                
                // Check word overlap
                if (score === 0) {
                    var searchWords = searchNormalized.split(/\s+/);
                    var resultWords = r.titleNormalized.split(/\s+/);
                    var overlap = 0;
                    
                    for (var wi = 0; wi < searchWords.length; wi++) {
                        var word = searchWords[wi];
                        if (word.length > 2 && resultWords.indexOf(word) !== -1) {
                            overlap++;
                        }
                    }
                    
                    if (overlap > 0) {
                        score = overlap * 10 + Math.min(searchWords.length, resultWords.length) * 5;
                    }
                }
                
                // Bonus for matching length
                if (score > 0) {
                    var lengthDiff = Math.abs(r.titleNormalized.length - searchNormalized.length);
                    score += Math.max(0, 15 - lengthDiff);
                    
                    // Bonus if title length is similar
                    var wordDiff = Math.abs(r.titleNormalized.split(/\s+/).length - searchNormalized.split(/\s+/).length);
                    score += Math.max(0, 10 - wordDiff * 2);
                    
                    // Bonus if year matches
                    if (year && r.title.indexOf(year) !== -1) {
                        score += 30;
                    }
                    
                    // Bonus for TV shows (not movies)
                    if (!r.isMovie) score += 15;
                    if (r.isMovie) score -= 25;
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = r;
                }
            }
            
            // Return match if score is high enough
            if (bestMatch && bestScore >= 15) {
                return bestMatch;
            }
            
            // Third pass: Try alternative search queries
            var fallbackPromise = null;
            for (var qIdx = 1; qIdx < searchQueries.length && qIdx < 3; qIdx++) {
                var altQuery = searchQueries[qIdx];
                if (!altQuery || altQuery === searchQueries[0]) continue;
                
                var altUrl = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(altQuery);
                
                (function(altQ, altUrl) {
                    if (!fallbackPromise) {
                        fallbackPromise = fetch(altUrl, { headers: headers() })
                            .then(function(r) { return r.ok ? r.text() : null; })
                            .then(function(html) {
                                if (!html) return null;
                                
                                var $alt = cheerio.load(html);
                                var altResults = [];
                                
                                $alt("div.item").each(function(i, el) {
                                    var $el = $(el);
                                    var a = $el.find("a.name.d-title, a[data-jp]").first();
                                    if (!a.length) return;
                                    
                                    var href = a.attr("href");
                                    var t = (a.attr("data-jp") || a.text() || "").trim();
                                    if (!href || !t) return;
                                    
                                    altResults.push({
                                        title: t,
                                        titleNormalized: normalizeForMatching(t),
                                        url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                                        isMovie: /movie|film|special|ova/i.test(t)
                                    });
                                });
                                
                                if (altResults.length === 0) return null;
                                
                                var altNormalized = normalizeForMatching(altQ);
                                var altBest = null;
                                var altBestScore = -999;
                                
                                for (var ai = 0; ai < altResults.length; ai++) {
                                    var ar = altResults[ai];
                                    var score = 0;
                                    
                                    if (ar.titleNormalized === altNormalized) {
                                        score = 60;
                                    } else if (ar.titleNormalized.indexOf(altNormalized) !== -1) {
                                        score = 40;
                                    }
                                    
                                    if (score > altBestScore) {
                                        altBestScore = score;
                                        altBest = ar;
                                    }
                                }
                                
                                return altBest || altResults[0];
                            });
                    }
                })(altQuery, altUrl);
            }
            
            // Wait for fallback if available
            if (fallbackPromise) {
                return fallbackPromise.then(function(fallbackResult) {
                    if (fallbackResult) {
                        // Verify the fallback result is reasonable
                        var fbNormalized = normalizeForMatching(fallbackResult.title);
                        var searchNorm = normalizeForMatching(searchTitle);
                        if (fbNormalized.indexOf(searchNorm) !== -1 || searchNorm.indexOf(fbNormalized) !== -1) {
                            return fallbackResult;
                        }
                    }
                    // Return the first result as last resort
                    return results[0];
                });
            }
            
            // Final fallback: return first result that has at least one common word
            var fallback = null;
            var fallbackScore = -999;
            var searchWords = searchNormalized.split(/\s+/);
            
            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var rWords = r.titleNormalized.split(/\s+/);
                var score = 0;
                
                for (var wi = 0; wi < searchWords.length; wi++) {
                    if (searchWords[wi].length > 2 && rWords.indexOf(searchWords[wi]) !== -1) {
                        score += 10;
                    }
                }
                
                if (score > fallbackScore) {
                    fallbackScore = score;
                    fallback = r;
                }
            }
            
            return fallback || results[0];
        })
        .catch(function() { return null; });
}

// Helper function for normalized matching
function normalizeForMatching(str) {
    return String(str || "")
        .toLowerCase()
        // Remove special characters but keep letters, numbers, and spaces
        .replace(/[^a-z0-9\s]/g, "")
        // Normalize spaces
        .replace(/\s+/g, " ")
        .trim();
}
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
            if (!title) return [];

            return getImdbId(tmdbId, mediaType)
                .then(function(imdbId) {
                    var mappedEpisode = episode;

                    var mappingPromise = imdbId
                        ? resolveMapping(imdbId, season, episode)
                        : Promise.resolve(null);

                    return mappingPromise.then(function(mapping) {
                        if (mapping && mapping.mal_episode) {
                            mappedEpisode = mapping.mal_episode;
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
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };