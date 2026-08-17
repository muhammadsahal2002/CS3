"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_BASE: "https://api.themoviedb.org/3",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12; SM-M025F) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function debugStream(msg) {
    return {
        name: "DEBUG: " + msg,
        title: msg,
        url: "https://test.com/error",
        quality: "DEBUG",
        headers: {}
    };
}

function int(v, fallback) {
    var n = parseInt(v, 10);
    return isNaN(n) ? fallback : n;
}

function tmdb(path) {
    return fetch(
        CONFIG.TMDB_BASE +
        path +
        (path.indexOf("?") === -1 ? "?" : "&") +
        "api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY)
    ).then(function (r) {
        return r.ok ? r.json() : null;
    });
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
 * TMDB -> ABSOLUTE EPISODE
 * ========================================================= */

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

    for (var s = 1; s < season; s++) {
        requests.push(
            tmdb(
                "/tv/" +
                encodeURIComponent(tmdbId) +
                "/season/" +
                s
            ).catch(function () {
                return null;
            })
        );
    }

    return Promise.all(requests)
        .then(function (list) {

            var offset = 0;

            for (var i = 0; i < list.length; i++) {

                if (
                    !list[i] ||
                    !list[i].episodes
                ) {
                    debug.push(
                        debugStream(
                            "TMDB SEASON FAILED: " +
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
                    "S" +
                    season +
                    "E" +
                    episode +
                    " = ABSOLUTE " +
                    absolute
                )
            );

            return absolute;
        });
}


/* =========================================================
 * ANIKOTO EPISODES
 * ========================================================= */

function getEpisodes(
    animeId,
    referer,
    debug
) {
    var url =
        CONFIG.BASE_URL +
        "/ajax/episode/list/" +
        animeId +
        "?vrf=";

    return fetch(url, {
        headers: ajaxHeaders(referer)
    })
    .then(function (r) {
        return r.ok ? r.text() : null;
    })
    .then(function (text) {

        if (!text) {
            return [];
        }

        /*
         * IMPORTANT:
         * JSON first, HTML second.
         *
         * \" becomes " automatically.
         */
        var data;

        try {
            data = JSON.parse(text);
        } catch (e) {
            debug.push(
                debugStream(
                    "EPISODE JSON ERROR"
                )
            );
            return [];
        }

        if (!data || !data.result) {
            return [];
        }

        var $ = cheerio.load(data.result);
        var episodes = [];

        /*
         * DUB ONLY.
         */
        $("a[data-num][data-ids]").each(
            function () {

                var $a = $(this);

                var number =
                    int(
                        $a.attr("data-num"),
                        0
                    );

                var ids =
                    $a.attr("data-ids");

                var dub =
                    $a.attr("data-dub") === "1";

                if (
                    !dub ||
                    !ids ||
                    !number
                ) {
                    return;
                }

                episodes.push({
                    number: number,
                    ids: ids,
                    type: "dub",
                    referer: referer
                });
            }
        );

        debug.push(
            debugStream(
                "DUB EPISODES: " +
                episodes.length
            )
        );

        return episodes;
    });
}


/* =========================================================
 * ANIKOTO SERVER
 * ========================================================= */

function getDubServer(
    ep,
    debug
) {
    var url =
        CONFIG.BASE_URL +
        "/ajax/server/list?servers=" +
        encodeURIComponent(ep.ids);

    return fetch(url, {
        headers: ajaxHeaders(ep.referer)
    })
    .then(function (r) {
        return r.ok ? r.text() : null;
    })
    .then(function (text) {

        if (!text) {
            return null;
        }

        var data;

        try {
            data = JSON.parse(text);
        } catch (e) {
            return null;
        }

        if (!data || !data.result) {
            return null;
        }

        var $ = cheerio.load(data.result);

        /*
         * DUB ONLY.
         *
         * Prefer HD-1, then first DUB server.
         */
        var linkId = null;

        $(
            'div.type[data-type="dub"] li[data-link-id]'
        ).each(function () {

            var name =
                $(this).text().trim();

            if (
                name === "HD-1" &&
                !linkId
            ) {
                linkId =
                    $(this).attr(
                        "data-link-id"
                    );
            }
        });

        if (!linkId) {
            $(
                'div.type[data-type="dub"] li[data-link-id]'
            ).each(function () {

                if (!linkId) {
                    linkId =
                        $(this).attr(
                            "data-link-id"
                        );
                }
            });
        }

        if (!linkId) {
            return null;
        }

        debug.push(
            debugStream(
                "DUB SERVER FOUND"
            )
        );

        return fetch(
            CONFIG.BASE_URL +
            "/ajax/server?get=" +
            encodeURIComponent(linkId),
            {
                headers:
                    ajaxHeaders(ep.referer)
            }
        )
        .then(function (r) {
            return r.ok ? r.text() : null;
        })
        .then(function (text) {

            if (!text) {
                return null;
            }

            var data;

            try {
                data = JSON.parse(text);
            } catch (e) {
                return null;
            }

            if (
                !data ||
                !data.result
            ) {
                return null;
            }

            /*
             * Anikoto returns:
             *
             * {
             *   result: {
             *      url: "https://megaplay..."
             *   }
             * }
             */
            return data.result.url || null;
        });
    });
}


/* =========================================================
 * MAIN
 * ========================================================= */

function getStreams(
    animeId,
    tmdbId,
    season,
    episode,
    animeUrl
) {
    var debug = [];

    season = int(season, 1);
    episode = int(episode, 1);

    return getAbsoluteEpisode(
        tmdbId,
        season,
        episode,
        debug
    )
    .then(function (absolute) {

        if (!absolute) {
            return null;
        }

        debug.push(
            debugStream(
                "ANIKOTO TARGET NUM: " +
                absolute
            )
        );

        return getEpisodes(
            animeId,
            animeUrl,
            debug
        )
        .then(function (episodes) {

            var target =
                episodes.filter(
                    function (ep) {
                        return (
                            ep.number ===
                            absolute
                        );
                    }
                )[0];

            if (!target) {
                debug.push(
                    debugStream(
                        "EPISODE NOT FOUND: " +
                        absolute
                    )
                );

                return null;
            }

            debug.push(
                debugStream(
                    "FOUND EPISODE: " +
                    target.number
                )
            );

            return getDubServer(
                target,
                debug
            );
        });
    })
    .then(function (embed) {

        if (!embed) {
            return null;
        }

        debug.push(
            debugStream(
                "EMBED: " + embed
            )
        );

        /*
         * If the returned server URL is already
         * the playable URL, return it directly.
         */
        return {
            url: embed,
            quality: "auto",
            headers: {
                "Referer": CONFIG.BASE_URL,
                "Origin": CONFIG.BASE_URL
            }
        };
    })
    .then(function (stream) {

        if (stream) {
            debug.push(
                debugStream(
                    "STREAM FOUND"
                )
            );

            return debug.concat([{
                name: "AnikotoTV",
                title: "DUB",
                url: stream.url,
                quality: stream.quality,
                headers: stream.headers
            }]);
        }

        return debug;
    })
    .catch(function (e) {

        debug.push(
            debugStream(
                "ERROR: " +
                (e.message || String(e))
            )
        );

        return debug;
    });
}


module.exports = {
    getStreams: getStreams
};