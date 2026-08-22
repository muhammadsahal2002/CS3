/**
 * AnikotoTV Provider for Nuvio
 * DUB only – Clean version based on working debug approach
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
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) h[k] = extra[k];
    return h;
}

function ajaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL,
        "Cookie": "country_code=BD; prefered_server_type=dub"
    };
}

function getTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            return mediaType === "tv" ? (data.name || data.original_name) : (data.title || data.original_title);
        })
        .catch(function() { return null; });
}

// Search: use filter page (returns all results), take first result
function searchAnime(title) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);

    console.log("[AnikotoTV] Searching: " + searchTitle);

    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;

            var $ = cheerio.load(html);
            var firstResult = null;

            // Take the first item with a title and URL
            $("div.item").each(function(i, el) {
                if (firstResult) return;
                var $el = $(el);
                var a = $el.find("a.name.d-title, a[data-jp]").first();
                if (!a.length) return;
                var href = a.attr("href");
                var t = (a.attr("data-jp") || a.text() || "").trim();
                if (href && t) {
                    firstResult = {
                        title: t,
                        url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href
                    };
                }
            });

            console.log("[AnikotoTV] Found: " + (firstResult ? firstResult.title : "nothing"));
            return firstResult;
        })
        .catch(function(err) {
            console.log("[AnikotoTV] Search error: " + err.message);
            return null;
        });
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

    console.log("[AnikotoTV] Fetching episodes for anime ID: " + animeId + ", episode: " + episodeNum);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.status !== 200 || !data.result) return null;

            var $ = cheerio.load(data.result);
            var found = null;

            // Try exact DUB match first
            $("a[data-ids]").each(function(i, el) {
                if (found) return;
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                if (num === episodeNum && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

            // If not found, try any DUB episode close to the number
            if (!found) {
                var closest = null;
                var closestDiff = Infinity;
                $("a[data-ids]").each(function(i, el) {
                    var a = $(el);
                    if (a.attr("data-dub") === "1" && a.attr("data-ids")) {
                        var num = parseInt(a.attr("data-num") || "0", 10);
                        var diff = Math.abs(num - episodeNum);
                        if (diff < closestDiff) {
                            closestDiff = diff;
                            closest = { ids: a.attr("data-ids"), number: num };
                        }
                    }
                });
                if (closest && closestDiff <= 5) {
                    console.log("[AnikotoTV] Using nearby DUB episode " + closest.number + " (requested: " + episodeNum + ")");
                    found = closest;
                }
            }

            // If still nothing, try any DUB episode at all
            if (!found) {
                $("a[data-ids]").each(function(i, el) {
                    if (found) return;
                    var a = $(el);
                    if (a.attr("data-dub") === "1" && a.attr("data-ids")) {
                        var num = parseInt(a.attr("data-num") || "0", 10);
                        console.log("[AnikotoTV] Using first available DUB episode: " + num);
                        found = { ids: a.attr("data-ids"), number: num };
                    }
                });
            }

            return found;
        })
        .catch(function(err) {
            console.log("[AnikotoTV] Episode fetch error: " + err.message);
            return null;
        });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);

    console.log("[AnikotoTV] Getting servers for IDs: " + ids);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            var linkId = $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id");
            if (!linkId) linkId = $('li[data-link-id]').first().attr("data-link-id");
            console.log("[AnikotoTV] Server link ID: " + linkId);
            return linkId || null;
        })
        .catch(function() { return null; });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);

    console.log("[AnikotoTV] Getting embed for link ID: " + linkId);

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

    console.log("[AnikotoTV] ========================================");
    console.log("[AnikotoTV] TMDB: " + tmdbId + ", Type: " + mediaType + ", S" + season + "E" + episode);

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) {
                console.log("[AnikotoTV] No title found");
                return [];
            }
            console.log("[AnikotoTV] Title: " + title);

            return searchAnime(title).then(function(best) {
                if (!best) {
                    console.log("[AnikotoTV] No match found");
                    return [];
                }

                console.log("[AnikotoTV] Using: " + best.title + " (URL: " + best.url + ")");

                return getAnimeId(best.url).then(function(animeId) {
                    if (!animeId) {
                        console.log("[AnikotoTV] Could not get anime ID");
                        return [];
                    }
                    console.log("[AnikotoTV] Anime ID: " + animeId);

                    // For movies, try to get stream directly using animeId
                    if (mediaType === "movie") {
                        return getDubServer(animeId, best.url)
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
                                console.log("[AnikotoTV] ✅ Movie stream found!");
                                return [{
                                    name: "AnikotoTV",
                                    title: "1080p",
                                    url: stream.url,
                                    quality: "1080p",
                                    headers: stream.headers
                                }];
                            });
                    }

                    // TV series: get episode
                    return getDubEpisode(animeId, episode, best.url)
                        .then(function(ep) {
                            if (!ep) {
                                console.log("[AnikotoTV] No DUB episode " + episode);
                                return [];
                            }

                            console.log("[AnikotoTV] Found episode: " + ep.number);

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
                                    console.log("[AnikotoTV] ✅ Stream found!");
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
        .catch(function(err) {
            console.log("[AnikotoTV] Error: " + err.message);
            return [];
        });
}

module.exports = { getStreams };