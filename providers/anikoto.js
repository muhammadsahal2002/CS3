/**
 * AnikotoTV Provider for Nuvio
 *
 * DUB ONLY
 *
 * Episode resolution:
 *
 * Nuvio/Cinemeta SxE
 *       ↓
 * Cinemeta exact episode
 *       ↓
 * Episode title + air/release date
 *       ↓
 * Anikoto flat episode list
 *       ↓
 * Title/date matching
 *       ↓
 * Anikoto data-num
 *       ↓
 * DUB server
 *       ↓
 * MegaPlay
 *
 * NO async/await
 * Promise chains only
 */

"use strict";

var cheerio = require("cheerio-without-node-native");


/* =========================================================
 * CONFIG
 * ========================================================= */

var CONFIG = {
    BASE_URL: "https://anikoto.cz",

    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",

    CINEMETA_BASE: "https://v3-cinemeta.strem.io",

    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12; SM-M025F) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.7871.181 Mobile Safari/537.36"
};


/* =========================================================
 * HTTP HELPERS
 * ========================================================= */

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
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL
    };
}


/* =========================================================
 * TEXT HELPERS
 * ========================================================= */

function normalizeTitle(title) {
    return String(title || "")
        .toLowerCase()
        .replace(/&[^;]+;/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function titleWords(title) {
    return normalizeTitle(title)
        .split(" ")
        .filter(function(w) {
            return w.length >= 3;
        });
}


function extractNumbers(text) {
    var matches = String(text || "").match(/\d+/g);
    return matches || [];
}


function sameDate(a, b) {
    if (!a || !b) return false;

    return String(a).substring(0, 10) ===
        String(b).substring(0, 10);
}


/* =========================================================
 * TITLE SIMILARITY
 * ========================================================= */

function titleSimilarity(targetTitle, candidateTitle) {
    var target = normalizeTitle(targetTitle);
    var candidate = normalizeTitle(candidateTitle);

    if (!target || !candidate) return 0;

    if (target === candidate) {
        return 1.0;
    }

    var targetWords = titleWords(target);
    var candidateWords = titleWords(candidate);

    if (
        targetWords.length === 0 ||
        candidateWords.length === 0
    ) {
        return 0;
    }

    var matches = 0;

    for (var i = 0; i < targetWords.length; i++) {
        for (var j = 0; j < candidateWords.length; j++) {

            if (targetWords[i] === candidateWords[j]) {
                matches++;
                break;
            }
        }
    }

    var denominator =
        Math.max(
            targetWords.length,
            candidateWords.length
        );

    return matches / denominator;
}


/* =========================================================
 * EPISODE TITLE RESOLVER
 * ========================================================= */

function findEpisodeByTitle(
    targetTitle,
    targetDate,
    episodes
) {
    if (!targetTitle || !episodes || !episodes.length) {
        return null;
    }

    var target = normalizeTitle(targetTitle);

    var best = null;
    var bestScore = 0;

    console.log(
        "[Anikoto] Looking for episode: " +
        targetTitle
    );

    for (var i = 0; i < episodes.length; i++) {

        var ep = episodes[i];

        if (!ep.title) continue;

        var candidate =
            normalizeTitle(ep.title);

        var similarity =
            titleSimilarity(
                targetTitle,
                ep.title
            );

        var score =
            similarity * 100;

        /*
         * Exact title
         */
        if (candidate === target) {
            score += 100;
        }

        /*
         * Target contained inside candidate
         */
        if (
            candidate.indexOf(target) !== -1 &&
            target.length >= 8
        ) {
            score += 20;
        }

        /*
         * Candidate contained inside target
         */
        if (
            target.indexOf(candidate) !== -1 &&
            candidate.length >= 8
        ) {
            score += 15;
        }

        /*
         * Air/release date match
         */
        if (
            targetDate &&
            ep.date &&
            sameDate(targetDate, ep.date)
        ) {
            score += 35;
        }

        /*
         * Numeric tokens in title.
         *
         * This helps titles containing things like:
         *
         * "100 Million Zeni"
         *
         * without hardcoding a particular anime.
         */
        var targetNumbers =
            extractNumbers(targetTitle);

        var epNumbers =
            extractNumbers(ep.title);

        if (
            targetNumbers.length > 0 &&
            epNumbers.length > 0
        ) {
            for (var n = 0; n < targetNumbers.length; n++) {
                if (
                    epNumbers.indexOf(
                        targetNumbers[n]
                    ) !== -1
                ) {
                    score += 10;
                    break;
                }
            }
        }

        if (score > bestScore) {
            bestScore = score;
            best = ep;
        }
    }

    /*
     * Require a reasonably strong match.
     *
     * Do not randomly choose an episode.
     */
    if (best && bestScore >= 65) {

        console.log(
            "[Anikoto] Match found: " +
            best.title +
            " | EP " +
            best.number +
            " | score=" +
            bestScore
        );

        return best;
    }

    console.log(
        "[Anikoto] No reliable title match. " +
        "Best score=" +
        bestScore
    );

    if (best) {
        console.log(
            "[Anikoto] Best candidate was: " +
            best.title +
            " | EP " +
            best.number
        );
    }

    return null;
}


/* =========================================================
 * TMDB
 * ========================================================= */

function tmdb(path) {

    var url =
        CONFIG.TMDB_BASE +
        path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" +
        CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .catch(function() {
            return null;
        });
}


/* =========================================================
 * TMDB → IMDb
 * ========================================================= */

function getImdbIdFromTmdb(tmdbId, mediaType) {

    var type =
        mediaType === "movie"
            ? "movie"
            : "tv";

    return tmdb(
        "/" +
        type +
        "/" +
        encodeURIComponent(tmdbId) +
        "/external_ids"
    )
    .then(function(data) {

        if (
            data &&
            data.imdb_id
        ) {
            return data.imdb_id;
        }

        return null;
    });
}


/* =========================================================
 * CINEMETA
 * ========================================================= */

function getCinemetaMeta(imdbId) {

    if (!imdbId) {
        return Promise.resolve(null);
    }

    var url =
        CONFIG.CINEMETA_BASE +
        "/meta/series/" +
        encodeURIComponent(imdbId) +
        ".json";

    console.log(
        "[Anikoto] Cinemeta request: " +
        url
    );

    return fetch(url, {
        headers: {
            "User-Agent": CONFIG.USER_AGENT,
            "Accept": "application/json"
        }
    })
    .then(function(r) {

        if (!r.ok) {
            return null;
        }

        return r.json();
    })
    .then(function(data) {

        return data && data.meta
            ? data.meta
            : null;
    })
    .catch(function(err) {

        console.log(
            "[Anikoto] Cinemeta error: " +
            (err && err.message
                ? err.message
                : err)
        );

        return null;
    });
}


/* =========================================================
 * CINEMETA EPISODE RESOLVER
 * ========================================================= */

function getEpisodeFromCinemeta(
    meta,
    season,
    episode
) {

    if (
        !meta ||
        !meta.videos ||
        !meta.videos.length
    ) {
        return null;
    }

    season = parseInt(season, 10);
    episode = parseInt(episode, 10);

    for (
        var i = 0;
        i < meta.videos.length;
        i++
    ) {

        var video = meta.videos[i];

        var videoSeason =
            parseInt(video.season, 10);

        var videoEpisode =
            parseInt(video.episode, 10);

        if (
            videoSeason === season &&
            videoEpisode === episode
        ) {

            return {
                id: video.id || null,

                season: videoSeason,

                episode: videoEpisode,

                title:
                    video.title ||
                    null,

                released:
                    video.released ||
                    null
            };
        }
    }

    return null;
}


/* =========================================================
 * TMDB EPISODE FALLBACK
 * ========================================================= */

function getTmdbEpisode(
    tmdbId,
    season,
    episode
) {

    return tmdb(
        "/tv/" +
        encodeURIComponent(tmdbId) +
        "/season/" +
        season +
        "/episode/" +
        episode
    )
    .then(function(data) {

        if (!data) {
            return null;
        }

        return {
            title:
                data.name ||
                null,

            released:
                data.air_date ||
                null
        };
    });
}


/* =========================================================
 * ANIME SEARCH
 * ========================================================= */

function searchAnime(title) {

    var searchTitle =
        String(title || "")
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

        if (!html) {
            return null;
        }

        var $ =
            cheerio.load(html);

        var results = [];

        $("div.item").each(function(i, el) {

            var $el = $(el);

            var a =
                $el
                    .find(
                        "a.name.d-title, a[data-jp]"
                    )
                    .first();

            if (!a.length) {
                return;
            }

            var href =
                a.attr("href");

            var t =
                (
                    a.attr("data-jp") ||
                    a.text() ||
                    ""
                ).trim();

            if (!href || !t) {
                return;
            }

            results.push({
                title: t,

                url:
                    href.indexOf("http") === 0
                        ? href
                        : CONFIG.BASE_URL + href,

                isMovie:
                    /movie|film|special|ova/i.test(t)
            });
        });

        if (results.length === 0) {
            return null;
        }

        var q =
            normalizeTitle(searchTitle);

        var best = null;
        var bestScore = -999;

        for (
            var i = 0;
            i < results.length;
            i++
        ) {

            var r = results[i];

            var t =
                normalizeTitle(r.title);

            var score = 0;

            /*
             * Exact title
             */
            if (t === q) {
                score = 300;
            }

            /*
             * Search title contained
             */
            else if (
                t.indexOf(q) !== -1
            ) {
                score = 150;
            }

            /*
             * Result contained in search
             */
            else if (
                q.indexOf(t) !== -1
            ) {
                score = 40;
            }

            /*
             * Otherwise use similarity
             */
            else {
                score =
                    titleSimilarity(
                        searchTitle,
                        r.title
                    ) * 100;
            }

            /*
             * Naruto Shippuden protection
             */
            var queryHasShippuden =
                q.indexOf("shippuden") !== -1 ||
                q.indexOf("shippuuden") !== -1;

            var titleHasShippuden =
                t.indexOf("shippuden") !== -1 ||
                t.indexOf("shippuuden") !== -1;

            if (queryHasShippuden) {

                if (titleHasShippuden) {
                    score += 200;
                } else {
                    score -= 150;
                }
            }

            /*
             * Prefer series
             */
            if (!r.isMovie) {
                score += 40;
            }

            if (r.isMovie) {
                score -= 60;
            }

            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }

        console.log(
            "[Anikoto] Search: " +
            searchTitle +
            " | best=" +
            (best ? best.title : "NONE") +
            " | score=" +
            bestScore
        );

        return best || results[0];
    })
    .catch(function() {
        return null;
    });
}


