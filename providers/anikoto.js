/**
 * Anikoto episode mapper
 *
 * Purpose:
 *   TMDB SxEy -> Anikoto absolute episode
 *
 * Example:
 *   TMDB S5E54 -> Anikoto #130
 *
 * It does NOT assume:
 *   Anikoto number === TMDB episode number
 *
 * It:
 *   1. Gets every TMDB season
 *   2. Gets Anikoto's complete flat episode list
 *   3. Creates an SxEy -> Anikoto mapping
 *   4. Caches the mapping in memory
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_BASE: "https://api.themoviedb.org/3",

    // Put your own TMDB key here.
    TMDB_API_KEY: "YOUR_TMDB_API_KEY",

    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36",

    // Mapping cache lifetime.
    CACHE_TTL: 6 * 60 * 60 * 1000
};

/*
 * ---------------------------------------------------------
 * CACHE
 * ---------------------------------------------------------
 */

var CACHE = {};

/*
 * ---------------------------------------------------------
 * HEADERS
 * ---------------------------------------------------------
 */

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    if (extra) {
        for (var k in extra) {
            h[k] = extra[k];
        }
    }

    return h;
}

function ajaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept":
            "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL
    };
}

/*
 * ---------------------------------------------------------
 * NORMALIZATION
 * ---------------------------------------------------------
 */

function normalizeTitle(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/&[^;]+;/g, " ")
        .replace(/[āáàä]/g, "a")
        .replace(/[ēéèë]/g, "e")
        .replace(/[īíìï]/g, "i")
        .replace(/[ōóòö]/g, "o")
        .replace(/[ūúùü]/g, "u")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getWords(title) {
    return normalizeTitle(title)
        .split(" ")
        .filter(function(w) {
            return w.length >= 3;
        });
}

/*
 * ---------------------------------------------------------
 * TITLE SIMILARITY
 * ---------------------------------------------------------
 *
 * Gives a score from 0 to 1.
 */

function titleSimilarity(a, b) {
    var na = normalizeTitle(a);
    var nb = normalizeTitle(b);

    if (!na || !nb) return 0;

    if (na === nb) return 1;

    var wa = getWords(a);
    var wb = getWords(b);

    if (!wa.length || !wb.length) return 0;

    var used = {};
    var matches = 0;

    for (var i = 0; i < wa.length; i++) {
        for (var j = 0; j < wb.length; j++) {

            if (used[j]) continue;

            if (
                wa[i] === wb[j] ||
                wa[i].indexOf(wb[j]) !== -1 ||
                wb[j].indexOf(wa[i]) !== -1
            ) {
                matches++;
                used[j] = true;
                break;
            }
        }
    }

    return matches / Math.max(wa.length, wb.length);
}

/*
 * ---------------------------------------------------------
 * TMDB REQUEST
 * ---------------------------------------------------------
 */

function tmdb(path) {
    var separator =
        path.indexOf("?") >= 0 ? "&" : "?";

    var url =
        CONFIG.TMDB_BASE +
        path +
        separator +
        "api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY);

    return fetch(url)
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .catch(function() {
            return null;
        });
}

/*
 * ---------------------------------------------------------
 * GET TMDB SHOW
 * ---------------------------------------------------------
 */

function getTmdbShow(tmdbId) {
    return tmdb("/tv/" + tmdbId);
}

/*
 * ---------------------------------------------------------
 * GET ALL TMDB SEASONS
 * ---------------------------------------------------------
 */

