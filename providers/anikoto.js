/**
 * AnikotoTV - Fixed with title-based episode matching
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

function calculateAbsoluteEpisode(episodeNumbers, seasonNum, episodeNum) {
    if (seasonNum === 1) {
        return episodeNum;
    }
    
    if (episodeNumbers && episodeNumbers.length > 0) {
        var seasonStarts = [1];
        for (var i = 1; i < episodeNumbers.length; i++) {
            if (episodeNumbers[i] - episodeNumbers[i-1] > 1) {
                seasonStarts.push(episodeNumbers[i]);
            }
        }
        
        if (seasonStarts.length >= seasonNum) {
            return seasonStarts[seasonNum - 1] + episodeNum - 1;
        }
        
        var totalEp = episodeNumbers[episodeNumbers.length - 1];
        var estimatedSeasons = Math.ceil(totalEp / 12);
        var epsPerSeason = Math.ceil(totalEp / estimatedSeasons);
        return (seasonNum - 1) * epsPerSeason + episodeNum;
    }
    
    return episodeNum;
}

function getStreams(tmdbId, mediaType, season, episode) {
    var debug = [];
    var realStreams = [];
    var epNum = episode || 1;
    var seasonNum = season || 1;

    debug.push(makeDebugStream("START: " + tmdbId + " " + mediaType + " S" + seasonNum + "E" + epNum));

    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            var searchTitle = String(tmdbId);
            if (data) {
                searchTitle = mediaType === "tv" ? (data.name || searchTitle) : (data.title || searchTitle);
                debug.push(makeDebugStream("TMDB OK: " + searchTitle));
            } else {
                debug.push(makeDebugStream("TMDB FAILED"));
            }

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

                            debug.push(makeDebugStream("ANIME ID: " + (animeId || "NOT FOUND")));
                            if (!animeId) return debug.concat(realStreams);

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
                                    var episodeNumbers = [];

                                    $ep("a[data-ids]").each(function(i, el) {
                                        var $el = $ep(el);
                                        var ids = $el.attr("data-ids");
                                        var num = parseInt($el.attr("data-num") || "0", 10);
                                        var hasSub = $el.attr("data-sub") === "1";
                                        var hasDub = $el.attr("data-dub") === "1";
                                        var title = $el.closest("li").attr("title") || "";

                                        if (!ids) return;
                                        
                                        if (episodeNumbers.indexOf(num) === -1) {
                                            episodeNumbers.push(num);
                                        }
                                        
                                        if (hasSub) {
                                            episodes.push({ 
                                                number: num, 
                                                type: "sub", 
                                                ids: ids, 
                                                referer: best.url,
                                                title: title
                                            });
                                        }
                                        if (hasDub) {
                                            episodes.push({ 
                                                number: num, 
                                                type: "dub", 
                                                ids: ids, 
                                                referer: best.url,
                                                title: title
                                            });
                                        }
                                    });

                                    episodeNumbers.sort(function(a, b) { return a - b; });
                                    debug.push(makeDebugStream("EPISODES: " + episodes.length));

                                    var targets = [];
                                    var tmdbTitle = null;

                                    // Get TMDB episode title - ONLY for TV shows
                                    if (mediaType === "tv") {
                                        var tmdbEpisodeUrl = CONFIG.TMDB_BASE + "/tv/" + tmdbId + "/season/" + seasonNum + "/episode/" + epNum + "?api_key=" + CONFIG.TMDB_API_KEY;
                                        
                                        return fetch(tmdbEpisodeUrl)
                                            .then(function(r) { return r.ok ? r.json() : null; })
                                            .then(function(epData) {
                                                if (epData && epData.name) {
                                                    tmdbTitle = normalize(epData.name);
                                                    debug.push(makeDebugStream("TMDB Title: " + tmdbTitle));
                                                }
                                                return findAndProcessEpisodes(episodes, episodeNumbers, tmdbTitle, seasonNum, epNum, debug, realStreams);
                                            })
                                            .catch(function() {
                                                return findAndProcessEpisodes(episodes, episodeNumbers, null, seasonNum, epNum, debug, realStreams);
                                            });
                                    } else {
                                        // Movies - just use episode number
                                        return findAndProcessEpisodes(episodes, episodeNumbers, null, seasonNum, epNum, debug, realStreams);
                                    }
                                });
                        });
                });
        })
        .catch(function(err) {
            debug.push(makeDebugStream("FATAL: " + (err.message || "unknown")));
            return debug.concat(realStreams);
        });
}

function findAndProcessEpisodes(episodes, episodeNumbers, tmdbTitle, seasonNum, epNum, debug, realStreams) {
    var targets = [];

    // STRATEGY 1: Match by TITLE (most accurate)
    if (tmdbTitle) {
        var matched = episodes.filter(function(e) {
            var epTitle = normalize(e.title);
            return epTitle === tmdbTitle || 
                   epTitle.indexOf(tmdbTitle) !== -1 || 
                   tmdbTitle.indexOf(epTitle) !== -1;
        });
        
        if (matched.length > 0) {
            debug.push(makeDebugStream("Found by TITLE: ep" + matched[0].number));
            targets = matched;
        }
    }

    // STRATEGY 2: Try absolute episode number
    if (targets.length === 0) {
        var absoluteEp = calculateAbsoluteEpisode(episodeNumbers, seasonNum, epNum);
        debug.push(makeDebugStream("ABSOLUTE EP: " + absoluteEp));
        
        var matched = episodes.filter(function(e) { 
            return e.number === absoluteEp; 
        });
        if (matched.length > 0) {
            debug.push(makeDebugStream("Found by ABSOLUTE: " + absoluteEp));
            targets = matched;
        }
    }

    // STRATEGY 3: Try raw episode number
    if (targets.length === 0) {
        debug.push(makeDebugStream("Trying raw episode: " + epNum));
        var matched = episodes.filter(function(e) { 
            return e.number === epNum; 
        });
        if (matched.length > 0) {
            debug.push(makeDebugStream("Found by RAW: " + epNum));
            targets = matched;
        }
    }

    // STRATEGY 4: Closest match
    if (targets.length === 0 && episodes.length > 0) {
        var target = epNum;
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
            debug.push(makeDebugStream("Using closest: ep" + bestMatch.number + " (diff: " + bestDiff + ")"));
            targets = [bestMatch];
        }
    }

    debug.push(makeDebugStream("TARGETS: " + (targets.length ? targets.map(function(t){
        return "ep" + t.number + ":" + t.type + (t.title ? " '" + t.title.substring(0, 25) + "'" : "");
    }).join(", ") : "NONE")));

    if (targets.length === 0) {
        debug.push(makeDebugStream("No matching episodes found"));
        return Promise.resolve(debug.concat(realStreams));
    }

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