/* =========================================================
 * ANIKOTO INTERNAL ID
 * ========================================================= */

function getAnimeId(url) {

    return fetch(url, {
        headers: headers()
    })
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {

        if (!html) {
            return null;
        }

        var $ =
            cheerio.load(html);

        var id =
            $("[data-id]")
                .first()
                .attr("data-id");

        if (id) {
            return id;
        }

        var m =
            html.match(
                /data-id=["'](\d+)["']/
            );

        return m
            ? m[1]
            : null;
    })
    .catch(function() {
        return null;
    });
}


/* =========================================================
 * GET ALL ANIKOTO EPISODES
 * ========================================================= */

function getAllEpisodes(
    animeId,
    referer
) {

    var url =
        CONFIG.BASE_URL +
        "/ajax/episode/list/" +
        animeId +
        "?vrf=";

    console.log(
        "[Anikoto] Episode list: " +
        animeId
    );

    return fetch(url, {
        headers:
            ajaxHeaders(referer)
    })
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {

        if (
            !data ||
            !data.result
        ) {
            return [];
        }

        var $ =
            cheerio.load(data.result);

        var episodes = [];

        $("a[data-ids]").each(
            function(i, el) {

                var a = $(el);

                var num =
                    parseInt(
                        a.attr("data-num") ||
                        "0",
                        10
                    );

                var ids =
                    a.attr("data-ids");

                var hasDub =
                    a.attr("data-dub") ===
                    "1";

                var title =
                    a
                        .closest("li")
                        .attr("title") ||
                    ("Episode " + num);

                /*
                 * Anikoto timestamp
                 *
                 * Example:
                 * data-timestamp="1729191019"
                 */
                var timestamp =
                    a.attr(
                        "data-timestamp"
                    ) || null;

                var date = null;

                if (timestamp) {

                    var ts =
                        parseInt(
                            timestamp,
                            10
                        );

                    if (!isNaN(ts)) {

                        date =
                            new Date(
                                ts * 1000
                            )
                                .toISOString()
                                .substring(
                                    0,
                                    10
                                );
                    }
                }

                /*
                 * MAL ID is also retained.
                 */
                var mal =
                    a.attr(
                        "data-mal"
                    ) || null;

                if (
                    ids &&
                    hasDub
                ) {

                    episodes.push({

                        number: num,

                        title: title,

                        ids: ids,

                        mal: mal,

                        timestamp:
                            timestamp,

                        date: date
                    });
                }
            }
        );

        console.log(
            "[Anikoto] DUB episodes: " +
            episodes.length
        );

        return episodes;
    })
    .catch(function() {
        return [];
    });
}


/* =========================================================
 * DUB SERVER
 * ========================================================= */

function getDubServer(
    ids,
    referer
) {

    var url =
        CONFIG.BASE_URL +
        "/ajax/server/list?servers=" +
        encodeURIComponent(ids);

    return fetch(url, {
        headers:
            ajaxHeaders(referer)
    })
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {

        if (
            !data ||
            !data.result
        ) {
            return null;
        }

        var $ =
            cheerio.load(data.result);

        return $(
            'div.type[data-type="dub"] li[data-link-id]'
        )
            .first()
            .attr("data-link-id") ||
            null;
    })
    .catch(function() {
        return null;
    });
}


/* =========================================================
 * EMBED
 * ========================================================= */

function getEmbed(
    linkId,
    referer
) {

    var url =
        CONFIG.BASE_URL +
        "/ajax/server?get=" +
        encodeURIComponent(linkId);

    return fetch(url, {
        headers:
            ajaxHeaders(referer)
    })
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {

        if (
            !data ||
            !data.result
        ) {
            return null;
        }

        if (
            typeof data.result ===
            "string"
        ) {
            return data.result;
        }

        if (data.result.url) {
            return data.result.url;
        }

        return null;
    })
    .catch(function() {
        return null;
    });
}


/* =========================================================
 * MEGAPLAY
 * ========================================================= */

function resolveMegaplay(embed) {

    if (!embed) {
        return Promise.resolve(null);
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

    console.log(
        "[Anikoto] MegaPlay embed: " +
        embed
    );

    return fetch(embed, {
        headers: headers({
            "Referer":
                CONFIG.BASE_URL,
            "Origin":
                CONFIG.BASE_URL
        })
    })
    .then(function(r) {
        return r.ok ? r.text() : null;
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
            console.log(
                "[Anikoto] MegaPlay ID not found"
            );

            return null;
        }

        var playerId =
            m[1];

        console.log(
            "[Anikoto] MegaPlay ID: " +
            playerId
        );

        return fetch(
            "https://megaplay.buzz/stream/getSources?id=" +
            encodeURIComponent(
                playerId
            ),
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
        });
    })
    .then(function(data) {

        if (
            !data ||
            !data.sources
        ) {
            return null;
        }

        var file =
            data.sources.file ||
            (
                data.sources[0] &&
                data.sources[0].file
            );

        if (!file) {
            return null;
        }

        return {
            url: file,

            headers: {
                "Referer":
                    "https://megaplay.buzz/",

                "Origin":
                    "https://megaplay.buzz"
            }
        };
    })
    .catch(function(err) {

        console.log(
            "[Anikoto] MegaPlay error: " +
            (
                err &&
                err.message
                    ? err.message
                    : err
            )
        );

        return null;
    });
}