function getAllTmdbEpisodes(tmdbId) {

    return getTmdbShow(tmdbId)
        .then(function(show) {

            if (!show) return [];

            var totalSeasons =
                parseInt(show.number_of_seasons, 10) || 0;

            var requests = [];

            /*
             * Include season 0 because TMDB uses it
             * for specials.
             */
            for (var s = 0; s <= totalSeasons; s++) {

                requests.push(
                    tmdb(
                        "/tv/" +
                        tmdbId +
                        "/season/" +
                        s
                    )
                );
            }

            return Promise.all(requests)
                .then(function(seasons) {

                    var result = [];

                    for (var i = 0; i < seasons.length; i++) {

                        var season = seasons[i];

                        if (!season || !season.episodes) {
                            continue;
                        }

                        var seasonNumber =
                            parseInt(
                                season.season_number,
                                10
                            );

                        if (isNaN(seasonNumber)) {
                            continue;
                        }

                        for (
                            var j = 0;
                            j < season.episodes.length;
                            j++
                        ) {

                            var ep = season.episodes[j];

                            var episodeNumber =
                                parseInt(
                                    ep.episode_number,
                                    10
                                );

                            if (!episodeNumber) {
                                continue;
                            }

                            result.push({
                                key:
                                    "S" +
                                    seasonNumber +
                                    "E" +
                                    episodeNumber,

                                season:
                                    seasonNumber,

                                episode:
                                    episodeNumber,

                                title:
                                    ep.name || "",

                                airDate:
                                    ep.air_date || null
                            });
                        }
                    }

                    return result;
                });
        });
}

/*
 * ---------------------------------------------------------
 * ANIKOTO SEARCH
 * ---------------------------------------------------------
 */

function searchAnime(title) {

    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    var url =
        CONFIG.BASE_URL +
        "/filter?keyword=" +
        encodeURIComponent(searchTitle);

    return fetch(url, {
        headers: headers()
    })
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {

            if (!html) return null;

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {

                var item = $(el);

                var a = item
                    .find("a.name.d-title, a[data-jp]")
                    .first();

                if (!a.length) return;

                var href = a.attr("href");

                var itemTitle =
                    (
                        a.attr("data-jp") ||
                        a.text() ||
                        ""
                    ).trim();

                if (!href || !itemTitle) {
                    return;
                }

                results.push({
                    title: itemTitle,

                    url:
                        href.indexOf("http") === 0
                            ? href
                            : CONFIG.BASE_URL + href,

                    isMovie:
                        /movie|film|special|ova/i.test(
                            itemTitle
                        )
                });
            });

            if (!results.length) {
                return null;
            }

            var query =
                normalizeTitle(searchTitle);

            var best = null;
            var bestScore = -Infinity;

            for (
                var i = 0;
                i < results.length;
                i++
            ) {

                var r = results[i];

                var normalized =
                    normalizeTitle(r.title);

                var score = 0;

                if (normalized === query) {
                    score += 500;
                } else if (
                    normalized.indexOf(query) !== -1
                ) {
                    score += 300;
                } else if (
                    query.indexOf(normalized) !== -1
                ) {
                    score += 200;
                } else {
                    score +=
                        titleSimilarity(
                            searchTitle,
                            r.title
                        ) * 200;
                }

                /*
                 * Prefer TV/anime rather than movies.
                 */
                if (r.isMovie) {
                    score -= 100;
                } else {
                    score += 50;
                }

                /*
                 * Special handling for Shippuden.
                 */
                if (
                    query.indexOf("shippuden") !== -1 ||
                    query.indexOf("shippuuden") !== -1
                ) {

                    if (
                        normalized.indexOf("shippuden") !== -1 ||
                        normalized.indexOf("shippuuden") !== -1
                    ) {
                        score += 300;
                    } else {
                        score -= 300;
                    }
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            return best;
        })
        .catch(function() {
            return null;
        });
}

/*
 * ---------------------------------------------------------
 * GET ANIKOTO ID
 * ---------------------------------------------------------
 */

function getAnimeId(url) {

    return fetch(url, {
        headers: headers()
    })
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {

            if (!html) return null;

            var $ = cheerio.load(html);

            var id =
                $("[data-id]")
                    .first()
                    .attr("data-id");

            if (id) {
                return id;
            }

            var match =
                html.match(
                    /data-id=["'](\d+)["']/
                );

            return match ? match[1] : null;
        })
        .catch(function() {
            return null;
        });
}

/*
 * ---------------------------------------------------------
 * GET ALL ANIKOTO DUB EPISODES
 * ---------------------------------------------------------
 */

