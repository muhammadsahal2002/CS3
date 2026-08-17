"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikototv.to",

    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",

    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12; SM-M025F) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.7871.181 Mobile Safari/537.36"
};


/* =========================================================
 * DEBUG
 * ========================================================= */

function debugStream(msg) {
    return {
        name: "DEBUG: " + msg,
        title: msg,
        url: "https://test.com/error",
        quality: "DEBUG",
        headers: {}
    };
}


/* =========================================================
 * HELPERS
 * ========================================================= */

function int(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}


function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/&amp;/g, "&")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}


function titleScore(a, b) {
    a = normalize(a);
    b = normalize(b);

    if (!a || !b) return 0;

    if (a === b) return 100;

    if (
        a.indexOf(b) !== -1 ||
        b.indexOf(a) !== -1
    ) {
        return 80;
    }

    var aa = a.split(" ");
    var bb = b.split(" ");

    var hits = 0;

    for (var i = 0; i < aa.length; i++) {
        if (bb.indexOf(aa[i]) !== -1) {
            hits++;
        }
    }

    return Math.round(
        (hits / Math.max(aa.length, bb.length)) * 70
    );
}


function safeJson(text, debug, label) {
    try {
        return JSON.parse(text);
    } catch (e) {
        debug.push(
            debugStream(
                label +
                " JSON ERROR: " +
                (e.message || String(e))
            )
        );

        return null;
    }
}


function headers(extra) {
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


function ajaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept":
            "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL
    };
}


/* =========================================================
 * TMDB
 * ========================================================= */

function tmdbRequest(path) {
    var separator =
        path.indexOf("?") === -1 ? "?" : "&";

    return fetch(
        CONFIG.TMDB_BASE +
        path +
        separator +
        "api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY)
    ).then(function(r) {
        return r.ok ? r.json() : null;
    });
}


/*
 * Get TV/movie title.
 *
 * Only used to locate the Anikoto series.
 * Episode titles are NOT compared.
 */
function getTmdbTitle(
    tmdbId,
    mediaType,
    debug
) {
    var type =
        mediaType === "tv"
            ? "tv"
            : "movie";

    return tmdbRequest(
        "/" +
        type +
        "/" +
        encodeURIComponent(tmdbId)
    )
        .then(function(data) {
            if (!data) {
                debug.push(
                    debugStream(
                        "TMDB TITLE FAILED"
                    )
                );

                return String(tmdbId);
            }

            var title =
                mediaType === "tv"
                    ? (
                        data.name ||
                        data.original_name
                    )
                    : (
                        data.title ||
                        data.original_title
                    );

            title =
                title ||
                String(tmdbId);

            debug.push(
                debugStream(
                    "TMDB TITLE: " + title
                )
            );

            return title;
        })
        .catch(function(e) {
            debug.push(
                debugStream(
                    "TMDB TITLE ERROR: " +
                    (e.message || String(e))
                )
            );

            return String(tmdbId);
        });
}


/*
 * Calculate absolute Anikoto episode number.
 *
 * S1E1 = 1
 *
 * S2E1 =
 *   number of S1 episodes + 1
 *
 * S3E1 =
 *   number of S1 episodes +
 *   number of S2 episodes + 1
 *
 * No episode-title matching.
 */
function getAbsoluteEpisode(
    tmdbId,
    season,
    episode,
    debug
) {
    season = int(season, 1);
    episode = int(episode, 1);

    if (season <= 1) {
        return Promise.resolve(episode);
    }

    var requests = [];

    for (
        var s = 1;
        s < season;
        s++
    ) {
        requests.push(
            tmdbRequest(
                "/tv/" +
                encodeURIComponent(tmdbId) +
                "/season/" +
                s
            ).catch(function() {
                return null;
            })
        );
    }

    return Promise.all(requests)
        .then(function(list) {
            var offset = 0;

            for (
                var i = 0;
                i < list.length;
                i++
            ) {
                if (
                    !list[i] ||
                    !list[i].episodes
                ) {
                    debug.push(
                        debugStream(
                            "ABSOLUTE FAILED S" +
                            (i + 1)
                        )
                    );

                    return null;
                }

                offset +=
                    list[i].episodes.length;
            }

            var absolute =
                offset + episode;

            debug.push(
                debugStream(
                    "ABSOLUTE EPISODE: S" +
                    season +
                    "E" +
                    episode +
                    " = " +
                    absolute
                )
            );

            return absolute;
        });
}


/* =========================================================
 * ANIKOTO SEARCH
 * ========================================================= */

