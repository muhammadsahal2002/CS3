/**
 * AnikotoTV - Improved Multi-Season + Movie Version
 *
 * Features:
 * - TMDB episode-title matching for TV
 * - Absolute episode fallback using TMDB season counts
 * - Raw episode fallback
 * - Movie / OVA safe handling
 * - SUB + DUB
 * - Detailed debug output
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",

    /*
     * IMPORTANT:
     * Do not publicly distribute your TMDB API key.
     * Rotate the key currently exposed in the old version.
     */
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",

    TMDB_BASE: "https://api.themoviedb.org/3",

    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12; SM-M025F) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.7871.181 Mobile Safari/537.36"
};


/* =========================================================
 * HTTP HEADERS
 * ========================================================= */

function getHeaders(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept":
            "text/html,application/xhtml+xml," +
            "application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    if (extra) {
        for (var k in extra) {
            h[k] = extra[k];
        }
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


/* =========================================================
 * DEBUG
 * ========================================================= */

function makeDebugStream(msg) {
    return {
        name: "DEBUG: " + msg,
        title: msg,
        url: "https://test.com/error",
        quality: "DEBUG",
        headers: {}
    };
}


/* =========================================================
 * GENERAL HELPERS
 * ========================================================= */

function toInt(value, fallback) {
    var n = parseInt(value, 10);

    if (isNaN(n)) {
        return fallback;
    }

    return n;
}


function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


function normalizeTitle(str) {
    return normalize(str)
        .replace(/\b(the|a|an)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


/**
 * Compare two episode titles.
 *
 * Exact match = 100
 * Contains match = 75
 * Word overlap = lower score
 */
function titleSimilarity(a, b) {
    a = normalizeTitle(a);
    b = normalizeTitle(b);

    if (!a || !b) {
        return 0;
    }

    if (a === b) {
        return 100;
    }

    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
        return 75;
    }

    var aw = a.split(" ");
    var bw = b.split(" ");

    var matches = 0;

    for (var i = 0; i < aw.length; i++) {
        if (aw[i] && bw.indexOf(aw[i]) !== -1) {
            matches++;
        }
    }

    if (!matches) {
        return 0;
    }

    return Math.round(
        (matches / Math.max(aw.length, bw.length)) * 70
    );
}


/* =========================================================
 * SAFE JSON
 * ========================================================= */

function parseJsonSafe(text, debug, label) {
    try {
        return JSON.parse(text);
    } catch (err) {
        debug.push(
            makeDebugStream(
                label +
                " JSON ERR: " +
                (err && err.message ? err.message : String(err))
            )
        );

        return null;
    }
}


/* =========================================================
 * TMDB
 * ========================================================= */

/**
 * Get basic TMDB information.
 *
 * Movies:
 *   /movie/{id}
 *
 * TV:
 *   /tv/{id}
 */
function getTmdbInfo(tmdbId, mediaType, debug) {
    var type = mediaType === "tv" ? "tv" : "movie";

    var url =
        CONFIG.TMDB_BASE +
        "/" +
        type +
        "/" +
        encodeURIComponent(tmdbId) +
        "?api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY);

    return fetch(url)
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data) {
                debug.push(
                    makeDebugStream("TMDB INFO: FAILED")
                );

                return null;
            }

            var title =
                mediaType === "tv"
                    ? (data.name || data.original_name || "")
                    : (data.title || data.original_title || "");

            debug.push(
                makeDebugStream(
                    "TMDB OK: " + (title || tmdbId)
                )
            );

            return data;
        })
        .catch(function(err) {
            debug.push(
                makeDebugStream(
                    "TMDB INFO ERR: " +
                    (err && err.message
                        ? err.message
                        : String(err))
                )
            );

            return null;
        });
}


/**
 * Get the TMDB title for:
 *
 * TV S4E8
 *
 * This endpoint is TV-only.
 */
