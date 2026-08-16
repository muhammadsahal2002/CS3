/**
 * AnikotoTV Provider for Nuvio
 * Final version - SUB + DUB + better matching
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
    if (extra) {
        for (var k in extra) h[k] = extra[k];
    }
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

function normalize(str) {
    return (str || "").toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ==================== SEARCH ====================
function searchAnime(query) {
    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(query);

    return fetch(url, { headers: getHeaders() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return [];

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
                var isMovie = /movie|film|special|ova/i.test(title) || /\/movie/i.test(fullUrl);

                results.push({
                    title: title,
                    url: fullUrl,
                    isMovie: isMovie,
                    score: 0
                });
            });

            return results;
        })
        .catch(function() { return []; });
}

function pickBestMatch(results, searchTitle) {
    if (!results || results.length === 0) return null;

    var q = normalize(searchTitle);

    // Score each result
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var t = normalize(r.title);
        var score = 0;

        if (t === q) score += 100;
        else if (t.indexOf(q) !== -1) score += 60;
        else if (q.indexOf(t) !== -1) score += 40;

        // Prefer series over movies
        if (!r.isMovie) score += 25;
        if (r.isMovie) score -= 30;

        // Prefer shorter titles (usually the main series)
        score -= Math.min(t.length / 10, 15);

        r.score = score;
    }

    results.sort(function(a, b) { return b.score - a.score; });
    return results[0];
}

// ==================== EPISODES ====================
function getEpisodes(animeId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";

    return fetch(url, { headers: getAjaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(jsonText) {
            if (!jsonText) return [];

            var data = JSON.parse(jsonText);
            if (!data || data.status !== 200 || !data.result) return [];

            var $ = cheerio.load(data.result);
            var episodes = [];

            $("a[data-ids]").each(function(i, el) {
                var $el = $(el);
                var ids = $el.attr("data-ids");
                var num = parseInt($el.attr("data-num") || "0", 10);
                var hasSub = $el.attr("data-sub") === "1";
                var hasDub = $el.attr("data-dub") === "1";
                var name = $el.closest("li").attr("title") || ("Episode " + num);

                if (!ids) return;

                if (hasSub) {
                    episodes.push({ number: num, type: "sub", ids: ids, name: name, referer: referer });
                }
                if (hasDub) {
                    episodes.push({ number: num, type: "dub", ids: ids, name: name + " (Dub)", referer: referer });
                }
            });

            return episodes;
        })
        .catch(function() { return []; });
}

// ==================== ONE STREAM ====================
function getOneStream(ep) {
    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + ep.ids;

    return fetch(listUrl, { headers: getAjaxHeaders(ep.referer) })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(jsonText) {
            if (!jsonText) return null;

            var data = JSON.parse(jsonText);
            if (!data || data.status !== 200 || !data.result) return null;

            var $ = cheerio.load(data.result);
            var selector = ep.type === "dub"
                ? 'div.type[data-type="dub"] li[data-link-id]'
                : 'div.type[data-type="sub"] li[data-link-id], div.type[data-type="hsub"] li[data-link-id]';

            var linkId = null;
            $(selector).each(function(i, el) {
                if (!linkId) linkId = $(el).attr("data-link-id");
            });

            // fallback
            if (!linkId) {
                $("li[data-link-id]").each(function(i, el) {
                    if (!linkId) linkId = $(el).attr("data-link-id");
                });
            }

            if (!linkId) return null;

            var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + linkId;
            return fetch(serverUrl, { headers: getAjaxHeaders(ep.referer) })
                .then(function(r) { return r.ok ? r.text() : null; });
        })
        .then(function(jsonText) {
            if (!jsonText) return null;

            var data = JSON.parse(jsonText);
            var embedUrl = null;

            if (data && data.status === 200 && data.result) {
                embedUrl = typeof data.result === "string" ? data.result : data.result.url;
            }

            if (!embedUrl || embedUrl.indexOf("megaplay") === -1) return null;

            return extractMegaPlay(embedUrl);
        })
        .catch(function() { return null; });
}

// ==================== MEGAPLAY ====================
function extractMegaPlay(embedUrl) {
    if (embedUrl.indexOf("autostart=true") === -1) {
        embedUrl += (embedUrl.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
    }

    return fetch(embedUrl, {
        headers: getHeaders({
            "Referer": CONFIG.BASE_URL,
            "Origin": CONFIG.BASE_URL
        })
    })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(html) {
        if (!html) return null;

        var match = html.match(/data-id=["'](\d+)["']/);
        if (!match) return null;

        var sourcesUrl = "https://megaplay.buzz/stream/getSources?id=" + match[1];

        return fetch(sourcesUrl, {
            headers: {
                "User-Agent": CONFIG.USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": embedUrl,
                "Accept": "application/json"
            }
        }).then(function(r) { return r.ok ? r.json() : null; });
    })
    .then(function(sources) {
        if (!sources || !sources.sources) return null;

        var videoUrl = null;
        if (sources.sources.file) {
            videoUrl = sources.sources.file;
        } else if (Array.isArray(sources.sources) && sources.sources[0]) {
            videoUrl = sources.sources[0].file;
        }

        if (!videoUrl) return null;

        return {
            url: videoUrl,
            quality: "1080p",
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        };
    })
    .catch(function() { return null; });
}

// ==================== LOAD ANIME ====================
function loadAnime(watchUrl) {
    return fetch(watchUrl, { headers: getHeaders() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;

            var $ = cheerio.load(html);
            var title = $("h1.title, h1[itemprop=name], h1").first().text().trim();
            if (!title) return null;

            var animeId = $("[data-id]").first().attr("data-id");
            if (!animeId) {
                var m = html.match(/data-id=["'](\d+)["']/);
                animeId = m ? m[1] : null;
            }
            if (!animeId) return null;

            return getEpisodes(animeId, watchUrl).then(function(episodes) {
                return {
                    title: title,
                    animeId: animeId,
                    url: watchUrl,
                    episodes: episodes
                };
            });
        })
        .catch(function() { return null; });
}

// ==================== MAIN ====================
function getStreams(tmdbId, mediaType, season, episode) {
    var epNum = episode || 1;
    var searchTitle = String(tmdbId);

    // Get title from TMDB
    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
                  "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(tmdbUrl)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (data) {
                searchTitle = mediaType === "tv" ? (data.name || searchTitle) : (data.title || searchTitle);
            }
            return searchAnime(searchTitle);
        })
        .catch(function() {
            return searchAnime(searchTitle);
        })
        .then(function(results) {
            if (!results || results.length === 0) return [];

            var best = pickBestMatch(results, searchTitle);
            if (!best) return [];

            return loadAnime(best.url);
        })
        .then(function(anime) {
            if (!anime || !anime.episodes || anime.episodes.length === 0) return [];

            var targets = anime.episodes.filter(function(e) {
                return e.number === epNum;
            });

            if (targets.length === 0) return [];

            // Get SUB and DUB one by one (more stable)
            var streams = [];
            var chain = Promise.resolve();

            targets.forEach(function(ep) {
                chain = chain.then(function() {
                    return getOneStream(ep).then(function(link) {
                        if (link) {
                            streams.push({
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
                return streams;
            });
        })
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };