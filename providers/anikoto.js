"use strict";

var cheerio = require("cheerio-without-node-native");

var BASE = "https://anikoto.cz";
var TMDB = "https://api.themoviedb.org/3";

var API_KEY = "439c478a771f35c05022f9feabcca01c";

function debug(lines) {
    var out = [];

    for (var i = 0; i < lines.length; i++) {
        out.push({
            name: "DEBUG: " + (i + 1),
            title: lines[i],
            url: "https://cdn.watching.onl/test",
            quality: "DEBUG",
            headers: {}
        });
    }

    return out;
}

function tmdb(path) {
    return fetch(
        TMDB + path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" + API_KEY
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {

    var lines = [];

    lines.push("Provider running");
    lines.push("ID=" + tmdbId);
    lines.push("S" + season + "E" + episode);

    return tmdb("/tv/" + tmdbId)

    .then(function(show) {

        if (!show) {
            lines.push("TMDB SHOW FAILED");
            return debug(lines);
        }

        var title =
            show.name ||
            show.original_name ||
            "";

        lines.push("TMDB=" + title);

        return tmdb(
            "/tv/" +
            tmdbId +
            "/season/" +
            season
        )

        .then(function(data) {

            if (!data || !data.episodes) {
                lines.push("TMDB SEASON FAILED");
                return debug(lines);
            }

            lines.push(
                "Season episodes=" +
                data.episodes.length
            );

            var found = null;

            for (var i = 0; i < data.episodes.length; i++) {

                if (
                    parseInt(
                        data.episodes[i].episode_number,
                        10
                    ) === parseInt(episode, 10)
                ) {
                    found = data.episodes[i];
                    break;
                }
            }

            if (!found) {
                lines.push("TMDB EP NOT FOUND");
                return debug(lines);
            }

            lines.push(
                "TMDB EP=" +
                found.episode_number
            );

            lines.push(
                "TITLE=" +
                (found.name || "NO TITLE")
            );

            return fetch(
                BASE +
                "/filter?keyword=" +
                encodeURIComponent(title)
            )

            .then(function(r) {
                return r.ok ? r.text() : null;
            })

            .then(function(html) {

                if (!html) {
                    lines.push("ANIKOTO SEARCH FAILED");
                    return debug(lines);
                }

                var $ = cheerio.load(html);

                var anime = null;

                $("div.item").each(function(i, el) {

                    if (anime) return;

                    var a = $(el)
                        .find(
                            "a.name.d-title, a[data-jp]"
                        )
                        .first();

                    if (!a.length) return;

                    var t =
                        (
                            a.attr("data-jp") ||
                            a.text() ||
                            ""
                        ).trim();

                    var href =
                        a.attr("href");

                    if (!t || !href) return;

                    if (
                        t.toLowerCase() ===
                        title.toLowerCase()
                    ) {
                        anime = {
                            title: t,
                            url:
                                href.indexOf("http") === 0
                                    ? href
                                    : BASE + href
                        };
                    }
                });

                if (!anime) {
                    lines.push("ANIKOTO ANIME NOT FOUND");
                    return debug(lines);
                }

                lines.push(
                    "ANIKOTO=" +
                    anime.title
                );

                return fetch(
                    anime.url
                )

                .then(function(r) {
                    return r.ok ? r.text() : null;
                })

                .then(function(page) {

                    if (!page) {
                        lines.push("ANIME PAGE FAILED");
                        return debug(lines);
                    }

                    var $p = cheerio.load(page);

                    var id =
                        $p("[data-id]")
                        .first()
                        .attr("data-id");

                    if (!id) {

                        var m =
                            page.match(
                                /data-id=["'](\d+)["']/
                            );

                        id =
                            m ? m[1] : null;
                    }

                    if (!id) {
                        lines.push("ANIKOTO ID NOT FOUND");
                        return debug(lines);
                    }

                    lines.push(
                        "ANIKOTO ID=" + id
                    );

                    return fetch(
                        BASE +
                        "/ajax/episode/list/" +
                        id +
                        "?vrf=",
                        {
                            headers: {
                                "User-Agent":
                                    "Mozilla/5.0",
                                "X-Requested-With":
                                    "XMLHttpRequest",
                                "Accept":
                                    "application/json",
                                "Referer":
                                    anime.url
                            }
                        }
                    )

                    .then(function(r) {
                        return r.ok ? r.json() : null;
                    })

                    .then(function(epData) {

                        if (
                            !epData ||
                            !epData.result
                        ) {
                            lines.push(
                                "EPISODE API FAILED"
                            );
                            return debug(lines);
                        }

                        var $e =
                            cheerio.load(
                                epData.result
                            );

                        var total = 0;
                        var dubs = 0;
                        var requested = null;

                        $e("a[data-ids]").each(
                            function(i, el) {

                                var a = $e(el);

                                var num =
                                    parseInt(
                                        a.attr(
                                            "data-num"
                                        ) || "0",
                                        10
                                    );

                                if (num > 0) {
                                    total++;
                                }

                                if (
                                    a.attr(
                                        "data-dub"
                                    ) === "1"
                                ) {
                                    dubs++;
                                }

                                if (
                                    num ===
                                    parseInt(
                                        episode,
                                        10
                                    ) &&
                                    a.attr(
                                        "data-dub"
                                    ) === "1"
                                ) {
                                    requested = a;
                                }
                            }
                        );

                        lines.push(
                            "ANK TOTAL=" +
                            total
                        );

                        lines.push(
                            "ANK DUB=" +
                            dubs
                        );

                        if (requested) {

                            lines.push(
                                "DIRECT MATCH #" +
                                episode
                            );

                            lines.push(
                                "DATA-IDS FOUND"
                            );

                        } else {

                            lines.push(
                                "DIRECT MATCH NONE"
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
            "Provider running",
            "ERROR=" + String(e)
        ]);
    });
}

module.exports = {
    getStreams: getStreams
};