function getTmdbEpisodeTitle(
    tmdbId,
    season,
    episode,
    debug
) {
    season = toInt(season, 1);
    episode = toInt(episode, 1);

    if (!tmdbId || season < 1 || episode < 1) {
        return Promise.resolve(null);
    }

    var url =
        CONFIG.TMDB_BASE +
        "/tv/" +
        encodeURIComponent(tmdbId) +
        "/season/" +
        season +
        "/episode/" +
        episode +
        "?api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY);

    return fetch(url)
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.name) {
                debug.push(
                    makeDebugStream(
                        "TMDB EP TITLE: FAILED S" +
                        season +
                        "E" +
                        episode
                    )
                );

                return null;
            }

            debug.push(
                makeDebugStream(
                    "TMDB EP TITLE: S" +
                    season +
                    "E" +
                    episode +
                    " = " +
                    data.name
                )
            );

            return data.name;
        })
        .catch(function(err) {
            debug.push(
                makeDebugStream(
                    "TMDB EP TITLE ERR: " +
                    (err && err.message
                        ? err.message
                        : String(err))
                )
            );

            return null;
        });
}


/**
 * Calculate absolute episode number.
 *
 * Example:
 *
 * S4E8
 *
 * previous seasons:
 * S1 = 26
 * S2 = 26
 * S3 = 24
 *
 * absolute = 26 + 26 + 24 + 8
 *          = 84
 */
function getAbsoluteEpisodeNumber(
    tmdbId,
    season,
    episode,
    debug
) {
    season = toInt(season, 1);
    episode = toInt(episode, 1);

    if (season <= 1) {
        return Promise.resolve(episode);
    }

    var requests = [];

    for (var s = 1; s < season; s++) {
        (function(seasonNumber) {
            var url =
                CONFIG.TMDB_BASE +
                "/tv/" +
                encodeURIComponent(tmdbId) +
                "/season/" +
                seasonNumber +
                "?api_key=" +
                encodeURIComponent(CONFIG.TMDB_API_KEY);

            requests.push(
                fetch(url)
                    .then(function(r) {
                        return r.ok ? r.json() : null;
                    })
                    .catch(function() {
                        return null;
                    })
            );
        })(s);
    }

    return Promise.all(requests)
        .then(function(seasons) {
            var offset = 0;

            for (var i = 0; i < seasons.length; i++) {
                var seasonData = seasons[i];

                if (
                    !seasonData ||
                    !seasonData.episodes
                ) {
                    debug.push(
                        makeDebugStream(
                            "ABSOLUTE: missing S" +
                            (i + 1)
                        )
                    );

                    return episode;
                }

                offset += seasonData.episodes.length;
            }

            var absolute = offset + episode;

            debug.push(
                makeDebugStream(
                    "ABSOLUTE: S" +
                    season +
                    "E" +
                    episode +
                    " -> EP " +
                    absolute
                )
            );

            return absolute;
        })
        .catch(function(err) {
            debug.push(
                makeDebugStream(
                    "ABSOLUTE ERR: " +
                    (err && err.message
                        ? err.message
                        : String(err))
                )
            );

            return episode;
        });
}


/* =========================================================
 * ANIKOTO EPISODE TITLE EXTRACTION
 * ========================================================= */

function getAnikotoEpisodeTitle($, el) {
    var $el = $(el);

    var title =
        $el.attr("title") ||
        $el.attr("data-title") ||
        $el.attr("data-name") ||
        $el.find(".d-title").first().text() ||
        $el.find(".title").first().text() ||
        $el.find(".episode-title").first().text() ||
        "";

    return String(title || "")
        .replace(/\s+/g, " ")
        .trim();
}


/* =========================================================
 * EPISODE TARGET SELECTION
 * ========================================================= */

/**
 * Priority:
 *
 * 1. TMDB title
 * 2. Absolute episode number
 * 3. Raw episode number
 *
 * For movies:
 * - No TMDB episode title
 * - No season calculation
 * - Raw/first episode only
 */
