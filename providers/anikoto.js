/**
 * AnikotoTV - Debug version
 * Returns error messages as streams so you can see them in Nuvio
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
        name: "AnikotoTV-DEBUG",
        title: msg,
        url: "https://test.com/error",
        quality: "DEBUG",
        headers: {}
    };
}

function getStreams(tmdbId, mediaType, season, episode) {
    var debug = [];
    var epNum = episode || 1;

    debug.push(makeDebugStream("START: " + tmdbId + " " + mediaType + " S" + season + "E" + epNum));

    // Step 1: TMDB
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

            // Step 2: Search
            var searchUrl = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);
            return fetch(searchUrl, { headers: getHeaders() })
                .then(function(r) { return r.ok ? r.text() : null; })
                .then(function(html) {
                    if (!html) {
                        debug.push(makeDebugStream("SEARCH: empty HTML"));
                        return debug;
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
                        results.push({
                            title: title,
                            url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href
                        });
                    });

                    debug.push(makeDebugStream("SEARCH: " + results.length + " results"));

                    if (results.length === 0) return debug;

                    var best = results[0];
                    debug.push(makeDebugStream("BEST: " + best.title));

                    // Step 3: Load anime page
                    return fetch(best.url, { headers: getHeaders() })
                        .then(function(r) { return r.ok ? r.text() : null; })
                        .then(function(html) {
                            if (!html) {
                                debug.push(makeDebugStream("ANIME PAGE: empty"));
                                return debug;
                            }

                            var $ = cheerio.load(html);
                            var animeId = $("[data-id]").first().attr("data-id");
                            if (!animeId) {
                                var m = html.match(/data-id=["'](\d+)["']/);
                                animeId = m ? m[1] : null;
                            }

                            debug.push(makeDebugStream("ANIME ID: " + (animeId || "NOT FOUND")));

                            if (!animeId) return debug;

                            // Step 4: Episodes
                            var epUrl = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
                            return fetch(epUrl, { headers: getAjaxHeaders(best.url) })
                                .then(function(r) { return r.ok ? r.text() : null; })
                                .then(function(jsonText) {
                                    if (!jsonText) {
                                        debug.push(makeDebugStream("EP LIST: empty"));
                                        return debug;
                                    }

                                    var data = JSON.parse(jsonText);
                                    if (!data || data.status !== 200 || !data.result) {
                                        debug.push(makeDebugStream("EP LIST: bad JSON"));
                                        return debug;
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
                                        if (hasSub) episodes.push({ number: num, type: "sub", ids: ids });
                                        if (hasDub) episodes.push({ number: num, type: "dub", ids: ids });
                                    });

                                    debug.push(makeDebugStream("EPISODES: " + episodes.length));

                                    var targets = episodes.filter(function(e) { return e.number === epNum; });
                                    if (targets.length === 0) {
                                        debug.push(makeDebugStream("NO EP " + epNum));
                                        return debug;
                                    }

                                    debug.push(makeDebugStream("TARGETS: " + targets.map(function(t){return t.type;}).join(",")));

                                    // Step 5: Try first target only
                                    var ep = targets[0];
                                    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + ep.ids;

                                    return fetch(listUrl, { headers: getAjaxHeaders(best.url) })
                                        .then(function(r) { return r.ok ? r.text() : null; })
                                        .then(function(listJson) {
                                            if (!listJson) {
                                                debug.push(makeDebugStream("SERVER LIST: empty"));
                                                return debug;
                                            }

                                            var listData = JSON.parse(listJson);
                                            if (!listData || !listData.result) {
                                                debug.push(makeDebugStream("SERVER LIST: bad"));
                                                return debug;
                                            }

                                            var $s = cheerio.load(listData.result);
                                            var selector = ep.type === "dub"
                                                ? 'div.type[data-type="dub"] li[data-link-id]'
                                                : 'div.type[data-type="sub"] li[data-link-id]';

                                            var linkId = null;
                                            $s(selector).each(function(i, el) {
                                                if (!linkId) linkId = $s(el).attr("data-link-id");
                                            });

                                            debug.push(makeDebugStream("LINK ID: " + (linkId ? "FOUND" : "NOT FOUND")));

                                            if (!linkId) return debug;

                                            var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + linkId;
                                            return fetch(serverUrl, { headers: getAjaxHeaders(best.url) })
                                                .then(function(r) { return r.ok ? r.text() : null; })
                                                .then(function(sJson) {
                                                    if (!sJson) {
                                                        debug.push(makeDebugStream("SERVER: empty"));
                                                        return debug;
                                                    }

                                                    var sData = JSON.parse(sJson);
                                                    var embed = null;
                                                    if (sData && sData.result) {
                                                        embed = typeof sData.result === "string" ? sData.result : sData.result.url;
                                                    }

                                                    debug.push(makeDebugStream("EMBED: " + (embed ? embed.substring(0, 40) + "..." : "NONE")));

                                                    if (!embed || embed.indexOf("megaplay") === -1) return debug;

                                                    // Final step - MegaPlay
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
                                                            debug.push(makeDebugStream("MEGAPLAY: empty page"));
                                                            return debug;
                                                        }

                                                        var m = html.match(/data-id=["'](\d+)["']/);
                                                        if (!m) {
                                                            debug.push(makeDebugStream("MEGAPLAY: no data-id"));
                                                            return debug;
                                                        }

                                                        debug.push(makeDebugStream("DATA-ID: " + m[1]));

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
                                                                debug.push(makeDebugStream("SOURCES: failed"));
                                                                return debug;
                                                            }

                                                            var videoUrl = sources.sources.file || (sources.sources[0] && sources.sources[0].file);
                                                            if (!videoUrl) {
                                                                debug.push(makeDebugStream("SOURCES: no file"));
                                                                return debug;
                                                            }

                                                            // SUCCESS
                                                            debug.push({
                                                                name: "AnikotoTV",
                                                                title: "1080p " + ep.type.toUpperCase(),
                                                                url: videoUrl,
                                                                quality: "1080p",
                                                                headers: {
                                                                    "Referer": "https://megaplay.buzz/",
                                                                    "Origin": "https://megaplay.buzz"
                                                                }
                                                            });

                                                            return debug;
                                                        });
                                                    });
                                                });
                                        });
                                });
                        });
                });
        })
        .catch(function(err) {
            debug.push(makeDebugStream("FATAL: " + (err.message || "unknown")));
            return debug;
        });
}

module.exports = { getStreams };