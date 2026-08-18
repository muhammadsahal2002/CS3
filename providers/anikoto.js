"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE = "https://anikoto.cz";
var TMDB = "https://api.themoviedb.org/3";
var KEY = "439c478a771f35c05022f9feabcca01c";

function debug(lines) {
    var out = [];

    for (var i = 0; i < lines.length; i++) {
        out.push({
            name: "DEBUG " + (i + 1),
            title: lines[i],
            url: "https://example.com/"
        });
    }

    return out;
}

function norm(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

function searchAnime(title) {
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
        var result = null;

        $("div.item").each(function(i, el) {

            if (result) return;

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

            if (norm(t) === norm(title)) {
                result = {
                    title: t,
                    url: href.indexOf("http") === 0
                        ? href
                        : BASE + href
                };
            }
        });

        return result;
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
                "Accept": "application/json",
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
                parseInt(
                    a.attr("data-num") || "0",
                    10
                );

            var title =
                a.closest("li").attr("title") || "";

            if (!num) return;

            list.push({
                number: num,
                title: title
            });
        });

        return list;
    })
    .catch(function() {
        return [];
    });
}

function getStreams(
    tmdbId,
    mediaType,
    season,
    episode
) {

    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    var lines = [];

    lines.push("START");
    lines.push("TMDB ID: " + tmdbId);
    lines.push("REQUEST: S" + season + "E" + episode);

    return tmdb(
        "/tv/" + tmdbId
    )
    .then(function(show) {

        if (!show) {
            return debug(
                lines.concat(["TMDB SHOW: FAILED"])
            );
        }

        var showTitle =
            show.name ||
            show.original_name ||
            "";

        lines.push(
            "TMDB SHOW: " + showTitle
        );

        return tmdb(
            "/tv/" +
            tmdbId +
            "/season/" +
            season
        )
        .then(function(seasonData) {

            if (!seasonData) {
                return debug(
                    lines.concat([
                        "TMDB SEASON: FAILED"
                    ])
                );
            }

            lines.push(
                "TMDB SEASON: OK"
            );

            var tmdbEp = null;

            for (
                var i = 0;
                i < seasonData.episodes.length;
                i++
            ) {
                if (
                    parseInt(
                        seasonData.episodes[i]
                            .episode_number,
                        10
                    ) === episode
                ) {
                    tmdbEp =
                        seasonData.episodes[i];
                    break;
                }
            }

            if (!tmdbEp) {
                return debug(
                    lines.concat([
                        "TMDB EPISODE: NOT FOUND"
                    ])
                );
            }

            lines.push(
                "TMDB EP: " +
                (tmdbEp.name || "NO TITLE")
            );

            return searchAnime(showTitle)
                .then(function(anime) {

                    if (!anime) {
                        return debug(
                            lines.concat([
                                "ANIKOTO SEARCH: FAILED"
                            ])
                        );
                    }

                    lines.push(
                        "ANIKOTO: " +
                        anime.title
                    );

                    return getAnimeId(anime.url)
                        .then(function(id) {

                            if (!id) {
                                return debug(
                                    lines.concat([
                                        "ANIKOTO ID: FAILED"
                                    ])
                                );
                            }

                            lines.push(
                                "ANIKOTO ID: " + id
                            );

                            return getEpisodes(
                                id,
                                anime.url
                            )
                            .then(function(eps) {

                                lines.push(
                                    "DUB EPISODES: " +
                                    eps.length
                                );

                                if (!eps.length) {
                                    return debug(lines);
                                }

                                var best = null;
                                var bestScore = 0;

                                var tmdbTitle =
                                    tmdbEp.name || "";

                                for (
                                    var i = 0;
                                    i < eps.length;
                                    i++
                                ) {

                                    var a =
                                        norm(
                                            tmdbTitle
                                        );

                                    var b =
                                        norm(
                                            eps[i].title
                                        );

                                    var aw =
                                        a.split(" ");

                                    var bw =
                                        b.split(" ");

                                    var matches = 0;

                                    for (
                                        var x = 0;
                                        x < aw.length;
                                        x++
                                    ) {
                                        if (
                                            aw[x].length > 2 &&
                                            bw.indexOf(
                                                aw[x]
                                            ) !== -1
                                        ) {
                                            matches++;
                                        }
                                    }

                                    var score =
                                        matches /
                                        Math.max(
                                            aw.length,
                                            bw.length,
                                            1
                                        );

                                    if (
                                        score > bestScore
                                    ) {
                                        bestScore =
                                            score;
                                        best = eps[i];
                                    }
                                }

                                if (!best) {
                                    lines.push(
                                        "MATCH: NONE"
                                    );
                                } else {
                                    lines.push(
                                        "MATCH: #" +
                                        best.number
                                    );

                                    lines.push(
                                        "ANIKOTO TITLE: " +
                                        best.title
                                    );

                                    lines.push(
                                        "SCORE: " +
                                        Math.round(
                                            bestScore * 100
                                        ) +
                                        "%"
                                    );
                                }

                                return debug(lines);
                            });
                        });
                });
        });
    })
    .catch(function(e) {

        return debug([
            "START",
            "ERROR",
            String(e)
        ]);
    });
}

module.exports = {
    getStreams: getStreams
};