function findTargetEpisodes(
    episodes,
    mediaType,
    tmdbEpisodeTitle,
    absoluteEpisode,
    rawEpisode,
    debug
) {
    rawEpisode = toInt(rawEpisode, 1);

    /*
     * -----------------------------------------------------
     * MOVIE
     * -----------------------------------------------------
     */

    if (mediaType !== "tv") {
        var movieTargets = episodes.filter(function(ep) {
            return ep.number === rawEpisode;
        });

        if (movieTargets.length) {
            debug.push(
                makeDebugStream(
                    "MOVIE TARGET: EP " +
                    rawEpisode
                )
            );

            return movieTargets;
        }

        /*
         * Some movie pages may not expose data-num=1.
         * In that case use the first available episode entry.
         */
        if (episodes.length) {
            var firstNumber = episodes[0].number;

            debug.push(
                makeDebugStream(
                    "MOVIE FALLBACK: FIRST EP " +
                    firstNumber
                )
            );

            return episodes.filter(function(ep) {
                return ep.number === firstNumber;
            });
        }

        debug.push(
            makeDebugStream("MOVIE TARGET: NONE")
        );

        return [];
    }


    /*
     * -----------------------------------------------------
     * TV: 1. TITLE MATCH
     * -----------------------------------------------------
     */

    if (tmdbEpisodeTitle) {
        var bestScore = 0;
        var bestNumber = null;
        var bestTitle = "";

        for (var i = 0; i < episodes.length; i++) {
            var ep = episodes[i];

            if (!ep.title) {
                continue;
            }

            var score = titleSimilarity(
                ep.title,
                tmdbEpisodeTitle
            );

            if (score > bestScore) {
                bestScore = score;
                bestNumber = ep.number;
                bestTitle = ep.title;
            }
        }

        /*
         * 55 is intentionally conservative.
         *
         * This prevents a random episode with one common
         * word such as "Home" from winning.
         */
        if (
            bestNumber !== null &&
            bestScore >= 55
        ) {
            debug.push(
                makeDebugStream(
                    "TITLE MATCH: TMDB=\"" +
                    tmdbEpisodeTitle +
                    "\" ANIKOTO=\"" +
                    bestTitle +
                    "\" EP=" +
                    bestNumber +
                    " SCORE=" +
                    bestScore
                )
            );

            return episodes.filter(function(ep) {
                return ep.number === bestNumber;
            });
        }

        debug.push(
            makeDebugStream(
                "TITLE MATCH FAILED: BEST=" +
                bestScore
            )
        );
    }


    /*
     * -----------------------------------------------------
     * TV: 2. ABSOLUTE EPISODE
     * -----------------------------------------------------
     */

    if (
        absoluteEpisode &&
        absoluteEpisode > 0
    ) {
        var absoluteTargets = episodes.filter(
            function(ep) {
                return ep.number === absoluteEpisode;
            }
        );

        if (absoluteTargets.length) {
            debug.push(
                makeDebugStream(
                    "ABSOLUTE MATCH: EP " +
                    absoluteEpisode
                )
            );

            return absoluteTargets;
        }

        debug.push(
            makeDebugStream(
                "ABSOLUTE MATCH FAILED: EP " +
                absoluteEpisode
            )
        );
    }


    /*
     * -----------------------------------------------------
     * TV: 3. RAW EPISODE
     * -----------------------------------------------------
     */

    var rawTargets = episodes.filter(function(ep) {
        return ep.number === rawEpisode;
    });

    if (rawTargets.length) {
        debug.push(
            makeDebugStream(
                "RAW FALLBACK: EP " +
                rawEpisode
            )
        );
    } else {
        debug.push(
            makeDebugStream(
                "RAW FALLBACK FAILED: EP " +
                rawEpisode
            )
        );
    }

    return rawTargets;
}


