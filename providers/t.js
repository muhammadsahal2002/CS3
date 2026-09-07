/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Uses idmapper.vercel.app (IMDb id -> per-season TMDB episode ranges)
 * to convert TMDB season/episode into the site's absolute episode number
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    ID_MAPPER_API: "https://idmapper.vercel.app/api/mapper",
    OMDB_BASE: "https://www.omdbapi.com/",
    OMDB_API_KEY: "8d6935ed",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function log(msg) {
    console.log("[AnikotoTV] " + msg);
}

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

function getImdbId(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "/external_ids?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) {
            if (!r.ok) log("getImdbId: TMDB external_ids HTTP " + r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            var id = data && data.imdb_id ? data.imdb_id : null;
            log("getImdbId: " + (id || "not found in TMDB external_ids"));
            return id;
        })
        .catch(function(e) {
            log("getImdbId: error - " + e.message);
            return null;
        });
}

function getTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) {
            if (!r.ok) log("getTitle: TMDB details HTTP " + r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data) return null;
            var t = mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
            log("getTitle: \"" + t + "\"");
            return t;
        })
        .catch(function(e) {
            log("getTitle: error - " + e.message);
            return null;
        });
}

function getYear(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            var dateStr = mediaType === "tv" ? data.first_air_date : data.release_date;
            return dateStr ? dateStr.slice(0, 4) : null;
        })
        .catch(function() { return null; });
}

/**
 * Fallback IMDb id lookup via OMDb, used when TMDB's external_ids
 * doesn't have an imdb_id for this title.
 */
function getImdbIdFromOmdb(title, year) {
    var url = CONFIG.OMDB_BASE + "?apikey=" + CONFIG.OMDB_API_KEY +
        "&t=" + encodeURIComponent(title) +
        (year ? "&y=" + encodeURIComponent(year) : "");

    return fetch(url)
        .then(function(r) {
            if (!r.ok) log("getImdbIdFromOmdb: OMDb HTTP " + r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || data.Response === "False" || !data.imdbID) {
                log("getImdbIdFromOmdb: no match for \"" + title + "\"" +
                    (data && data.Error ? " (" + data.Error + ")" : ""));
                return null;
            }
            log("getImdbIdFromOmdb: " + data.imdbID);
            return data.imdbID;
        })
        .catch(function(e) {
            log("getImdbIdFromOmdb: error - " + e.message);
            return null;
        });
}

/**
 * Resolves cross-site id mapping (including per-season TMDB episode
 * ranges) for an IMDb id via idmapper.vercel.app.
 */
function resolveIdMapping(imdbId) {
    if (!imdbId) return Promise.resolve(null);

    var url = CONFIG.ID_MAPPER_API + "?imdb_id=" + encodeURIComponent(imdbId);

    return fetch(url, { headers: { "User-Agent": CONFIG.USER_AGENT } })
        .then(function(r) {
            if (!r.ok) log("resolveIdMapping: idmapper HTTP " + r.status + " for " + imdbId);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || data.error) {
                log("resolveIdMapping: no mapping found for " + imdbId +
                    (data && data.error ? " (" + data.error + ")" : ""));
                return null;
            }
            log("resolveIdMapping: mal_id=" + JSON.stringify(data.mal_id) +
                " tmdb_mappings=" + JSON.stringify(data.tmdb_mappings));
            return data;
        })
        .catch(function(e) {
            log("resolveIdMapping: error - " + e.message);
            return null;
        });
}

/**
 * idmapper's tmdb_mappings gives each TMDB season's absolute episode
 * range within the combined series numbering, e.g. "s2":"e33-e53".
 * Converts a TMDB season/episode into that absolute episode number,
 * which is the numbering the source site uses.
 */
function computeAbsoluteEpisode(mapping, season, episode) {
    if (!mapping || !mapping.tmdb_mappings) return episode;

    var range = mapping.tmdb_mappings["s" + season];
    if (!range) return episode;

    var m = /^e(\d+)-e(\d+)$/i.exec(range);
    if (!m) {
        var single = /^e(\d+)$/i.exec(range);
        return single ? parseInt(single[1], 10) : episode;
    }

    var start = parseInt(m[1], 10);
    var end = parseInt(m[2], 10);
    var absolute = start + (episode - 1);

    return absolute > end ? end : absolute;
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
        .then(function(r) {
            if (!r.ok) log("searchAnime: HTTP " + r.status + " for query \"" + searchTitle + "\"");
            return r.ok ? r.text() : null;
        })
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

            if (results.length === 0) {
                log("searchAnime: 0 results parsed from page for \"" + searchTitle + "\"");
                return null;
            }

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

            var picked = best || results[0];
            log("searchAnime: matched \"" + picked.title + "\" -> " + picked.url +
                " (score=" + bestScore + ", " + results.length + " candidates)");
            return picked;
        })
        .catch(function(e) {
            log("searchAnime: error - " + e.message);
            return null;
        });
}