function searchAnikoto(
    title,
    mediaType,
    debug
) {
    var url =
        CONFIG.BASE_URL +
        "/filter?keyword=" +
        encodeURIComponent(title);

    return fetch(
        url,
        {
            headers: headers()
        }
    )
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) {
                debug.push(
                    debugStream(
                        "ANIKOTO SEARCH EMPTY"
                    )
                );

                return null;
            }

            var $ = cheerio.load(html);

            var results = [];

            $("div.item").each(
                function(i, el) {
                    var $item = $(el);

                    var link =
                        $item.find(
                            "a[href]"
                        ).first();

                    if (!link.length) {
                        return;
                    }

                    var href =
                        link.attr("href");

                    if (!href) {
                        return;
                    }

                    var name =
                        (
                            link.attr("data-jp") ||
                            link.text() ||
                            $item.find(
                                ".d-title"
                            ).first().text() ||
                            ""
                        ).trim();

                    if (!name) {
                        name =
                            (
                                $item.find(
                                    ".name"
                                ).first().text() ||
                                ""
                            ).trim();
                    }

                    if (!name) {
                        return;
                    }

                    var fullUrl =
                        href.indexOf("http") === 0
                            ? href
                            : CONFIG.BASE_URL + href;

                    var typeText =
                        $item.text();

                    var movie =
                        /movie|ova|special|ona/i.test(
                            typeText
                        );

                    results.push({
                        title: name,
                        url: fullUrl,
                        movie: movie
                    });
                }
            );

            debug.push(
                debugStream(
                    "ANIKOTO RESULTS: " +
                    results.length
                )
            );

            if (!results.length) {
                return null;
            }

            var wanted =
                normalize(title);

            var best = null;
            var bestScore = -999;

            for (
                var i = 0;
                i < results.length;
                i++
            ) {
                var r = results[i];

                var score =
                    titleScore(
                        r.title,
                        title
                    );

                if (mediaType === "tv") {
                    if (r.movie) {
                        score -= 50;
                    } else {
                        score += 25;
                    }
                } else {
                    if (r.movie) {
                        score += 30;
                    }
                }

                if (
                    normalize(r.title) === wanted
                ) {
                    score += 100;
                }

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            if (!best) {
                return null;
            }

            debug.push(
                debugStream(
                    "ANIKOTO BEST: " +
                    best.title +
                    " SCORE=" +
                    bestScore
                )
            );

            return best;
        })
        .catch(function(e) {
            debug.push(
                debugStream(
                    "ANIKOTO SEARCH ERROR: " +
                    (e.message || String(e))
                )
            );

            return null;
        });
}


/* =========================================================
 * EPISODE LIST
 * ========================================================= */