function getAllAnikotoEpisodes(
    animeId,
    referer
) {

    var url =
        CONFIG.BASE_URL +
        "/ajax/episode/list/" +
        animeId +
        "?vrf=";

    return fetch(url, {
        headers: ajaxHeaders(referer)
    })
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {

            if (!data || !data.result) {
                return [];
            }

            var $ = cheerio.load(
                data.result
            );

            var episodes = [];

            $("a[data-ids]").each(
                function(i, el) {

                    var a = $(el);

                    var number =
                        parseInt(
                            a.attr("data-num") ||
                            "0",
                            10
                        );

                    var ids =
                        a.attr("data-ids");

                    var dub =
                        a.attr("data-dub") === "1";

                    var title =
                        a.closest("li")
                            .attr("title") ||
                        ("Episode " + number);

                    if (
                        !number ||
                        !ids ||
                        !dub
                    ) {
                        return;
                    }

                    episodes.push({
                        number: number,
                        title: title,
                        ids: ids
                    });
                }
            );

            /*
             * Make sure absolute episode order
             * is predictable.
             */
            episodes.sort(function(a, b) {
                return a.number - b.number;
            });

            return episodes;
        })
        .catch(function() {
            return [];
        });
}

/*
 * ---------------------------------------------------------
 * MATCH ONE TMDB EPISODE
 * ---------------------------------------------------------
 */

function findBestMatch(
    tmdbEpisode,
    anikotoEpisodes,
    used
) {

    var best = null;
    var bestScore = 0;

    for (
        var i = 0;
        i < anikotoEpisodes.length;
        i++
    ) {

        var ani = anikotoEpisodes[i];

        if (used[ani.number]) {
            continue;
        }

        var similarity =
            titleSimilarity(
                tmdbEpisode.title,
                ani.title
            );

        var score =
            similarity * 100;

        /*
         * Exact normalized title.
         */
        if (
            normalizeTitle(
                tmdbEpisode.title
            ) ===
            normalizeTitle(
                ani.title
            )
        ) {
            score += 100;
        }

        /*
         * Strong bonus for one title containing
         * the other.
         */
        var a =
            normalizeTitle(
                tmdbEpisode.title
            );

        var b =
            normalizeTitle(
                ani.title
            );

        if (
            a.indexOf(b) !== -1 ||
            b.indexOf(a) !== -1
        ) {
            score += 25;
        }

        if (score > bestScore) {
            bestScore = score;
            best = ani;
        }
    }

    /*
     * Don't make dangerous guesses.
     */
    if (!best || bestScore < 45) {
        return null;
    }

    return {
        episode: best,
        score: bestScore
    };
}

/*
 * ---------------------------------------------------------
 * BUILD FULL MAPPING
 * ---------------------------------------------------------
 *
 * Result:
 *
 * {
 *   S1E1: {...},
 *   S1E2: {...},
 *   S2E1: {...},
 *   S5E54: {...}
 * }
 */

function buildMapping(
    tmdbEpisodes,
    anikotoEpisodes
) {

    var mapping = {};
    var used = {};

    /*
     * Process TMDB episodes in season/episode order.
     */
    tmdbEpisodes.sort(function(a, b) {

        if (a.season !== b.season) {
            return a.season - b.season;
        }

        return a.episode - b.episode;
    });

    for (
        var i = 0;
        i < tmdbEpisodes.length;
        i++
    ) {

        var tmdbEp =
            tmdbEpisodes[i];

        var match =
            findBestMatch(
                tmdbEp,
                anikotoEpisodes,
                used
            );

        if (!match) {
            continue;
        }

        mapping[tmdbEp.key] = {
            number:
                match.episode.number,

            title:
                match.episode.title,

            ids:
                match.episode.ids,

            score:
                Math.round(
                    match.score * 100
                ) / 100
        };

        used[
            match.episode.number
        ] = true;
    }

    return mapping;
}

/*
 * ---------------------------------------------------------
 * CACHE
 * ---------------------------------------------------------
 */

function getCachedMapping(tmdbId) {

    var key = String(tmdbId);

    var cached = CACHE[key];

    if (!cached) {
        return null;
    }

    if (
        Date.now() - cached.time >
        CONFIG.CACHE_TTL
    ) {
        delete CACHE[key];
        return null;
    }

    return cached.mapping;
}

