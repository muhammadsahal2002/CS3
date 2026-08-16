/**
 * AnikotoTV - Debug + Real streams
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

function makeDebug(msg) {
    return {
        name: "DEBUG: " + msg,
        title: msg,
        url: "https://test.com/debug",
        quality: "DEBUG",
        headers: {}
    };
}

function normalize(str) {
    return (str || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function getStreams(tmdbId, mediaType, season, episode) {
    var debug = [];
    var epNum = episode || 1;
    var realStreams = [];

    debug.push(makeDebug("START: " + tmdbId + " " + mediaType + " S" + season + "E" + epNum));

    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
                  "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            var searchTitle = String(tmdbId);
            if (data) {
                searchTitle = mediaType === "tv" ? (data.name || searchTitle) : (data.title || searchTitle);
                debug.push(makeDebug("TMDB: " + searchTitle));
            } else {
                debug.push(makeDebug("TMDB FAILED"));
            }

            var searchUrl = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);
            return fetch(searchUrl, { headers: getHeaders() })
                .then(function(r) { return r.ok ? r.text() : null; })
                .then(function(html) {
                    if (!html) {
                        debug.push(makeDebug("SEARCH: empty"));
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

                    debug.push(makeDebug("SEARCH: " + results.length + " results"));

                    if (results.length === 0) return debug.concat(realStreams);

                    // Better matching
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

                        if (!r.isMovie) score += 30;
                        if (r.isMovie) score -= 40;

                        if (score > bestScore) {
                            bestScore = score;
                            best = r;
                        }
                    }

                    if (!best) best = results[0];

                    debug.push(makeDebug("BEST: " + best.title + " (score " + bestScore + ")"));

                    // Load anime
                    return fetch(best.url, { headers: getHeaders() })
                        .then(function(r) { return r.ok ? r.text() : null; })
                        .then(function(html) {
                            if (!html) {
                                debug.push(makeDebug("PAGE: empty"));
                                return debug.concat(realStreams);
                            }

                            var $ = cheerio.load(html);
                            var animeId = $("[data-id]").first().attr("data-id");
                            if (!animeId) {
                                var m = html.match(/data-id=["'](\d+)["']/);
                                animeId = m ? m[1] : null;
                            }

                            debug.push(makeDebug("ANIME ID: " + (animeId || "NONE")));

                            if (!animeId) return debug.concat(realStreams);

                            // Episodes
                            var epUrl = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
                            return fetch(epUrl, { headers: getAjaxHeaders(best.url) })
                                .then(function(r) { return r.ok ? r.text() : null; })
                                .then(function(jsonText) {
                                    if (!jsonText) {
                                        debug.push(makeDebug("EP LIST: empty"));
                                        return debug.concat(realStreams);
                                    }

                                    var data = JSON.parse(jsonText);
                                    if (!data || data.status !== 200 || !data.result) {
                                        debug.push(makeDebug("EP LIST: bad"));
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

                                    debug.push(makeDebug("EPISODES: " + episodes.length));

                                    var targets = episodes.filter(function(e) { return e.number === epNum; });
                                    debug.push(makeDebug("TARGETS: " + (targets.length ? targets.map(function(t){return t.type;}).join(",") : "NONE")));

                                    if (targets.length === 0) {
                                        return debug.concat(realStreams);
                                    }

                                    // Process targets one by one
                                    var chain = Promise.resolve();

                                    targets.forEach(function(ep) {
                                        chain = chain.then(function() {
                                            return getOneStream(ep, debug).then(function(link) {
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
                                        debug.push(makeDebug("DONE: " + realStreams.length + " real streams"));
                                        return debug.concat(realStreams);
                                    });
                                });
                        });
                });
        })
        .catch(function(err) {
            debug.push(makeDebug("FATAL: " + (err.message || "error")));
            return debug.concat(realStreams);
        });
}

function getOneStream(ep, debug) {
    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + ep.ids;

    return fetch(listUrl, { headers: getAjaxHeaders(ep.referer) })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(jsonText) {
            if (!jsonText) {
                debug.push(makeDebug(ep.type.toUpperCase() + ": no server list"));
                return null;
            }

            var data = JSON.parse(jsonText);
            if (!data || !data.result) {
                debug.push(makeDebug(ep.type.toUpperCase() + ": bad server list"));
                return null;
            }

            var $ = cheerio.load(data.result);
            var selector = ep.type === "dub"
                ? 'div.type[data-type="dub"] li[data-link-id]'
                : 'div.type[data-type="sub"] li[data-link-id]';

            var linkId = null;
            $(selector).each(function(i, el) {
                if (!linkId) linkId = $(el).attr("data-link-id");
            });

            if (!linkId) {
                $("li[data-link-id]").each(function(i, el) {
                    if (!linkId) linkId = $(el).attr("data-link-id");
                });
            }

            if (!linkId) {
                debug.push(makeDebug(ep.type.toUpperCase() + ": no linkId"));
                return null;
            }

            debug.push(makeDebug(ep.type.toUpperCase() + ": linkId OK"));

            var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + linkId;
            return fetch(serverUrl, { headers: getAjaxHeaders(ep.referer) })
                .then(function(r) { return r.ok ? r.text() : null; });
        })
        .then(function(jsonText) {
            if (!jsonText) return null;

            var data = JSON.parse(jsonText);
            var embed = null;
            if (data && data.result) {
                embed = typeof data.result === "string" ? data.result : data.result.url;
            }

            if (!embed || embed.indexOf("megaplay") === -1) {
                debug.push(makeDebug(ep.type.toUpperCase() + ": no embed"));
                return null;
            }

            debug.push(makeDebug(ep.type.toUpperCase() + ": embed OK"));

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
                    debug.push(makeDebug(ep.type.toUpperCase() + ": megaplay empty"));
                    return null;
                }

                var m = html.match(/data-id=["'](\d+)["']/);
                if (!m) {
                    debug.push(makeDebug(ep.type.toUpperCase() + ": no data-id"));
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
                        debug.push(makeDebug(ep.type.toUpperCase() + ": sources fail"));
                        return null;
                    }

                    var videoUrl = sources.sources.file || (sources.sources[0] && sources.sources[0].file);
                    if (!videoUrl) {
                        debug.push(makeDebug(ep.type.toUpperCase() + ": no file"));
                        return null;
                    }

                    debug.push(makeDebug(ep.type.toUpperCase() + ": SUCCESS"));

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
            debug.push(makeDebug(ep.type.toUpperCase() + ": ERR " + (err.message || "")));
            return null;
        });
}

module.exports = { getStreams };