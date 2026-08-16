/**
 * AnikotoTV - Fixed for multi-season anime with proper episode mapping
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function getHeaders(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
}

function getAjaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL
    };
}

function makeDebugStream(msg) {
    return {
        name: "DEBUG: " + msg,
        title: msg,
        url: "https://test.com/error",
        quality: "DEBUG",
        headers: {}
    };
}

function normalize(str) {
    return (str || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function getStreams(tmdbId, mediaType, season, episode) {
    var debug = [];
    var realStreams = [];
    var epNum = episode || 1;
    var seasonNum = season || 1;

    debug.push(makeDebugStream("START: " + tmdbId + " " + mediaType + " S" + seasonNum + "E" + epNum));

    // For movies, just search and return
    if (mediaType === "movie") {
        return searchAndGetStreams(tmdbId, mediaType, seasonNum, epNum, debug, realStreams);
    }

    // For TV shows, get TMDB data first to map season/episode to absolute episode number
    var tmdbUrl = CONFIG.TMDB_BASE + "/tv/" + tmdbId + "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(tmdbData) {
            var searchTitle = String(tmdbId);
            var absoluteEpisode = epNum;

            if (tmdbData) {
                searchTitle = tmdbData.name || searchTitle;
                debug.push(makeDebugStream("TMDB OK: " + searchTitle));

                // Get absolute episode number using TMDB's season data
                if (tmdbData.seasons && tmdbData.seasons.length > 0) {
                    // Sort seasons
                    var sortedSeasons = tmdbData.seasons.slice().sort(function(a, b) {
                        return a.season_number - b.season_number;
                    });

                    var totalBefore = 0;
                    var targetSeasonFound = false;

                    for (var i = 0; i < sortedSeasons.length; i++) {
                        var s = sortedSeasons[i];
                        
                        // Skip season 0 if it exists (specials)
                        if (s.season_number === 0) continue;
                        
                        if (s.season_number === seasonNum) {
                            targetSeasonFound = true;
                            break;
                        }
                        
                        // Count episodes from previous seasons
                        if (s.season_number < seasonNum && s.episode_count) {
                            totalBefore += s.episode_count;
                        }
                    }

                    if (targetSeasonFound) {
                        absoluteEpisode = totalBefore + epNum;
                        debug.push(makeDebugStream("Absolute episode: " + absoluteEpisode + " (S" + seasonNum + "E" + epNum + ")"));
                    } else {
                        debug.push(makeDebugStream("Season " + seasonNum + " not found, using episode as-is"));
                    }
                }
            } else {
                debug.push(makeDebugStream("TMDB FAILED - using fallback"));
            }

            // Search for the anime and get streams
            return searchAndGetStreamsWithAbsolute(searchTitle, absoluteEpisode, epNum, seasonNum, debug, realStreams);
        })
        .catch(function(err) {
            debug.push(makeDebugStream("TMDB ERROR: " + (err.message || "unknown")));
            // Fallback: just search with the ID and use episode as-is
            return searchAndGetStreamsWithAbsolute(String(tmdbId), epNum, epNum, seasonNum, debug, realStreams);
        });
}

function searchAndGetStreamsWithAbsolute(searchTitle, absoluteEpisode, originalEpisode, seasonNum, debug, realStreams) {
    var searchUrl = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);
    
    return fetch(searchUrl, { headers: getHeaders() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) {
                debug.push(makeDebugStream("SEARCH: empty HTML"));
                return debug.concat(realStreams);
            }

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {
                var $el = $(el);
                var titleEl = $el.find("a.name.d-title, a[data-jp]").first();
                if (!titleEl.length) return;
                var href = titleEl.attr("href");
                var title = (titleEl.attr("data-jp") || titleEl.text() || "").trim();
                if (!href || !title) return;

                var fullUrl = href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href;
                var isMovie = /movie|film|special|ova/i.test(title);

                results.push({
                    title: title,
                    url: fullUrl,
                    isMovie: isMovie
                });
            });

            debug.push(makeDebugStream("SEARCH: " + results.length + " results"));

            if (results.length === 0) {
                debug.push(makeDebugStream("SEARCH: no results"));
                return debug.concat(realStreams);
            }

            // Find best match
            var q = normalize(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var score = 0;

                if (t === q) score = 100;
                else if (t.indexOf(q) !== -1) score = 70;
                else if (q.indexOf(t) !== -1) score = 50;

                if (!r.isMovie) score += 35;
                if (r.isMovie) score -= 50;

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            if (!best) best = results[0];
            debug.push(makeDebugStream("BEST: " + best.title + " (" + bestScore + ")"));

            // Load anime page to get anime ID
            return fetch(best.url, { headers: getHeaders() })
                .then(function(r) { return r.ok ? r.text() : null; })
                .then(function(html) {
                    if (!html) {
                        debug.push(makeDebugStream("ANIME PAGE: empty"));
                        return debug.concat(realStreams);
                    }

                    var $ = cheerio.load(html);
                    var animeId = $("[data-id]").first().attr("data-id");
                    if (!animeId) {
                        var m = html.match(/data-id=["'](\d+)["']/);
                        animeId = m ? m[1] : null;
                    }

                    if (!animeId) {
                        debug.push(makeDebugStream("ANIME ID: NOT FOUND"));
                        return debug.concat(realStreams);
                    }

                    debug.push(makeDebugStream("ANIME ID: " + animeId));

                    // Get episodes list
                    var epUrl = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
                    return fetch(epUrl, { headers: getAjaxHeaders(best.url) })
                        .then(function(r) { return r.ok ? r.text() : null; })
                        .then(function(jsonText) {
                            if (!jsonText) {
                                debug.push(makeDebugStream("EP LIST: empty"));
                                return debug.concat(realStreams);
                            }

                            var data = JSON.parse(jsonText);
                            if (!data || data.status !== 200 || !data.result) {
                                debug.push(makeDebugStream("EP LIST: bad JSON"));
                                return debug.concat(realStreams);
                            }

                            var $ep = cheerio.load(data.result);
                            var episodes = [];

                            $ep("a[data-ids]").each(function(i, el) {
                                var $el = $ep(el);
                                var ids = $el.attr("data-ids");
                                var num = parseInt($el.attr("data-num") || "0", 10);
                                var hasSub = $el.attr("data-sub") === "1";
                                var hasDub = $el.attr("data-dub") === "1";

                                if (!ids) return;
                                if (hasSub) episodes.push({ number: num, type: "sub", ids: ids, referer: best.url });
                                if (hasDub) episodes.push({ number: num, type: "dub", ids: ids, referer: best.url });
                            });

                            debug.push(makeDebugStream("EPISODES FOUND: " + episodes.length));
                            
                            // Log first few episodes for debugging
                            if (episodes.length > 0) {
                                var sample = episodes.slice(0, 5).map(function(e) { return e.number; });
                                debug.push(makeDebugStream("Sample episodes: " + sample.join(", ") + "..."));
                            }

                            // Try multiple strategies to find the right episode
                            var targets = [];

                            // Strategy 1: Try absolute episode number
                            if (absoluteEpisode) {
                                var found = episodes.filter(function(e) { return e.number === absoluteEpisode; });
                                if (found.length > 0) {
                                    debug.push(makeDebugStream("Found by absolute episode: " + absoluteEpisode));
                                    targets = found;
                                }
                            }

                            // Strategy 2: Try raw episode number (if different from absolute)
                            if (targets.length === 0 && absoluteEpisode !== originalEpisode) {
                                var found = episodes.filter(function(e) { return e.number === originalEpisode; });
                                if (found.length > 0) {
                                    debug.push(makeDebugStream("Found by raw episode: " + originalEpisode));
                                    targets = found;
                                }
                            }

                            // Strategy 3: Try to find the episode by season range
                            if (targets.length === 0) {
                                debug.push(makeDebugStream("Trying season range matching..."));
                                
                                // Get all unique episode numbers
                                var allNumbers = episodes.map(function(e) { return e.number; }).sort(function(a, b) { return a - b; });
                                
                                if (allNumbers.length > 0) {
                                    // Calculate estimated episode per season
                                    var totalEpisodes = allNumbers.length;
                                    var estimatedPerSeason = Math.ceil(totalEpisodes / 10); // Rough estimate
                                    
                                    // Find episodes in the range for this season
                                    var seasonStart = (seasonNum - 1) * estimatedPerSeason;
                                    var seasonEnd = seasonNum * estimatedPerSeason;
                                    
                                    // But also try to find the exact episode number in the list
                                    // Anikoto often has gaps or different numbering
                                    
                                    // Try to find the closest match within 5 episodes
                                    var bestMatch = null;
                                    var bestDiff = Infinity;
                                    
                                    episodes.forEach(function(e) {
                                        var target = absoluteEpisode || originalEpisode;
                                        var diff = Math.abs(e.number - target);
                                        if (diff < bestDiff) {
                                            bestDiff = diff;
                                            bestMatch = e;
                                        }
                                    });
                                    
                                    if (bestMatch && bestDiff <= 10) {
                                        debug.push(makeDebugStream("Closest match: episode " + bestMatch.number + " (diff: " + bestDiff + ")"));
                                        targets = [bestMatch];
                                    }
                                }
                            }

                            // Strategy 4: If we have episodes but no match, try to find the first episode of this season
                            if (targets.length === 0 && episodes.length > 0) {
                                debug.push(makeDebugStream("No match found, trying season start..."));
                                
                                // For season 1, use episode 1
                                if (seasonNum === 1) {
                                    var found = episodes.filter(function(e) { return e.number === 1; });
                                    if (found.length > 0) {
                                        debug.push(makeDebugStream("Using episode 1 for season 1"));
                                        targets = found;
                                    }
                                } else {
                                    // For other seasons, try to find where the season might start
                                    // Many anime on Anikoto have sequential numbering
                                    var allNums = episodes.map(function(e) { return e.number; }).sort(function(a, b) { return a - b; });
                                    
                                    // Try to find the episode closest to (seasonNum - 1) * episodesPerSeason
                                    var totalEp = allNums[allNums.length - 1] || 100;
                                    var epsPerSeason = Math.ceil(totalEp / 10); // Rough estimate
                                    var targetEp = (seasonNum - 1) * epsPerSeason + 1;
                                    
                                    var found = episodes.filter(function(e) { 
                                        return e.number >= targetEp - 5 && e.number <= targetEp + 5; 
                                    });
                                    
                                    if (found.length > 0) {
                                        debug.push(makeDebugStream("Found episode near season start: " + found[0].number));
                                        targets = [found[0]];
                                    }
                                }
                            }

                            debug.push(makeDebugStream("TARGETS: " + (targets.length ? targets.map(function(t){return "ep" + t.number + ":" + t.type;}).join(", ") : "NONE")));

                            if (targets.length === 0) {
                                debug.push(makeDebugStream("No matching episodes found"));
                                return debug.concat(realStreams);
                            }

                            // Process all targets (SUB + DUB)
                            var chain = Promise.resolve();

                            targets.forEach(function(ep) {
                                chain = chain.then(function() {
                                    return resolveOne(ep, debug).then(function(link) {
                                        if (link) {
                                            realStreams.push({
                                                name: "AnikotoTV",
                                                title: (link.quality || "1080p") + " " + ep.type.toUpperCase(),
                                                url: link.url,
                                                quality: link.quality || "1080p",
                                                headers: link.headers || {}
                                            });
                                        }
                                    });
                                });
                            });

                            return chain.then(function() {
                                debug.push(makeDebugStream("DONE: " + realStreams.length + " streams"));
                                return debug.concat(realStreams);
                            });
                        });
                });
        });
}

function resolveOne(ep, debug) {
    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + ep.ids;

    return fetch(listUrl, { headers: getAjaxHeaders(ep.referer) })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(listJson) {
            if (!listJson) {
                debug.push(makeDebugStream(ep.type.toUpperCase() + ": no list"));
                return null;
            }

            var listData = JSON.parse(listJson);
            if (!listData || !listData.result) {
                debug.push(makeDebugStream(ep.type.toUpperCase() + ": bad list"));
                return null;
            }

            var $s = cheerio.load(listData.result);
            var selector = ep.type === "dub"
                ? 'div.type[data-type="dub"] li[data-link-id]'
                : 'div.type[data-type="sub"] li[data-link-id]';

            var linkId = null;
            $s(selector).each(function(i, el) {
                if (!linkId) linkId = $s(el).attr("data-link-id");
            });

            if (!linkId) {
                $s("li[data-link-id]").each(function(i, el) {
                    if (!linkId) linkId = $s(el).attr("data-link-id");
                });
            }

            if (!linkId) {
                debug.push(makeDebugStream(ep.type.toUpperCase() + ": no linkId"));
                return null;
            }

            debug.push(makeDebugStream(ep.type.toUpperCase() + ": linkId OK"));

            var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + linkId;
            return fetch(serverUrl, { headers: getAjaxHeaders(ep.referer) })
                .then(function(r) { return r.ok ? r.text() : null; });
        })
        .then(function(sJson) {
            if (!sJson) return null;

            var sData = JSON.parse(sJson);
            var embed = null;
            if (sData && sData.result) {
                embed = typeof sData.result === "string" ? sData.result : sData.result.url;
            }

            if (!embed || embed.indexOf("megaplay") === -1) {
                debug.push(makeDebugStream(ep.type.toUpperCase() + ": no embed"));
                return null;
            }

            debug.push(makeDebugStream(ep.type.toUpperCase() + ": embed OK"));

            if (embed.indexOf("autostart") === -1) {
                embed += (embed.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
            }

            return fetch(embed, {
                headers: getHeaders({
                    "Referer": CONFIG.BASE_URL,
                    "Origin": CONFIG.BASE_URL
                })
            }).then(function(r) { return r.ok ? r.text() : null; })
            .then(function(html) {
                if (!html) {
                    debug.push(makeDebugStream(ep.type.toUpperCase() + ": megaplay empty"));
                    return null;
                }

                var m = html.match(/data-id=["'](\d+)["']/);
                if (!m) {
                    debug.push(makeDebugStream(ep.type.toUpperCase() + ": no data-id"));
                    return null;
                }

                var sourcesUrl = "https://megaplay.buzz/stream/getSources?id=" + m[1];

                return fetch(sourcesUrl, {
                    headers: {
                        "User-Agent": CONFIG.USER_AGENT,
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": embed,
                        "Accept": "application/json"
                    }
                }).then(function(r) { return r.ok ? r.json() : null; })
                .then(function(sources) {
                    if (!sources || !sources.sources) {
                        debug.push(makeDebugStream(ep.type.toUpperCase() + ": sources fail"));
                        return null;
                    }

                    var videoUrl = sources.sources.file || (sources.sources[0] && sources.sources[0].file);
                    if (!videoUrl) {
                        debug.push(makeDebugStream(ep.type.toUpperCase() + ": no file"));
                        return null;
                    }

                    debug.push(makeDebugStream(ep.type.toUpperCase() + ": SUCCESS"));

                    return {
                        url: videoUrl,
                        quality: "1080p",
                        headers: {
                            "Referer": "https://megaplay.buzz/",
                            "Origin": "https://megaplay.buzz"
                        }
                    };
                });
            });
        })
        .catch(function(err) {
            debug.push(makeDebugStream(ep.type.toUpperCase() + ": ERR " + (err.message || "")));
            return null;
        });
}

module.exports = { getStreams };