function setCachedMapping(
    tmdbId,
    mapping
) {

    CACHE[String(tmdbId)] = {
        time: Date.now(),
        mapping: mapping
    };
}

/*
 * ---------------------------------------------------------
 * BUILD MAPPING FOR A SHOW
 * ---------------------------------------------------------
 */

function createMapping(tmdbId) {

    var cached =
        getCachedMapping(tmdbId);

    if (cached) {
        return Promise.resolve(cached);
    }

    return Promise.all([
        getTmdbShow(tmdbId),
        getAllTmdbEpisodes(tmdbId)
    ])
        .then(function(results) {

            var show = results[0];
            var tmdbEpisodes = results[1];

            if (!show || !tmdbEpisodes.length) {
                return null;
            }

            var title =
                show.name ||
                show.original_name;

            if (!title) {
                return null;
            }

            return searchAnime(title)
                .then(function(anime) {

                    if (!anime) {
                        return null;
                    }

                    return getAnimeId(
                        anime.url
                    )
                        .then(function(animeId) {

                            if (!animeId) {
                                return null;
                            }

                            return getAllAnikotoEpisodes(
                                animeId,
                                anime.url
                            )
                                .then(function(
                                    anikotoEpisodes
                                ) {

                                    if (
                                        !anikotoEpisodes.length
                                    ) {
                                        return null;
                                    }

                                    var mapping =
                                        buildMapping(
                                            tmdbEpisodes,
                                            anikotoEpisodes
                                        );

                                    setCachedMapping(
                                        tmdbId,
                                        mapping
                                    );

                                    return mapping;
                                });
                        });
                });
        });
}

/*
 * ---------------------------------------------------------
 * PUBLIC RESOLVER
 * ---------------------------------------------------------
 *
 * This is what your provider can call.
 *
 * Example:
 *
 * resolveEpisode(
 *     "123456",
 *     5,
 *     54
 * )
 *
 * -> {
 *      number: 130,
 *      title: "...",
 *      ids: "...",
 *      score: 82.4
 *    }
 */

return resolveEpisode(
    tmdbId,
    season,
    episode
)
    .then(function(found) {

        if (!found) {
            return [{
                name: "DEBUG",
                title:
                    "NO MATCH: S" +
                    season +
                    "E" +
                    episode,
                url: "https://example.com/"
            }];
        }

        return [{
            name: "DEBUG",
            title:
                "MATCH: Anikoto #" +
                found.number +
                " | " +
                found.title +
                " | score=" +
                found.score,
            url: "https://example.com/"
        }];
    })

/*
 * ---------------------------------------------------------
 * OPTIONAL: GET COMPLETE MAPPING
 * ---------------------------------------------------------
 */

function getMapping(tmdbId) {
    return createMapping(tmdbId);
}

/*
 * ---------------------------------------------------------
 * EXPORT
 * ---------------------------------------------------------
 */

module.exports = {
    getStreams: function(
        tmdbId,
        mediaType,
        season,
        episode
    ) {

        /*
         * This intentionally stops at episode
         * resolution. Your existing provider can
         * take the returned `ids` and continue using
         * its own authorized playback mechanism.
         */

        if (mediaType !== "tv") {
            return Promise.resolve([]);
        }

        return resolveEpisode(
            tmdbId,
            season,
            episode
        )
            .then(function(found) {

                if (!found) {
                    return [];
                }

                /*
                 * At this point:
                 *
                 * found.number = Anikoto absolute number
                 * found.title  = Anikoto title
                 * found.ids    = Anikoto episode identifier
                 *
                 * Crucially, we NEVER do:
                 *
                 *     found.number === episode
                 *
                 * because TMDB seasons and Anikoto's
                 * flat numbering are unrelated.
                 */

                return [{
                    name: "AnikotoTV",
                    title:
                        "Mapped Anikoto episode #" +
                        found.number,
                    episodeNumber:
                        found.number,
                    episodeTitle:
                        found.title,
                    ids:
                        found.ids,
                    matchScore:
                        found.score
                }];
            })
            .catch(function() {
                return [];
            });
    },

    resolveEpisode: resolveEpisode,
    getMapping: getMapping
};