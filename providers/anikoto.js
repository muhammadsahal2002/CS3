/**
 * AnikotoTV Provider
 * DUB only
 * Matches episodes by title (solves season mismatch)
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

function normalizeTitle(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/&[^;]+;/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function findEpisodeByTitle(targetTitle, episodes) {
    var targetWords = normalizeTitle(targetTitle)
        .split(" ")
        .filter(function(w) { return w.length >= 3; });

    if (targetWords.length === 0) return null;

    var targetSet = {};
    for (var i = 0; i < targetWords.length; i++) {
        targetSet[targetWords[i]] = true;
    }

    var bestMatch = null;
    var bestScore = 0;
    var bestMatches = 0;

    for (var i = 0; i < episodes.length; i++) {
        var ep = episodes[i];
        var episodeWords = normalizeTitle(ep.title)
            .split(" ")
            .filter(function(w) { return w.length >= 3; });

        var matches = 0;
        for (var j = 0; j < episodeWords.length; j++) {
            if (targetSet[episodeWords[j]]) matches++;
        }

        var score = matches / Math.max(targetWords.length, episodeWords.length);

        if (score > bestScore || (score === bestScore && matches > bestMatches)) {
            bestScore = score;
            bestMatches = matches;
            bestMatch = ep;
        }
    }

    if (bestMatch && (bestMatches >= 2 || bestScore >= 0.75)) {
        return bestMatch;
    }

    return null;
}

function tmdb(path) {
    var url = CONFIG.TMDB_BASE + path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url).then(function(r) { return r.ok ? r.json() : null; });
}

function searchAnime(title) {
    var searchTitle = title
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

            var q = normalizeTitle(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalizeTitle(r.title);
                var score = 0;

                if (t === q) score = 300;
                else if (t.indexOf(q) !== -1) score = 150;
                else if (q.indexOf(t) !== -1) score = 40;

                var queryHasShippuden = q.indexOf("shippuden") !== -1 || q.indexOf("shippuuden") !== -1;
                var titleHasShippuden = t.indexOf("shippuden") !== -1 || t.indexOf("shippuuden") !== -1;

                if (queryHasShippuden) {
                    if (titleHasShippuden) score += 200;
                    else score -= 150;
                }

                if (!r.isMovie) score += 40;
                if (r.isMovie) score -= 60;

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

function getAllEpisodes(animeId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return [];

            var $ = cheerio.load(data.result);
            var episodes = [];

            $("a[data-ids]").each(function(i, el) {
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                var ids = a.attr("data-ids");
                var hasDub = a.attr("data-dub") === "1";
                var title = a.closest("li").attr("title") || ("Episode " + num);

                if (ids && hasDub) {
                    episodes.push({
                        number: num,
                        title: title,
                        ids: ids
                    });
                }
            });

            return episodes;
        })
        .catch(function() { return []; });
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

    // 1. Get episode title from TMDB
    return tmdb("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode)
        .then(function(epData) {
            var episodeTitle = epData && epData.name ? epData.name : null;

            // Also get series title
            return tmdb("/tv/" + tmdbId).then(function(showData) {
                var seriesTitle = showData ? (showData.name || showData.original_name) : null;
                return {
                    seriesTitle: seriesTitle,
                    episodeTitle: episodeTitle
                };
            });
        })
        .then(function(info) {
            if (!info.seriesTitle) return [];

            // 2. Search Anikoto
            return searchAnime(info.seriesTitle).then(function(best) {
                if (!best) return [];

                return getAnimeId(best.url).then(function(animeId) {
                    if (!animeId) return [];

                    // 3. Get all DUB episodes from Anikoto
                    return getAllEpisodes(animeId, best.url).then(function(episodes) {
                        if (!episodes || episodes.length === 0) return [];

                        var matched = null;

                        // 4. Try to match by title
                        if (info.episodeTitle) {
                            matched = findEpisodeByTitle(info.episodeTitle, episodes);
                        }

                        // Fallback: use episode number if title matching fails
                        if (!matched) {
                            for (var i = 0; i < episodes.length; i++) {
                                if (episodes[i].number === episode) {
                                    matched = episodes[i];
                                    break;
                                }
                            }
                        }

                        if (!matched) return [];

                        // 5. Resolve stream
                        return getDubServer(matched.ids, best.url)
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
        })
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };