/**
 * Anikoto Debug Mapper
 * TMDB Season/Episode -> Anikoto Episode
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE = "https://anikoto.cz";
var TMDB = "https://api.themoviedb.org/3";
var KEY = "YOUR_TMDB_API_KEY";

function norm(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function similarity(a, b) {
    var A = norm(a).split(" ").filter(function(x) {
        return x.length > 2;
    });

    var B = norm(b).split(" ").filter(function(x) {
        return x.length > 2;
    });

    if (!A.length || !B.length) return 0;

    var count = 0;

    for (var i = 0; i < A.length; i++) {
        if (B.indexOf(A[i]) !== -1) count++;
    }

    return count / Math.max(A.length, B.length);
}

function tmdb(path) {
    return fetch(
        TMDB + path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" + KEY
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .catch(function() {
        return null;
    });
}

function getAnikoto(title) {

    return fetch(
        BASE + "/filter?keyword=" +
        encodeURIComponent(title)
    )
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {

        if (!html) return null;

        var $ = cheerio.load(html);
        var best = null;
        var q = norm(title);
        var score = 0;

        $("div.item").each(function(i, el) {

            var a = $(el)
                .find("a.name.d-title, a[data-jp]")
                .first();

            if (!a.length) return;

            var t = (
                a.attr("data-jp") ||
                a.text() ||
                ""
            ).trim();

            var href = a.attr("href");

            if (!t || !href) return;

            var s = similarity(q, t);

            if (norm(t) === q) s = 1;

            if (s > score) {
                score = s;

                best = {
                    title: t,
                    url:
                        href.indexOf("http") === 0
                            ? href
                            : BASE + href
                };
            }
        });

        return best;
    })
    .catch(function() {
        return null;
    });
}

function getAnimeId(url) {

    return fetch(url)
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {

            if (!html) return null;

            var $ = cheerio.load(html);

            var id = $("[data-id]")
                .first()
                .attr("data-id");

            if (id) return id;

            var m =
                html.match(/data-id=["'](\d+)["']/);

            return m ? m[1] : null;
        })
        .catch(function() {
            return null;
        });
}

function getEpisodes(id, referer) {

    return fetch(
        BASE + "/ajax/episode/list/" +
        id + "?vrf=",
        {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "X-Requested-With": "XMLHttpRequest",
                "Accept":
                    "application/json, text/javascript, */*; q=0.01",
                "Referer": referer
            }
        }
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {

        if (!data || !data.result) return [];

        var $ = cheerio.load(data.result);
        var list = [];

        $("a[data-ids]").each(function(i, el) {

            var a = $(el);

            if (a.attr("data-dub") !== "1") return;

            var num =
                parseInt(a.attr("data-num") || "0", 10);

            var title =
                a.closest("li").attr("title") || "";

            if (!num || !title) return;

            list.push({
                number: num,
                title: title,
                ids: a.attr("data-ids")
            });
        });

        return list;
    })
    .catch(function() {
        return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {

    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    return tmdb(
        "/tv/" +
        tmdbId +
        "/season/" +
        season
    )
    .then(function(seasonData) {

        if (!seasonData) {
            return debug("TMDB season request failed");
        }

        var tmdbEp = null;

        for (var i = 0; i < seasonData.episodes.length; i++) {

            if (
                parseInt(
                    seasonData.episodes[i].episode_number,
                    10
                ) === episode
            ) {
                tmdbEp = seasonData.episodes[i];
                break;
            }
        }

        if (!tmdbEp) {
            return debug(
                "TMDB episode not found: S" +
                season + "E" + episode
            );
        }

        var tmdbTitle = tmdbEp.name || "";

        return tmdb(
            "/tv/" + tmdbId
        )
        .then(function(show) {

            if (!show) {
                return debug("TMDB show failed");
            }

            var title =
                show.name ||
                show.original_name;

            return getAnikoto(title)
                .then(function(anime) {

                    if (!anime) {
                        return debug(
                            "Anikoto search failed for: " +
                            title
                        );
                    }

                    return getAnimeId(anime.url)
                        .then(function(animeId) {

                            if (!animeId) {
                                return debug(
                                    "Anikoto ID not found"
                                );
                            }

                            return getEpisodes(
                                animeId,
                                anime.url
                            )
                            .then(function(eps) {

                                if (!eps.length) {
                                    return debug(
                                        "Anikoto episodes: 0"
                                    );
                                }

                                var best = null;
                                var bestScore = 0;

                                for (
                                    var i = 0;
                                    i < eps.length;
                                    i++
                                ) {

                                    var s =
                                        similarity(
                                            tmdbTitle,
                                            eps[i].title
                                        );

                                    if (s > bestScore) {
                                        bestScore = s;
                                        best = eps[i];
                                    }
                                }

                                if (!best) {
                                    return debug(
                                        "No title match"
                                    );
                                }

                                return debug(
                                    "S" + season +
                                    "E" + episode +
                                    " | TMDB: " +
                                    tmdbTitle +
                                    " | Anikoto #" +
                                    best.number +
                                    " | " +
                                    best.title +
                                    " | Score " +
                                    Math.round(
                                        bestScore * 100
                                    ) + "%"
                                );
                            });
                        });
                });
        });
    })
    .catch(function(e) {
        return debug(
            "ERROR: " +
            String(e)
        );
    });
}

function debug(message) {

    return [{
        name: "DEBUG",
        title: message,
        url: "https://example.com/debug"
    }];
}

module.exports = {
    getStreams: getStreams
};