/* =========================================================
 * MAIN
 * ========================================================= */

function getStreams(
    tmdbId,
    mediaType,
    season,
    episode
) {
    var debug = [];
    var realStreams = [];

    var isTV = mediaType === "tv";

    var seasonNum = toInt(season, 1);
    var epNum = toInt(episode, 1);

    /*
     * Movies don't need season/episode.
     */
    if (!isTV) {
        seasonNum = 1;
        epNum = 1;
    }

    debug.push(
        makeDebugStream(
            "START: " +
            tmdbId +
            " " +
            mediaType +
            " S" +
            seasonNum +
            "E" +
            epNum
        )
    );


    /*
     * -----------------------------------------------------
     * TMDB INFO
     * -----------------------------------------------------
     */

    return getTmdbInfo(
        tmdbId,
        mediaType,
        debug
    )
        .then(function(tmdbData) {
            var searchTitle = String(tmdbId);

            if (tmdbData) {
                if (isTV) {
                    searchTitle =
                        tmdbData.name ||
                        tmdbData.original_name ||
                        searchTitle;
                } else {
                    searchTitle =
                        tmdbData.title ||
                        tmdbData.original_title ||
                        searchTitle;
                }
            }


            /*
             * -------------------------------------------------
             * TV ONLY:
             *
             * Get TMDB episode title and absolute episode.
             *
             * Movies skip both calls completely.
             * -------------------------------------------------
             */

            var episodeTitlePromise;

            if (isTV) {
                episodeTitlePromise =
                    getTmdbEpisodeTitle(
                        tmdbId,
                        seasonNum,
                        epNum,
                        debug
                    );
            } else {
                episodeTitlePromise =
                    Promise.resolve(null);
            }

            var absolutePromise;

            if (
                isTV &&
                seasonNum > 1
            ) {
                absolutePromise =
                    getAbsoluteEpisodeNumber(
                        tmdbId,
                        seasonNum,
                        epNum,
                        debug
                    );
            } else {
                absolutePromise =
                    Promise.resolve(epNum);
            }


            return Promise.all([
                episodeTitlePromise,
                absolutePromise
            ]).then(function(values) {
                return {
                    searchTitle: searchTitle,
                    tmdbEpisodeTitle: values[0],
                    absoluteEpisode: values[1]
                };
            });
        })


        /*
         * -----------------------------------------------------
         * SEARCH ANIKOTO
         * -----------------------------------------------------
         */

        .then(function(context) {
            var searchTitle =
                context.searchTitle;

            var searchUrl =
                CONFIG.BASE_URL +
                "/filter?keyword=" +
                encodeURIComponent(searchTitle);

            return fetch(
                searchUrl,
                {
                    headers: getHeaders()
                }
            )
                .then(function(r) {
                    return r.ok ? r.text() : null;
                })
                .then(function(html) {
                    if (!html) {
                        debug.push(
                            makeDebugStream(
                                "SEARCH: EMPTY HTML"
                            )
                        );

                        return null;
                    }

                    var $ = cheerio.load(html);

                    var results = [];

                    $("div.item").each(
                        function(i, el) {
                            var $el = $(el);

                            var titleEl =
                                $el.find(
                                    "a.name.d-title, a[data-jp]"
                                ).first();

                            if (!titleEl.length) {
                                return;
                            }

                            var href =
                                titleEl.attr("href");

                            var title =
                                (
                                    titleEl.attr(
                                        "data-jp"
                                    ) ||
                                    titleEl.text() ||
                                    ""
                                ).trim();

                            if (!href || !title) {
                                return;
                            }

                            var fullUrl =
                                href.indexOf("http") === 0
                                    ? href
                                    : CONFIG.BASE_URL + href;

                            var isMovieResult =
                                /movie|film|special|ova/i.test(
                                    title
                                );

                            results.push({
                                title: title,
                                url: fullUrl,
                                isMovie: isMovieResult
                            });
                        }
                    );

                    debug.push(
                        makeDebugStream(
                            "SEARCH: " +
                            results.length +
                            " RESULTS"
                        )
                    );

                    if (!results.length) {
                        return null;
                    }


                    /*
                     * -------------------------------------------------
                     * BEST ANIKOTO RESULT
                     * -------------------------------------------------
                     */

                    var q = normalize(searchTitle);

                    var best = null;
                    var bestScore = -999;

                    for (
                        var i = 0;
                        i < results.length;
                        i++
                    ) {
                        var r = results[i];

                        var t = normalize(r.title);

                        var score = 0;

                        if (t === q) {
                            score = 100;
                        } else if (
                            t.indexOf(q) !== -1
                        ) {
                            score = 70;
                        } else if (
                            q.indexOf(t) !== -1
                        ) {
                            score = 50;
                        } else {
                            /*
                             * Partial word matching helps titles
                             * with subtitles / punctuation.
                             */
                            score =
                                titleSimilarity(
                                    r.title,
                                    searchTitle
                                );
                        }


                        /*
                         * Respect requested media type.
                         */

                        if (isTV) {
                            if (r.isMovie) {
                                score -= 50;
                            } else {
                                score += 35;
                            }
                        } else {
                            if (r.isMovie) {
                                score += 35;
                            } else {
                                score -= 25;
                            }
                        }


                        if (score > bestScore) {
                            bestScore = score;
                            best = r;
                        }
                    }

                    if (!best) {
                        best = results[0];
                    }

                    debug.push(
                        makeDebugStream(
                            "BEST: " +
                            best.title +
                            " (" +
                            bestScore +
                            ")"
                        )
                    );

                    return {
                        best: best,
                        context: context
                    };
                });
        })


        /*
         * -----------------------------------------------------
         * ANIKOTO PAGE
         * -----------------------------------------------------
         */

        .then(function(searchResult) {
            if (!searchResult) {
                return null;
            }

            var best = searchResult.best;
            var context = searchResult.context;

            return fetch(
                best.url,
                {
                    headers: getHeaders()
                }
            )
                .then(function(r) {
                    return r.ok ? r.text() : null;
                })
                .then(function(html) {
                    if (!html) {
                        debug.push(
                            makeDebugStream(
                                "ANIME PAGE: EMPTY"
                            )
                        );

                        return null;
                    }

                    var $ = cheerio.load(html);

                    var animeId =
                        $("[data-id]")
                            .first()
                            .attr("data-id");

                    if (!animeId) {
                        var m =
                            html.match(
                                /data-id=["'](\d+)["']/
                            );

                        animeId =
                            m ? m[1] : null;
                    }

                    debug.push(
                        makeDebugStream(
                            "ANIME ID: " +
                            (
                                animeId ||
                                "NOT FOUND"
                            )
                        )
                    );

                    if (!animeId) {
                        return null;
                    }

                    return {
                        animeId: animeId,
                        best: best,
                        context: context
                    };
                });
        })


        /*
         * -----------------------------------------------------
         * EPISODE LIST
         * -----------------------------------------------------
         */

        .then(function(pageData) {
            if (!pageData) {
                return debug.concat(
                    realStreams
                );
            }

            var animeId =
                pageData.animeId;

            var best =
                pageData.best;

            var context =
                pageData.context;

            var epUrl =
                CONFIG.BASE_URL +
                "/ajax/episode/list/" +
                animeId +
                "?vrf=";

            return fetch(
                epUrl,
                {
                    headers:
                        getAjaxHeaders(
                            best.url
                        )
                }
            )
                .then(function(r) {
                    return r.ok
                        ? r.text()
                        : null;
                })
                .then(function(jsonText) {
                    if (!jsonText) {
                        debug.push(
                            makeDebugStream(
                                "EP LIST: EMPTY"
                            )
                        );

                        return debug.concat(
                            realStreams
                        );
                    }

                    var data =
                        parseJsonSafe(
                            jsonText,
                            debug,
                            "EP LIST"
                        );

                    if (
                        !data ||
                        data.status !== 200 ||
                        !data.result
                    ) {
                        debug.push(
                            makeDebugStream(
                                "EP LIST: BAD JSON"
                            )
                        );

                        return debug.concat(
                            realStreams
                        );
                    }

                    var $ep =
                        cheerio.load(
                            data.result
                        );

                    var episodes = [];

                    $ep("a[data-ids]").each(
                        function(i, el) {
                            var $el = $ep(el);

                            var ids =
                                $el.attr(
                                    "data-ids"
                                );

                            var num =
                                toInt(
                                    $el.attr(
                                        "data-num"
                                    ),
                                    0
                                );

                            var hasSub =
                                $el.attr(
                                    "data-sub"
                                ) === "1";

                            var hasDub =
                                $el.attr(
                                    "data-dub"
                                ) === "1";

                            var epTitle =
                                getAnikotoEpisodeTitle(
                                    $ep,
                                    el
                                );

                            if (!ids) {
                                return;
                            }


                            /*
                             * Store SUB.
                             */

                            if (hasSub) {
                                episodes.push({
                                    number: num,
                                    title: epTitle,
                                    type: "sub",
                                    ids: ids,
                                    referer: best.url
                                });
                            }


                            /*
                             * Store DUB.
                             */

                            if (hasDub) {
                                episodes.push({
                                    number: num,
                                    title: epTitle,
                                    type: "dub",
                                    ids: ids,
                                    referer: best.url
                                });
                            }
                        }
                    );

                    debug.push(
                        makeDebugStream(
                            "EPISODES: " +
                            episodes.length
                        )
                    );


                    /*
                     * Show a small amount of parsed episode
                     * information in debug output.
                     */

                    if (episodes.length) {
                        var preview = [];

                        for (
                            var p = 0;
                            p < episodes.length &&
                            p < 8;
                            p++
                        ) {
                            preview.push(
                                episodes[p].number +
                                ":" +
                                (
                                    episodes[p].title ||
                                    "NO TITLE"
                                )
                            );
                        }

                        debug.push(
                            makeDebugStream(
                                "EP PREVIEW: " +
                                preview.join(" | ")
                            )
                        );
                    }


                    /*
                     * -------------------------------------------------
                     * SELECT CORRECT EPISODE
                     * -------------------------------------------------
                     */

                    var targets =
                        findTargetEpisodes(
                            episodes,
                            mediaType,
                            context.tmdbEpisodeTitle,
                            context.absoluteEpisode,
                            epNum,
                            debug
                        );

                    debug.push(
                        makeDebugStream(
                            "TARGETS: " +
                            (
                                targets.length
                                    ? targets
                                        .map(
                                            function(t) {
                                                return (
                                                    t.number +
                                                    ":" +
                                                    t.type
                                                );
                                            }
                                        )
                                        .join(",")
                                    : "NONE"
                            )
                        )
                    );


                    if (!targets.length) {
                        return debug.concat(
                            realStreams
                        );
                    }


                    /*
                     * -------------------------------------------------
                     * RESOLVE ALL SUB/DUB TARGETS
                     * -------------------------------------------------
                     */

                    var chain =
                        Promise.resolve();

                    targets.forEach(
                        function(ep) {
                            chain =
                                chain.then(
                                    function() {
                                        return resolveOne(
                                            ep,
                                            debug
                                        ).then(
                                            function(link) {
                                                if (
                                                    link
                                                ) {
                                                    realStreams.push({
                                                        name:
                                                            "AnikotoTV",

                                                        title:
                                                            (
                                                                link.quality ||
                                                                "1080p"
                                                            ) +
                                                            " " +
                                                            ep.type
                                                                .toUpperCase(),

                                                        url:
                                                            link.url,

                                                        quality:
                                                            link.quality ||
                                                            "1080p",

                                                        headers:
                                                            link.headers ||
                                                            {}
                                                    });
                                                }
                                            }
                                        );
                                    }
                                );
                        }
                    );


                    return chain.then(
                        function() {
                            debug.push(
                                makeDebugStream(
                                    "DONE: " +
                                    realStreams.length +
                                    " STREAMS"
                                )
                            );

                            return debug.concat(
                                realStreams
                            );
                        }
                    );
                });
        })


        /*
         * -----------------------------------------------------
         * GLOBAL ERROR HANDLER
         * -----------------------------------------------------
         */

        .catch(function(err) {
            debug.push(
                makeDebugStream(
                    "FATAL: " +
                    (
                        err &&
                        err.message
                            ? err.message
                            : String(err)
                    )
                )
            );

            debug.push(
                makeDebugStream(
                    "FATAL TYPE: " +
                    typeof err
                )
            );

            return debug.concat(
                realStreams
            );
        });
}


/* =========================================================
 * RESOLVE ANIKOTO SERVER
 * ========================================================= */

function resolveOne(ep, debug) {
    var listUrl =
        CONFIG.BASE_URL +
        "/ajax/server/list?servers=" +
        encodeURIComponent(ep.ids);

    return fetch(
        listUrl,
        {
            headers:
                getAjaxHeaders(
                    ep.referer
                )
        }
    )
        .then(function(r) {
            return r.ok
                ? r.text()
                : null;
        })
        .then(function(listJson) {
            if (!listJson) {
                debug.push(
                    makeDebugStream(
                        ep.type.toUpperCase() +
                        ": NO LIST"
                    )
                );

                return null;
            }

            var listData =
                parseJsonSafe(
                    listJson,
                    debug,
                    ep.type.toUpperCase() +
                    " SERVER LIST"
                );

            if (
                !listData ||
                !listData.result
            ) {
                debug.push(
                    makeDebugStream(
                        ep.type.toUpperCase() +
                        ": BAD LIST"
                    )
                );

                return null;
            }

            var $s =
                cheerio.load(
                    listData.result
                );

            var selector =
                ep.type === "dub"
                    ? 'div.type[data-type="dub"] li[data-link-id]'
                    : 'div.type[data-type="sub"] li[data-link-id]';

            var linkId = null;

            $s(selector).each(
                function(i, el) {
                    if (!linkId) {
                        linkId =
                            $s(el).attr(
                                "data-link-id"
                            );
                    }
                }
            );


            /*
             * Generic fallback.
             */

            if (!linkId) {
                $s("li[data-link-id]").each(
                    function(i, el) {
                        if (!linkId) {
                            linkId =
                                $s(el).attr(
                                    "data-link-id"
                                );
                        }
                    }
                );
            }


            if (!linkId) {
                debug.push(
                    makeDebugStream(
                        ep.type.toUpperCase() +
                        ": NO LINK ID"
                    )
                );

                return null;
            }

            debug.push(
                makeDebugStream(
                    ep.type.toUpperCase() +
                    ": LINK ID OK"
                )
            );

            var serverUrl =
                CONFIG.BASE_URL +
                "/ajax/server?get=" +
                encodeURIComponent(
                    linkId
                );

            return fetch(
                serverUrl,
                {
                    headers:
                        getAjaxHeaders(
                            ep.referer
                        )
                }
            )
                .then(function(r) {
                    return r.ok
                        ? r.text()
                        : null;
                });
        })


        /*
         * -----------------------------------------------------
         * SERVER RESPONSE
         * -----------------------------------------------------
         */

        .then(function(sJson) {
            if (!sJson) {
                return null;
            }

            var sData =
                parseJsonSafe(
                    sJson,
                    debug,
                    ep.type.toUpperCase() +
                    " SERVER"
                );

            if (!sData) {
                return null;
            }

            var embed = null;

            if (sData.result) {
                if (
                    typeof sData.result ===
                    "string"
                ) {
                    embed =
                        sData.result;
                } else if (
                    sData.result.url
                ) {
                    embed =
                        sData.result.url;
                }
            }


            if (
                !embed ||
                embed.indexOf(
                    "megaplay"
                ) === -1
            ) {
                debug.push(
                    makeDebugStream(
                        ep.type.toUpperCase() +
                        ": NO EMBED"
                    )
                );

                return null;
            }

            debug.push(
                makeDebugStream(
                    ep.type.toUpperCase() +
                    ": EMBED OK"
                )
            );


            if (
                embed.indexOf(
                    "autostart"
                ) === -1
            ) {
                embed +=
                    (
                        embed.indexOf("?") === -1
                            ? "?"
                            : "&"
                    ) +
                    "autostart=true";
            }


            return fetch(
                embed,
                {
                    headers:
                        getHeaders({
                            "Referer":
                                CONFIG.BASE_URL,

                            "Origin":
                                CONFIG.BASE_URL
                        })
                }
            )
                .then(function(r) {
                    return r.ok
                        ? r.text()
                        : null;
                })
                .then(function(html) {
                    if (!html) {
                        debug.push(
                            makeDebugStream(
                                ep.type.toUpperCase() +
                                ": MEGAPLAY EMPTY"
                            )
                        );

                        return null;
                    }


                    var m =
                        html.match(
                            /data-id=["'](\d+)["']/
                        );

                    if (!m) {
                        debug.push(
                            makeDebugStream(
                                ep.type.toUpperCase() +
                                ": NO DATA ID"
                            )
                        );

                        return null;
                    }

                    var sourcesUrl =
                        "https://megaplay.buzz/stream/getSources?id=" +
                        m[1];


                    return fetch(
                        sourcesUrl,
                        {
                            headers: {
                                "User-Agent":
                                    CONFIG.USER_AGENT,

                                "X-Requested-With":
                                    "XMLHttpRequest",

                                "Referer":
                                    embed,

                                "Accept":
                                    "application/json"
                            }
                        }
                    )
                        .then(function(r) {
                            return r.ok
                                ? r.json()
                                : null;
                        })
                        .then(function(sources) {
                            if (
                                !sources ||
                                !sources.sources
                            ) {
                                debug.push(
                                    makeDebugStream(
                                        ep.type.toUpperCase() +
                                        ": SOURCES FAIL"
                                    )
                                );

                                return null;
                            }


                            var videoUrl =
                                sources.sources.file ||
                                (
                                    sources.sources[0] &&
                                    sources.sources[0].file
                                );


                            if (!videoUrl) {
                                debug.push(
                                    makeDebugStream(
                                        ep.type.toUpperCase() +
                                        ": NO FILE"
                                    )
                                );

                                return null;
                            }


                            debug.push(
                                makeDebugStream(
                                    ep.type.toUpperCase() +
                                    ": SUCCESS"
                                )
                            );


                            return {
                                url: videoUrl,

                                quality:
                                    "1080p",

                                headers: {
                                    "Referer":
                                        "https://megaplay.buzz/",

                                    "Origin":
                                        "https://megaplay.buzz"
                                }
                            };
                        });
                });
        })


        /*
         * -----------------------------------------------------
         * RESOLVE ERROR
         * -----------------------------------------------------
         */

        .catch(function(err) {
            debug.push(
                makeDebugStream(
                    ep.type.toUpperCase() +
                    ": ERR " +
                    (
                        err &&
                        err.message
                            ? err.message
                            : String(err)
                    )
                )
            );

            return null;
        });
}


/* =========================================================
 * EXPORT
 * ========================================================= */

module.exports = {
    getStreams: getStreams
};