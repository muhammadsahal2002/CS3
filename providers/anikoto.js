/**
 * AnikotoTV - Simple DUB only
 * Uses TMDB id + season + episode
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };
    if (extra) for (var k in extra) h[k] = extra[k];
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

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
                  "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return [];

            var title = mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);

            if (!title) return [];

            // Clean title for search
            var searchTitle = title
                .replace(/ū/g, "uu")
                .replace(/ō/g, "ou")
                .replace(/ā/g, "aa")
                .replace(/ī/g, "ii")
                .replace(/ē/g, "ee");

            var searchUrl = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);

            return fetch(searchUrl, { headers: headers() })
                .then(function(r) { return r.ok ? r.text() : null; })
                .then(function(html) {
                    if (!html) return [];

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

                    if (results.length === 0) return [];

                    // Simple best match
                    var q = normalize(searchTitle);
                    var best = null;
                    var bestScore = -999;

                    for (var i = 0; i < results.length; i++) {
                        var r = results[i];
                        var t = normalize(r.title);
                        var score = 0;

                        if (t === q) score = 300;
                        else if (t.indexOf(q) !== -1) score = 150;
                        else if (q.indexOf(t) !== -1) score = 40;

                        if (q.indexOf("shippuden") !== -1 || q.indexOf("shippuuden") !== -1) {
                            if (t.indexOf("shippuden") !== -1 || t.indexOf("shippuuden") !== -1) score += 200;
                            else score -= 150;
                        }

                        if (!r.isMovie) score += 40;
                        if (r.isMovie) score -= 60;

                        if (score > bestScore) {
                            bestScore = score;
                            best = r;
                        }
                    }

                    if (!best) best = results[0];

                    // Get anime ID
                    return fetch(best.url, { headers: headers() })
                        .then(function(r) { return r.ok ? r.text() : null; })
                        .then(function(pageHtml) {
                            if (!pageHtml) return [];

                            var $p = cheerio.load(pageHtml);
                            var animeId = $p("[data-id]").first().attr("data-id");
                            if (!animeId) {
                                var m = pageHtml.match(/data-id=["'](\d+)["']/);
                                animeId = m ? m[1] : null;
                            }
                            if (!animeId) return [];

                            // Get episode list
                            var epUrl = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
                            return fetch(epUrl, { headers: ajaxHeaders(best.url) })
                                .then(function(r) { return r.ok ? r.json() : null; })
                                .then(function(epData) {
                                    if (!epData || !epData.result) return [];

                                    var $ep = cheerio.load(epData.result);
                                    var found = null;

                                    // Use episode number directly
                                    $ep("a[data-ids]").each(function(i, el) {
                                        if (found) return;
                                        var a = $ep(el);
                                        var num = parseInt(a.attr("data-num") || "0", 10);
                                        if (num === episode && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                                            found = { ids: a.attr("data-ids") };
                                        }
                                    });

                                    if (!found) return [];

                                    // Get DUB server
                                    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(found.ids);
                                    return fetch(listUrl, { headers: ajaxHeaders(best.url) })
                                        .then(function(r) { return r.ok ? r.json() : null; })
                                        .then(function(listData) {
                                            if (!listData || !listData.result) return [];

                                            var $s = cheerio.load(listData.result);
                                            var linkId = $s('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id");
                                            if (!linkId) return [];

                                            // Get embed
                                            var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);
                                            return fetch(serverUrl, { headers: ajaxHeaders(best.url) })
                                                .then(function(r) { return r.ok ? r.json() : null; })
                                                .then(function(sData) {
                                                    var embed = null;
                                                    if (sData && sData.result) {
                                                        embed = typeof sData.result === "string" ? sData.result : sData.result.url;
                                                    }
                                                    if (!embed || embed.indexOf("megaplay") === -1) return [];

                                                    if (embed.indexOf("autostart") === -1) {
                                                        embed += (embed.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
                                                    }

                                                    // MegaPlay
                                                    return fetch(embed, {
                                                        headers: headers({
                                                            "Referer": CONFIG.BASE_URL,
                                                            "Origin": CONFIG.BASE_URL
                                                        })
                                                    }).then(function(r) { return r.ok ? r.text() : null; })
                                                    .then(function(html) {
                                                        if (!html) return [];
                                                        var m = html.match(/data-id=["'](\d+)["']/);
                                                        if (!m) return [];

                                                        return fetch("https://megaplay.buzz/stream/getSources?id=" + m[1], {
                                                            headers: {
                                                                "User-Agent": CONFIG.USER_AGENT,
                                                                "X-Requested-With": "XMLHttpRequest",
                                                                "Referer": embed,
                                                                "Accept": "application/json"
                                                            }
                                                        }).then(function(r) { return r.ok ? r.json() : null; })
                                                        .then(function(sources) {
                                                            if (!sources || !sources.sources) return [];
                                                            var file = sources.sources.file || (sources.sources[0] && sources.sources[0].file);
                                                            if (!file) return [];

                                                            return [{
                                                                name: "AnikotoTV",
                                                                title: "1080p DUB",
                                                                url: file,
                                                                quality: "1080p",
                                                                headers: {
                                                                    "Referer": "https://megaplay.buzz/",
                                                                    "Origin": "https://megaplay.buzz"
                                                                }
                                                            }];
                                                        });
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