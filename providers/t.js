/**
 * AnikotoTV Provider for Nuvio
 * DUB only - Returns megaplay embed URL for WebView playback
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    MAPPING_API: "https://idmapper.vercel.app/api/mapper",
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

function resolveMapping(imdbId, season, episode) {
    var url = CONFIG.MAPPING_API + "?imdb_id=" + encodeURIComponent(imdbId);

    return fetch(url, {
        headers: {
            "User-Agent": CONFIG.USER_AGENT,
            "Accept": "application/json"
        }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
        if (!data || !data.tmdb_mappings) return null;
        
        var seasonKey = "s" + season;
        var mapping = data.tmdb_mappings[seasonKey];
        
        if (mapping) {
            var parts = mapping.split('-');
            if (parts.length === 2) {
                var startEp = parseInt(parts[0].replace('e', ''), 10);
                var endEp = parseInt(parts[1].replace('e', ''), 10);
                
                if (episode >= 1 && episode <= (endEp - startEp + 1)) {
                    return { mal_episode: startEp + episode - 1 };
                }
            }
        }
        return null;
    })
    .catch(function() { return null; });
}

function searchAnime(title) {
    var searchTitle = String(title || "")
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

            var q = normalize(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var score = 0;

                if (t === q) score = 100;
                else if (t.indexOf(q) !== -1) score = 70;
                else if (q.indexOf(t) !== -1) score = 40;

                if (!r.isMovie) score += 20;
                if (r.isMovie) score -= 30;

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

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;

            var $ = cheerio.load(data.result);
            var found = null;

            $("a[data-ids]").each(function(i, el) {
                if (found) return;
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                // Look for DUB episode with matching number
                if (num === episodeNum && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

            return found;
        })
        .catch(function() { return null; });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            // Find the first DUB server link ID
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

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    console.log("AnikotoTV: Getting streams for", tmdbId, mediaType, season, episode);

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) {
                console.log("AnikotoTV: No title found");
                return [];
            }
            console.log("AnikotoTV: Title:", title);

            return getImdbId(tmdbId, mediaType)
                .then(function(imdbId) {
                    console.log("AnikotoTV: IMDB ID:", imdbId);
                    var mappedEpisode = episode;

                    var mappingPromise = imdbId ? resolveMapping(imdbId, season, episode) : Promise.resolve(null);

                    return mappingPromise.then(function(mapping) {
                        if (mapping && mapping.mal_episode) {
                            mappedEpisode = mapping.mal_episode;
                            console.log("AnikotoTV: Mapped episode:", episode, "->", mappedEpisode);
                        }

                        return searchAnime(title).then(function(best) {
                            if (!best) {
                                console.log("AnikotoTV: No search results");
                                return [];
                            }
                            console.log("AnikotoTV: Found anime:", best.title, "at", best.url);

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) {
                                    console.log("AnikotoTV: No anime ID");
                                    return [];
                                }
                                console.log("AnikotoTV: Anime ID:", animeId);

                                return getDubEpisode(animeId, mappedEpisode, best.url)
                                    .then(function(ep) {
                                        if (!ep) {
                                            console.log("AnikotoTV: No DUB episode found for", mappedEpisode);
                                            return [];
                                        }
                                        console.log("AnikotoTV: Found DUB episode:", ep.number);

                                        return getDubServer(ep.ids, best.url)
                                            .then(function(linkId) {
                                                if (!linkId) {
                                                    console.log("AnikotoTV: No DUB server");
                                                    return [];
                                                }
                                                console.log("AnikotoTV: Found DUB server link ID");

                                                return getEmbed(linkId, best.url)
                                                    .then(function(embed) {
                                                        if (!embed) {
                                                            console.log("AnikotoTV: No embed");
                                                            return [];
                                                        }
                                                        console.log("AnikotoTV: Found embed:", embed);

                                                        // Return the megaplay URL directly for WebView
                                                        // The WebView will load the page and JW Player handles decryption
                                                        return [{
                                                            name: "AnikotoTV",
                                                            title: "1080p DUB",
                                                            url: embed,  // Return the megaplay page URL
                                                            quality: "1080p",
                                                            headers: {
                                                                "Referer": CONFIG.BASE_URL,
                                                                "Origin": CONFIG.BASE_URL
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
        .catch(function(err) {
            console.log("AnikotoTV error:", err.message);
            return [];
        });
}

module.exports = { getStreams };