function getAnimeId(url) {
    return fetch(url, { headers: headers() })
        .then(function(r) {
            if (!r.ok) log("getAnimeId: HTTP " + r.status + " for " + url);
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) return null;
            var $ = cheerio.load(html);
            var id = $("[data-id]").first().attr("data-id");
            if (!id) {
                var m = html.match(/data-id=["'](\d+)["']/);
                id = m ? m[1] : null;
            }
            log("getAnimeId: " + (id || "not found on page"));
            return id;
        })
        .catch(function(e) {
            log("getAnimeId: error - " + e.message);
            return null;
        });
}

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            if (!r.ok) log("getDubEpisode: HTTP " + r.status + " for animeId " + animeId);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result) {
                log("getDubEpisode: empty ajax result for animeId " + animeId);
                return null;
            }

            var $ = cheerio.load(data.result);
            var found = null;
            var dubNums = [];

            $("a[data-ids]").each(function(i, el) {
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                var isDub = a.attr("data-dub") === "1";
                if (isDub) dubNums.push(num);
                if (!found && num === episodeNum && isDub && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

            if (!found) {
                log("getDubEpisode: episode " + episodeNum + " not found in DUB list. Available DUB episodes: [" +
                    dubNums.join(",") + "]");
            } else {
                log("getDubEpisode: found episode " + episodeNum + " (ids=" + found.ids + ")");
            }

            return found;
        })
        .catch(function(e) {
            log("getDubEpisode: error - " + e.message);
            return null;
        });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            if (!r.ok) log("getDubServer: HTTP " + r.status + " for ids " + ids);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result) {
                log("getDubServer: empty ajax result for ids " + ids);
                return null;
            }
            var $ = cheerio.load(data.result);
            var linkId = $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id") || null;
            log("getDubServer: " + (linkId || "no dub server link found"));
            return linkId;
        })
        .catch(function(e) {
            log("getDubServer: error - " + e.message);
            return null;
        });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            if (!r.ok) log("getEmbed: HTTP " + r.status + " for linkId " + linkId);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            var embed = null;
            if (data && data.result) {
                if (typeof data.result === "string") embed = data.result;
                else if (data.result.url) embed = data.result.url;
            }
            log("getEmbed: " + (embed || "no embed url in ajax result"));
            return embed;
        })
        .catch(function(e) {
            log("getEmbed: error - " + e.message);
            return null;
        });
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
    .then(function(r) {
        if (!r.ok) log("resolveMegaplay: HTTP " + r.status + " fetching embed page");
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html) return null;

        var m = html.match(/data-id=["'](\d+)["']/);
        if (!m) {
            log("resolveMegaplay: no data-id found on embed page. First 300 chars: " + html.slice(0, 300));
            return null;
        }

        log("resolveMegaplay: extracted id=" + m[1] + " from embed page (embed url id was " +
            (embed.match(/\/(\d+)\//) ? embed.match(/\/(\d+)\//)[1] : "n/a") + ")");

        return fetch("https://megaplay.buzz/stream/getSources?id=" + m[1], {
            headers: {
                "User-Agent": CONFIG.USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Referer": embed,
                "Accept": "application/json"
            }
        }).then(function(r) {
            if (!r.ok) log("resolveMegaplay: getSources HTTP " + r.status);
            return r.ok ? r.text() : null;
        }).then(function(rawText) {
            if (!rawText) return null;
            log("resolveMegaplay: getSources raw response: " + rawText.slice(0, 500));
            try {
                return JSON.parse(rawText);
            } catch (e) {
                log("resolveMegaplay: getSources response is not valid JSON - " + e.message);
                return null;
            }
        });
    })
    .then(function(data) {
        if (!data || !data.sources) {
            log("resolveMegaplay: no sources in getSources response");
            return null;
        }

        var file = data.sources.file || (data.sources[0] && data.sources[0].file);
        if (!file) {
            log("resolveMegaplay: sources present but no file url - " + JSON.stringify(data.sources));
            return null;
        }

        log("resolveMegaplay: got stream url");

        return {
            url: file,
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        };
    })
    .catch(function(e) {
        log("resolveMegaplay: error - " + e.message);
        return null;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    log("getStreams: tmdbId=" + tmdbId + " mediaType=" + mediaType + " season=" + season + " episode=" + episode);

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) return [];

            return getImdbId(tmdbId, mediaType).then(function(imdbId) {
                var imdbIdPromise = imdbId
                    ? Promise.resolve(imdbId)
                    : getYear(tmdbId, mediaType).then(function(year) {
                        return getImdbIdFromOmdb(title, year);
                    });

                return imdbIdPromise.then(function(finalImdbId) {
                    var mappingPromise = finalImdbId
                        ? resolveIdMapping(finalImdbId)
                        : Promise.resolve(null);

                    return mappingPromise.then(function(mapping) {
                        var mappedEpisode = computeAbsoluteEpisode(mapping, season, episode);
                        log("getStreams: mappedEpisode=" + mappedEpisode + " (requested s" + season + "e" + episode + ")");

                        return searchAnime(title).then(function(best) {
                            if (!best) return [];

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) return [];

                                return getDubEpisode(animeId, mappedEpisode, best.url).then(function(ep) {
                                    if (!ep) return [];

                                    return getDubServer(ep.ids, best.url)
                                        .then(function(linkId) {
                                            if (!linkId) return [];
                                            return getEmbed(linkId, best.url);
                                        })
                                        .then(function(embed) {
                                            if (!embed || embed.indexOf("megaplay") === -1) {
                                                log("getStreams: embed is not a megaplay url, skipping - " + embed);
                                                return [];
                                            }
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
                    });
                });
            });
        })
        .catch(function(e) {
            log("getStreams: unhandled error - " + e.message);
            return [];
        });
}

module.exports = { getStreams };