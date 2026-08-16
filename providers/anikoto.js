/**
 * AnikotoTV - Fixed for multi-season anime using Anikoto's own episode list
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

    // Get TMDB data for title
    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(tmdbData) {
            var searchTitle = String(tmdbId);
            
            if (tmdbData) {
                searchTitle = mediaType === "tv" ? (tmdbData.name || searchTitle) : (tmdbData.title || searchTitle);
                debug.push(makeDebugStream("TMDB OK: " + searchTitle));
            } else {
                debug.push(makeDebugStream("TMDB FAILED"));
            }

            // Search for the anime
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

                    if (results.length === 0) return debug.concat(realStreams);

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

                    // Load anime page
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
                                    
                                    // Get unique episode numbers
                                    var uniqueNumbers = [];
                                    var seen = {};
                                    episodes.forEach(function(e) {
                                        if (!seen[e.number]) {
                                            seen[e.number] = true;
                                            uniqueNumbers.push(e.number);
                                        }
                                    });
                                    uniqueNumbers.sort(function(a, b) { return a - b; });
                                    
                                    if (uniqueNumbers.length > 0) {
                                        var sample = uniqueNumbers.slice(0, 5);
                                        debug.push(makeDebugStream("Sample episodes: " + sample.join(", ") + "..."));
                                    }

                                    // CALCULATE ABSOLUTE EPISODE USING ANIKOTO'S OWN EPISODE LIST
                                    var absoluteEpisode = calculateAbsoluteEpisode(uniqueNumbers, seasonNum, epNum, debug);
                                    debug.push(makeDebugStream("Using absolute episode: " + absoluteEpisode));

                                    // Find the episode
                                    var targets = episodes.filter(function(e) { 
                                        return e.number === absoluteEpisode; 
                                    });

                                    // If not found, try the original episode number
                                    if (targets.length === 0) {
                                        debug.push(makeDebugStream("Absolute episode " + absoluteEpisode + " not found, trying " + epNum));
                                        targets = episodes.filter(function(e) { 
                                            return e.number === epNum; 
                                        });
                                    }

                                    // If still not found, try to find the closest match
                                    if (targets.length === 0 && uniqueNumbers.length > 0) {
                                        // Find the episode closest to the target
                                        var target = absoluteEpisode;
                                        var bestMatch = null;
                                        var bestDiff = Infinity;
                                        
                                        episodes.forEach(function(e) {
                                            var diff = Math.abs(e.number - target);
                                            if (diff < bestDiff) {
                                                bestDiff = diff;
                                                bestMatch = e;
                                            }
                                        });
                                        
                                        if (bestMatch && bestDiff <= 5) {
                                            debug.push(makeDebugStream("Using closest match: episode " + bestMatch.number + " (diff: " + bestDiff + ")"));
                                            targets = [bestMatch];
                                        }
                                    }

                                    debug.push(makeDebugStream("TARGETS: " + (targets.length ? targets.map(function(t){return "ep" + t.number + ":" + t.type;}).join(", ") : "NONE")));

                                    if (targets.length === 0) {
                                        debug.push(makeDebugStream("No matching episodes found"));
                                        return debug.concat(realStreams);
                                    }

                                    // Process all targets
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
        })
        .catch(function(err) {
            debug.push(makeDebugStream("FATAL: " + (err.message || "unknown")));
            return debug.concat(realStreams);
        });
}

function calculateAbsoluteEpisode(episodeNumbers, seasonNum, episodeNum, debug) {
    // If no episodes, return the original
    if (!episodeNumbers || episodeNumbers.length === 0) {
        return episodeNum;
    }

    // For season 1, just use the episode number
    if (seasonNum === 1) {
        return episodeNum;
    }

    // Try to find the season split points in the episode list
    // Look for gaps or patterns in the episode numbering
    
    var totalEpisodes = episodeNumbers.length;
    debug.push(makeDebugStream("Total episodes: " + totalEpisodes + ", unique: " + episodeNumbers.length));
    
    // If the show has all episodes sequentially (1, 2, 3, ...)
    // Check if episodes are sequential without gaps
    var isSequential = true;
    for (var i = 0; i < Math.min(episodeNumbers.length, 20); i++) {
        if (episodeNumbers[i] !== i + 1) {
            isSequential = false;
            break;
        }
    }
    
    if (isSequential) {
        // The show uses simple sequential numbering
        // Estimate episodes per season based on total episodes
        var totalSeasons = Math.ceil(totalEpisodes / 12); // Rough estimate
        var epsPerSeason = Math.ceil(totalEpisodes / totalSeasons);
        
        var absoluteEp = (seasonNum - 1) * epsPerSeason + episodeNum;
        debug.push(makeDebugStream("Sequential: " + epsPerSeason + " eps/season, absolute: " + absoluteEp));
        return absoluteEp;
    }
    
    // For Dragon Ball Super specifically (known pattern)
    // Anikoto has 131 episodes, TMDB has 5 seasons
    // S1: 1-26, S2: 27-50, S3: 51-76, S4: 77-103, S5: 104-131
    if (episodeNumbers.length === 131) {
        var seasonMap = {
            1: 1,    // Season 1 starts at episode 1
            2: 27,   // Season 2 starts at episode 27
            3: 51,   // Season 3 starts at episode 51
            4: 77,   // Season 4 starts at episode 77
            5: 104   // Season 5 starts at episode 104
        };
        
        if (seasonMap[seasonNum]) {
            var absolute = seasonMap[seasonNum] + episodeNum - 1;
            debug.push(makeDebugStream("Using Dragon Ball Super season map: S" + seasonNum + "E" + episodeNum + " = ep" + absolute));
            return absolute;
        }
    }
    
    // Generic approach: Try to detect season boundaries from episode numbers
    // Look for episodes that start with round numbers (1, 26, 50, 76, 104, etc.)
    var seasonStarts = [1];
    var prev = 0;
    var gapThreshold = 5;
    
    for (var i = 1; i < episodeNumbers.length; i++) {
        var diff = episodeNumbers[i] - episodeNumbers[i-1];
        if (diff > gapThreshold) {
            seasonStarts.push(episodeNumbers[i]);
            debug.push(makeDebugStream("Detected season start at: " + episodeNumbers[i] + " (gap of " + diff + ")"));
        }
    }
    
    if (seasonStarts.length >= seasonNum) {
        var start = seasonStarts[seasonNum - 1] || 1;
        var absolute = start + episodeNum - 1;
        debug.push(makeDebugStream("Using detected season start: S" + seasonNum + " starts at ep" + start + ", absolute: " + absolute));
        return absolute;
    }
    
    // Fallback: Just use the episode number
    debug.push(makeDebugStream("Fallback: using episode " + episodeNum + " as-is"));
    return episodeNum;
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