/* =========================================================
 * RESOLVE METADATA
 * ========================================================= */

function resolveEpisodeMetadata(
    tmdbId,
    mediaType,
    season,
    episode
) {

    /*
     * Nuvio may pass:
     *
     * tt1234567:5:54
     *
     * or:
     *
     * tt1234567
     *
     * or:
     *
     * 123456
     */

    var rawId =
        String(tmdbId || "");

    var parts =
        rawId.split(":");

    var baseId =
        parts[0];

    var parsedSeason =
        season;

    var parsedEpisode =
        episode;

    /*
     * If the ID itself contains
     * :season:episode, use those.
     */
    if (parts.length >= 3) {

        parsedSeason =
            parseInt(
                parts[1],
                10
            ) || parsedSeason;

        parsedEpisode =
            parseInt(
                parts[2],
                10
            ) || parsedEpisode;
    }

    console.log(
        "[Anikoto] Metadata request:"
    );

    console.log(
        "[Anikoto] ID = " +
        baseId
    );

    console.log(
        "[Anikoto] S" +
        parsedSeason +
        "E" +
        parsedEpisode
    );

    /*
     * Determine whether this looks
     * like an IMDb ID.
     */
    var isImdb =
        /^tt\d+$/i.test(baseId);

    /*
     * If it's already IMDb,
     * directly use Cinemeta.
     */
    if (isImdb) {

        return getCinemetaMeta(baseId)
            .then(function(meta) {

                var cinemetaEpisode =
                    getEpisodeFromCinemeta(
                        meta,
                        parsedSeason,
                        parsedEpisode
                    );

                if (
                    cinemetaEpisode
                ) {

                    return {
                        seriesTitle:
                            meta.name ||
                            meta.originalName ||
                            null,

                        episodeTitle:
                            cinemetaEpisode.title,

                        released:
                            cinemetaEpisode.released,

                        source:
                            "cinemeta",

                        imdbId:
                            baseId
                    };
                }

                /*
                 * Cinemeta unavailable /
                 * missing episode.
                 */
                console.log(
                    "[Anikoto] Cinemeta episode unavailable"
                );

                return getTmdbEpisode(
                    baseId,
                    parsedSeason,
                    parsedEpisode
                )
                .then(function(ep) {

                    return {
                        seriesTitle:
                            meta
                                ? (
                                    meta.name ||
                                    meta.originalName ||
                                    null
                                )
                                : null,

                        episodeTitle:
                            ep
                                ? ep.title
                                : null,

                        released:
                            ep
                                ? ep.released
                                : null,

                        source:
                            "tmdb-fallback",

                        imdbId:
                            baseId
                    };
                });
            });
    }

    /*
     * Otherwise assume numeric TMDB ID.
     */
    return tmdb(
        "/tv/" +
        encodeURIComponent(
            baseId
        )
    )
    .then(function(showData) {

        if (!showData) {
            return null;
        }

        var seriesTitle =
            showData.name ||
            showData.original_name ||
            null;

        /*
         * First try TMDB external IDs.
         */
        return tmdb(
            "/tv/" +
            encodeURIComponent(
                baseId
            ) +
            "/external_ids"
        )
        .then(function(external) {

            var imdbId =
                external &&
                external.imdb_id
                    ? external.imdb_id
                    : null;

            if (imdbId) {

                return getCinemetaMeta(
                    imdbId
                )
                .then(function(meta) {

                    var ce =
                        getEpisodeFromCinemeta(
                            meta,
                            parsedSeason,
                            parsedEpisode
                        );

                    if (ce) {

                        console.log(
                            "[Anikoto] Resolved through Cinemeta"
                        );

                        return {
                            seriesTitle:
                                seriesTitle ||
                                (
                                    meta &&
                                    (
                                        meta.name ||
                                        meta.originalName
                                    )
                                ) ||
                                null,

                            episodeTitle:
                                ce.title,

                            released:
                                ce.released,

                            source:
                                "cinemeta",

                            imdbId:
                                imdbId
                        };
                    }

                    /*
                     * Cinemeta didn't have
                     * the requested episode.
                     */
                    return getTmdbEpisode(
                        baseId,
                        parsedSeason,
                        parsedEpisode
                    )
                    .then(function(ep) {

                        return {
                            seriesTitle:
                                seriesTitle,

                            episodeTitle:
                                ep
                                    ? ep.title
                                    : null,

                            released:
                                ep
                                    ? ep.released
                                    : null,

                            source:
                                "tmdb-fallback",

                            imdbId:
                                imdbId
                        };
                    });
                });
            }

            /*
             * No IMDb mapping.
             * Direct TMDB fallback.
             */
            return getTmdbEpisode(
                baseId,
                parsedSeason,
                parsedEpisode
            )
            .then(function(ep) {

                return {
                    seriesTitle:
                        seriesTitle,

                    episodeTitle:
                        ep
                            ? ep.title
                            : null,

                    released:
                        ep
                            ? ep.released
                            : null,

                    source:
                        "tmdb",

                    imdbId:
                        null
                };
            });
        });
    });
}