function getEpisodes(
    animeUrl,
    debug
) {
    return fetch(
        animeUrl,
        {
            headers: headers()
        }
    )
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) {
                debug.push(
                    debugStream(
                        "ANIME PAGE EMPTY"
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
                        /data-id\s*=\s*["'](\d+)["']/
                    );

                if (m) {
                    animeId = m[1];
                }
            }

            debug.push(
                debugStream(
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

            var epUrl =
                CONFIG.BASE_URL +
                "/ajax/episode/list/" +
                animeId +
                "?vrf=";

            return fetch(
                epUrl,
                {
                    headers:
                        ajaxHeaders(
                            animeUrl
                        )
                }
            )
                .then(function(r) {
                    return r.ok
                        ? r.text()
                        : null;
                })
                .then(function(text) {
                    if (!text) {
                        debug.push(
                            debugStream(
                                "EP LIST EMPTY"
                            )
                        );

                        return null;
                    }

                    var data =
                        safeJson(
                            text,
                            debug,
                            "EP LIST"
                        );

                    if (
                        !data ||
                        !data.result
                    ) {
                        debug.push(
                            debugStream(
                                "EP LIST BAD RESPONSE"
                            )
                        );

                        return null;
                    }

                    var $ep =
                        cheerio.load(
                            data.result
                        );

                    var episodes = [];

                    /*
                     * data-num is the important field.
                     * Episode titles are kept only as metadata.
                     */
                    $ep(
                        "a[data-ids]"
                    ).each(
                        function(i, el) {
                            var $el =
                                $ep(el);

                            var ids =
                                $el.attr(
                                    "data-ids"
                                );

                            var number =
                                int(
                                    $el.attr(
                                        "data-num"
                                    ),
                                    0
                                );

                            var anikotoId =
                                $el.attr(
                                    "data-id"
                                );

                            var sub =
                                $el.attr(
                                    "data-sub"
                                ) === "1";

                            var dub =
                                $el.attr(
                                    "data-dub"
                                ) === "1";

                            var title =
                                (
                                    $el.attr(
                                        "title"
                                    ) ||
                                    ""
                                )
                                    .replace(
                                        /\s+/g,
                                        " "
                                    )
                                    .trim();

                            if (!ids) {
                                return;
                            }

                            if (sub) {
                                episodes.push({
                                    number: number,
                                    anikotoId: anikotoId,
                                    title: title,
                                    type: "sub",
                                    ids: ids,
                                    referer: animeUrl
                                });
                            }

                            if (dub) {
                                episodes.push({
                                    number: number,
                                    anikotoId: anikotoId,
                                    title: title,
                                    type: "dub",
                                    ids: ids,
                                    referer: animeUrl
                                });
                            }
                        }
                    );

                    debug.push(
                        debugStream(
                            "EPISODES PARSED: " +
                            episodes.length
                        )
                    );

                    return episodes;
                });
        })
        .catch(function(e) {
            debug.push(
                debugStream(
                    "EPISODE LIST ERROR: " +
                    (e.message || String(e))
                )
            );

            return null;
        });
}


/* =========================================================
 * FIND TARGET
 * ========================================================= */

function findTarget(
    episodes,
    mediaType,
    rawEpisode,
    absoluteEpisode,
    debug
) {
    var number =
        mediaType === "tv"
            ? absoluteEpisode
            : rawEpisode;

    var targets =
        episodes.filter(
            function(e) {
                return e.number === number;
            }
        );

    if (targets.length) {
        debug.push(
            debugStream(
                "TARGET data-num=" +
                number
            )
        );

        return targets;
    }

    debug.push(
        debugStream(
            "TARGET NOT FOUND data-num=" +
            number
        )
    );

    return [];
}


/* =========================================================
 * RESOLVE SERVER
 * ========================================================= */

function resolveOne(
    ep,
    debug
) {
    var url =
        CONFIG.BASE_URL +
        "/ajax/server/list?servers=" +
        encodeURIComponent(
            ep.ids
        );

    return fetch(
        url,
        {
            headers:
                ajaxHeaders(
                    ep.referer
                )
        }
    )
        .then(function(r) {
            return r.ok
                ? r.text()
                : null;
        })
        .then(function(text) {
            if (!text) {
                debug.push(
                    debugStream(
                        ep.type.toUpperCase() +
                        ": SERVER LIST EMPTY"
                    )
                );

                return null;
            }

            var data =
                safeJson(
                    text,
                    debug,
                    ep.type.toUpperCase() +
                    " SERVER LIST"
                );

            if (
                !data ||
                !data.result
            ) {
                return null;
            }

            var $ =
                cheerio.load(
                    data.result
                );

            var selector =
                ep.type === "dub"
                    ? 'div.type[data-type="dub"] li[data-link-id]'
                    : 'div.type[data-type="sub"] li[data-link-id]';

            var linkId = null;

            $(selector).each(
                function(i, el) {
                    if (!linkId) {
                        linkId =
                            $(el).attr(
                                "data-link-id"
                            );
                    }
                }
            );

            if (!linkId) {
                $("li[data-link-id]").each(
                    function(i, el) {
                        if (!linkId) {
                            linkId =
                                $(el).attr(
                                    "data-link-id"
                                );
                        }
                    }
                );
            }

            if (!linkId) {
                debug.push(
                    debugStream(
                        ep.type.toUpperCase() +
                        ": NO LINK ID"
                    )
                );

                return null;
            }

            debug.push(
                debugStream(
                    ep.type.toUpperCase() +
                    ": LINK ID " +
                    linkId
                )
            );

            return fetch(
                CONFIG.BASE_URL +
                "/ajax/server?get=" +
                encodeURIComponent(
                    linkId
                ),
                {
                    headers:
                        ajaxHeaders(
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
        .then(function(text) {
            if (!text) {
                return null;
            }

            var data =
                safeJson(
                    text,
                    debug,
                    ep.type.toUpperCase() +
                    " SERVER"
                );

            if (!data) {
                return null;
            }

            var embed = null;

            if (
                typeof data.result ===
                "string"
            ) {
                embed =
                    data.result;
            } else if (
                data.result &&
                data.result.url
            ) {
                embed =
                    data.result.url;
            }

            if (!embed) {
                debug.push(
                    debugStream(
                        ep.type.toUpperCase() +
                        ": NO EMBED"
                    )
                );

                return null;
            }

            debug.push(
                debugStream(
                    ep.type.toUpperCase() +
                    ": EMBED " +
                    embed
                )
            );

            if (
                embed.indexOf(
                    "megaplay"
                ) === -1
            ) {
                debug.push(
                    debugStream(
                        ep.type.toUpperCase() +
                        ": NOT MEGAPLAY"
                    )
                );

                return null;
            }

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
                        headers({
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
                        return null;
                    }

                    var m =
                        html.match(
                            /data-id=["'](\d+)["']/
                        );

                    if (!m) {
                        debug.push(
                            debugStream(
                                ep.type.toUpperCase() +
                                ": MEGAPLAY ID NOT FOUND"
                            )
                        );

                        return null;
                    }

                    var sourceUrl =
                        "https://megaplay.buzz/stream/getSources?id=" +
                        m[1];

                    return fetch(
                        sourceUrl,
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
                                return null;
                            }

                            var file =
                                sources.sources.file ||
                                (
                                    sources.sources[0] &&
                                    sources.sources[0].file
                                );

                            if (!file) {
                                return null;
                            }

                            /*
                             * Get quality from source.
                             * No hardcoded 1080p.
                             */
                            var quality =
                                sources.quality ||
                                (
                                    sources.sources &&
                                    sources.sources.quality
                                ) ||
                                (
                                    sources.sources[0] &&
                                    sources.sources[0].quality
                                ) ||
                                "Auto";

                            debug.push(
                                debugStream(
                                    ep.type.toUpperCase() +
                                    ": SUCCESS " +
                                    quality
                                )
                            );

                            return {
                                url: file,

                                quality: quality,

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
        .catch(function(e) {
            debug.push(
                debugStream(
                    ep.type.toUpperCase() +
                    ": RESOLVE ERROR " +
                    (e.message || String(e))
                )
            );

            return null;
        });
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
    var streams = [];

    var isTV =
        mediaType === "tv";

    var s =
        int(season, 1);

    var e =
        int(episode, 1);

    if (!isTV) {
        s = 1;
        e = 1;
    }

    debug.push(
        debugStream(
            "START " +
            tmdbId +
            " " +
            mediaType +
            " S" +
            s +
            "E" +
            e
        )
    );

    return getTmdbTitle(
        tmdbId,
        mediaType,
        debug
    )
        .then(function(title) {

            return searchAnikoto(
                title,
                mediaType,
                debug
            )
                .then(function(best) {

                    if (!best) {
                        debug.push(
                            debugStream(
                                "NO ANIKOTO RESULT"
                            )
                        );

                        return null;
                    }

                    /*
                     * Only calculate absolute episode
                     * for TV.
                     */
                    var absolutePromise =
                        isTV
                            ? getAbsoluteEpisode(
                                tmdbId,
                                s,
                                e,
                                debug
                            )
                            : Promise.resolve(1);

                    return absolutePromise
                        .then(function(absolute) {

                            if (
                                isTV &&
                                absolute === null
                            ) {
                                debug.push(
                                    debugStream(
                                        "ABSOLUTE EPISODE FAILED"
                                    )
                                );

                                return null;
                            }

                            return getEpisodes(
                                best.url,
                                debug
                            )
                                .then(function(episodes) {

                                    if (
                                        !episodes ||
                                        !episodes.length
                                    ) {
                                        debug.push(
                                            debugStream(
                                                "NO EPISODES"
                                            )
                                        );

                                        return null;
                                    }

                                    var targets =
                                        findTarget(
                                            episodes,
                                            mediaType,
                                            e,
                                            absolute,
                                            debug
                                        );

                                    if (
                                        !targets.length
                                    ) {
                                        return null;
                                    }

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
                                                        )
                                                            .then(
                                                                function(link) {

                                                                    if (!link) {
                                                                        return;
                                                                    }

                                                                    streams.push({
                                                                        name:
                                                                            "AnikotoTV",

                                                                        title:
                                                                            (
                                                                                link.quality ||
                                                                                "Auto"
                                                                            ) +
                                                                            " " +
                                                                            ep.type.toUpperCase(),

                                                                        url:
                                                                            link.url,

                                                                        quality:
                                                                            link.quality ||
                                                                            "Auto",

                                                                        headers:
                                                                            link.headers ||
                                                                            {}
                                                                    });
                                                                }
                                                            );
                                                    }
                                                );
                                        }
                                    );

                                    return chain;
                                });
                        });
                });
        })
        .then(function() {

            debug.push(
                debugStream(
                    "FINAL STREAMS: " +
                    streams.length
                )
            );

            return debug.concat(
                streams
            );
        })
        .catch(function(e) {

            debug.push(
                debugStream(
                    "FATAL: " +
                    (
                        e &&
                        e.message
                            ? e.message
                            : String(e)
                    )
                )
            );

            return debug.concat(
                streams
            );
        });
}


module.exports = {
    getStreams: getStreams
};