/* =========================================================
 * MAIN PROVIDER
 * ========================================================= */

function getStreams(
    tmdbId,
    mediaType,
    season,
    episode
) {

    season =
        parseInt(season, 10) || 1;

    episode =
        parseInt(episode, 10) || 1;

    console.log(
        "========================================"
    );

    console.log(
        "[Anikoto] REQUEST"
    );

    console.log(
        "[Anikoto] ID: " +
        tmdbId
    );

    console.log(
        "[Anikoto] TYPE: " +
        mediaType
    );

    console.log(
        "[Anikoto] S" +
        season +
        "E" +
        episode
    );

    console.log(
        "========================================"
    );

    /*
     * 1. Resolve episode metadata.
     */
    return resolveEpisodeMetadata(
        tmdbId,
        mediaType,
        season,
        episode
    )

    .then(function(info) {

        if (!info) {

            console.log(
                "[Anikoto] No metadata"
            );

            return [];
        }

        console.log(
            "[Anikoto] SERIES: " +
            info.seriesTitle
        );

        console.log(
            "[Anikoto] EPISODE: " +
            info.episodeTitle
        );

        console.log(
            "[Anikoto] DATE: " +
            info.released
        );

        console.log(
            "[Anikoto] SOURCE: " +
            info.source
        );

        if (!info.seriesTitle) {
            return [];
        }

        /*
         * 2. Search Anikoto.
         */
        return searchAnime(
            info.seriesTitle
        )
        .then(function(best) {

            if (!best) {

                console.log(
                    "[Anikoto] Series not found"
                );

                return [];
            }

            console.log(
                "[Anikoto] SERIES MATCH: " +
                best.title
            );

            /*
             * 3. Get Anikoto internal ID.
             */
            return getAnimeId(
                best.url
            )
            .then(function(animeId) {

                if (!animeId) {

                    console.log(
                        "[Anikoto] Anime ID not found"
                    );

                    return [];
                }

                console.log(
                    "[Anikoto] ANIKOTO ID: " +
                    animeId
                );

                /*
                 * 4. Get flat episode list.
                 */
                return getAllEpisodes(
                    animeId,
                    best.url
                )
                .then(function(episodes) {

                    if (
                        !episodes ||
                        episodes.length === 0
                    ) {

                        console.log(
                            "[Anikoto] No DUB episodes"
                        );

                        return [];
                    }

                    var matched = null;

                    /*
                     * =================================
                     * PRIMARY RESOLUTION:
                     * TITLE + DATE
                     * =================================
                     */

                    if (
                        info.episodeTitle
                    ) {

                        matched =
                            findEpisodeByTitle(
                                info.episodeTitle,
                                info.released,
                                episodes
                            );
                    }

                    /*
                     * =================================
                     * SAFE FALLBACK
                     * =================================
                     *
                     * If TMDB/Cinemeta says
                     * Season 1, Anikoto's flat
                     * episode number normally has
                     * a chance of being equivalent.
                     *
                     * For fake/custom Nuvio seasons,
                     * DON'T do this.
                     */
                    if (!matched) {

                        if (
                            season === 1
                        ) {

                            for (
                                var i = 0;
                                i < episodes.length;
                                i++
                            ) {

                                if (
                                    episodes[i]
                                        .number ===
                                    episode
                                ) {

                                    matched =
                                        episodes[i];

                                    console.log(
                                        "[Anikoto] Number fallback: EP " +
                                        episode
                                    );

                                    break;
                                }
                            }
                        }
                    }

                    /*
                     * =================================
                     * NEVER RANDOMLY PLAY
                     * =================================
                     */

                    if (!matched) {

                        console.log(
                            "[Anikoto] ❌ EPISODE COULD NOT BE RESOLVED"
                        );

                        console.log(
                            "[Anikoto] Requested S" +
                            season +
                            "E" +
                            episode
                        );

                        return [];
                    }

                    console.log(
                        "========================================"
                    );

                    console.log(
                        "[Anikoto] ✅ RESOLVED EPISODE"
                    );

                    console.log(
                        "[Anikoto] Nuvio: S" +
                        season +
                        "E" +
                        episode
                    );

                    console.log(
                        "[Anikoto] Anikoto: EP " +
                        matched.number
                    );

                    console.log(
                        "[Anikoto] Title: " +
                        matched.title
                    );

                    console.log(
                        "[Anikoto] MAL: " +
                        matched.mal
                    );

                    console.log(
                        "[Anikoto] Date: " +
                        matched.date
                    );

                    console.log(
                        "========================================"
                    );

                    /*
                     * 5. Get DUB server.
                     */
                    return getDubServer(
                        matched.ids,
                        best.url
                    )
                    .then(function(linkId) {

                        if (!linkId) {

                            console.log(
                                "[Anikoto] DUB server not found"
                            );

                            return [];
                        }

                        console.log(
                            "[Anikoto] DUB link: " +
                            linkId
                        );

                        /*
                         * 6. Get embed.
                         */
                        return getEmbed(
                            linkId,
                            best.url
                        );
                    })
                    .then(function(embed) {

                        if (!embed) {

                            console.log(
                                "[Anikoto] Embed not found"
                            );

                            return [];
                        }

                        console.log(
                            "[Anikoto] Embed: " +
                            embed
                        );

                        if (
                            embed.indexOf(
                                "megaplay"
                            ) === -1
                        ) {

                            console.log(
                                "[Anikoto] Unsupported embed"
                            );

                            return [];
                        }

                        /*
                         * 7. Resolve MegaPlay.
                         */
                        return resolveMegaplay(
                            embed
                        );
                    })
                    .then(function(stream) {

                        if (!stream) {

                            console.log(
                                "[Anikoto] Stream not found"
                            );

                            return [];
                        }

                        console.log(
                            "[Anikoto] ✅ STREAM FOUND"
                        );

                        /*
                         * 8. Return Nuvio stream.
                         */
                        return [{
                            name:
                                "AnikotoTV",

                            title:
                                "1080p DUB",

                            url:
                                stream.url,

                            quality:
                                "1080p",

                            headers:
                                stream.headers
                        }];
                    });
                });
            });
        });
    })
    .catch(function(err) {

        console.error(
            "[Anikoto] FATAL ERROR: " +
            (
                err &&
                err.message
                    ? err.message
                    : err
            )
        );

        return [];
    });
}


/* =========================================================
 * EXPORT
 * ========================================================= */

module.exports = {
    getStreams: getStreams
};