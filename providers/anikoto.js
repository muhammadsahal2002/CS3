"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",

    USER_AGENT:
        "Mozilla/5.0 (Linux; Android 12; SM-M025F) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/150.0.7871.181 Mobile Safari/537.36"
};

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };

    if (extra) {
        for (var k in extra)
            h[k] = extra[k];
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

function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function tmdb(path) {
    return fetch(
        CONFIG.TMDB_BASE +
        path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" +
        encodeURIComponent(CONFIG.TMDB_API_KEY)
    ).then(function(r) {
        return r.ok ? r.json() : null;
    });
}


/* Convert S2E1 -> absolute episode number */
function absoluteEpisode(id, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    if (season <= 1)
        return Promise.resolve(episode);

    var requests = [];

    for (var s = 1; s < season; s++) {
        requests.push(
            tmdb(
                "/tv/" +
                encodeURIComponent(id) +
                "/season/" +
                s
            )
        );
    }

    return Promise.all(requests).then(function(list) {
        var offset = 0;

        for (var i = 0; i < list.length; i++) {
            if (!list[i] || !list[i].episodes)
                return null;

            offset += list[i].episodes.length;
        }

        return offset + episode;
    });
}


/* Search Anikoto */
function search(title) {
    return fetch(
        CONFIG.BASE_URL +
        "/filter?keyword=" +
        encodeURIComponent(title),
        {
            headers: headers()
        }
    )
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html)
            return null;

        var $ = cheerio.load(html);
        var results = [];

        $("div.item").each(function(i, el) {
            var item = $(el);

            var a = item.find(
                "a.name.d-title, a[data-jp]"
            ).first();

            if (!a.length)
                return;

            var href = a.attr("href");
            var title =
                a.attr("data-jp") ||
                a.text() ||
                "";

            title = title.trim();

            if (!href || !title)
                return;

            var url =
                href.indexOf("http") === 0
                    ? href
                    : CONFIG.BASE_URL + href;

            results.push({
                title: title,
                url: url
            });
        });

        if (!results.length)
            return null;

        var q = normalize(title);
        var best = null;
        var bestScore = -999;

        for (var i = 0; i < results.length; i++) {
            var t = normalize(results[i].title);
            var score = 0;

            if (t === q)
                score = 100;
            else if (t.indexOf(q) !== -1)
                score = 70;
            else if (q.indexOf(t) !== -1)
                score = 50;

            if (score > bestScore) {
                bestScore = score;
                best = results[i];
            }
        }

        return best || results[0];
    });
}


/* Get Anikoto anime ID */
function getAnimeId(url) {
    return fetch(url, {
        headers: headers()
    })
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html)
            return null;

        var $ = cheerio.load(html);

        var id = $("[data-id]")
            .first()
            .attr("data-id");

        if (id)
            return id;

        var m = html.match(
            /data-id=["'](\d+)["']/
        );

        return m ? m[1] : null;
    });
}


/*
 * Find the requested episode.
 *
 * Important:
 * The JSON response contains escaped HTML such as:
 *
 * data-num=\"72\"
 *
 * JSON.parse() converts that back into:
 *
 * data-num="72"
 *
 * Cheerio therefore sees normal HTML.
 */
function getDubEpisode(animeId, episode) {
    return fetch(
        CONFIG.BASE_URL +
        "/ajax/episode/list/" +
        animeId +
        "?vrf=",
        {
            headers: ajaxHeaders()
        }
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {
        if (!data || !data.result)
            return null;

        var $ = cheerio.load(data.result);

        var found = null;

        /*
         * Only DUB.
         *
         * Do NOT require a particular attribute order.
         * data-num, data-dub and data-ids can appear
         * in different orders.
         */
        $("a[data-ids]").each(function(i, el) {
            if (found)
                return;

            var a = $(el);

            var num = parseInt(
                a.attr("data-num") || "0",
                10
            );

            var dub = a.attr("data-dub") === "1";
            var ids = a.attr("data-ids");

            if (
                num === episode &&
                dub &&
                ids
            ) {
                found = {
                    number: num,
                    ids: ids
                };
            }
        });

        return found;
    });
}


/* Get DUB server */
function getDubServer(ids, referer) {
    return fetch(
        CONFIG.BASE_URL +
        "/ajax/server/list?servers=" +
        encodeURIComponent(ids),
        {
            headers: ajaxHeaders(referer)
        }
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {
        if (!data || !data.result)
            return null;

        var $ = cheerio.load(data.result);

        /*
         * Only:
         *
         * <div class="type" data-type="dub">
         *
         * Never select SUB here.
         */
        var linkId = $(
            'div.type[data-type="dub"] li[data-link-id]'
        )
        .first()
        .attr("data-link-id");

        return linkId || null;
    });
}


/* Convert server ID to embed URL */
function getEmbed(linkId, referer) {
    return fetch(
        CONFIG.BASE_URL +
        "/ajax/server?get=" +
        encodeURIComponent(linkId),
        {
            headers: ajaxHeaders(referer)
        }
    )
    .then(function(r) {
        return r.ok ? r.json() : null;
    })
    .then(function(data) {
        if (!data || !data.result)
            return null;

        if (typeof data.result === "string")
            return data.result;

        if (data.result.url)
            return data.result.url;

        return null;
    });
}


/* Get actual Megaplay source */
function resolveMegaplay(embed) {
    if (!embed)
        return null;

    return fetch(embed, {
        headers: headers({
            "Referer": CONFIG.BASE_URL,
            "Origin": CONFIG.BASE_URL
        })
    })
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html)
            return null;

        var $ = cheerio.load(html);

        var id = $("[data-id]")
            .first()
            .attr("data-id");

        if (!id) {
            var m = html.match(
                /data-id=["'](\d+)["']/
            );

            id = m ? m[1] : null;
        }

        if (!id)
            return null;

        return fetch(
            "https://megaplay.buzz/stream/getSources?id=" +
            encodeURIComponent(id),
            {
                headers: {
                    "User-Agent": CONFIG.USER_AGENT,
                    "X-Requested-With":
                        "XMLHttpRequest",
                    "Referer": embed,
                    "Accept": "application/json"
                }
            }
        )
        .then(function(r) {
            return r.ok ? r.json() : null;
        });
    })
    .then(function(data) {
        if (!data || !data.sources)
            return null;

        var source =
            data.sources.file ||
            (
                data.sources[0] &&
                data.sources[0].file
            );

        if (!source)
            return null;

        return {
            url: source,
            headers: {
                "Referer":
                    "https://megaplay.buzz/",
                "Origin":
                    "https://megaplay.buzz"
            }
        };
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

    return tmdb(
        "/" +
        (mediaType === "tv" ? "tv/" : "movie/") +
        encodeURIComponent(tmdbId)
    )
    .then(function(data) {
        if (!data)
            return null;

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

        if (!title)
            return null;

        return search(title);
    })
    .then(function(result) {
        if (!result)
            return null;

        return getAnimeId(result.url)
            .then(function(animeId) {
                if (!animeId)
                    return null;

                /*
                 * MOVIE
                 */
                if (mediaType !== "tv") {
                    return getDubEpisode(
                        animeId,
                        episode
                    ).then(function(ep) {
                        if (!ep)
                            return null;

                        return {
                            ep: ep,
                            referer: result.url
                        };
                    });
                }

                /*
                 * TV
                 *
                 * First try to find an actual season page.
                 */
                return getSeasonUrl(
                    animeId,
                    season
                )
                .then(function(seasonUrl) {

                    /*
                     * Anikoto has this season.
                     *
                     * Example:
                     * Season 2 Episode 5
                     * -> Season 2 page
                     * -> Episode 5
                     */
                    if (seasonUrl) {
                        return getAnimeId(seasonUrl)
                            .then(function(seasonAnimeId) {
                                if (!seasonAnimeId)
                                    return null;

                                return getDubEpisode(
                                    seasonAnimeId,
                                    episode
                                ).then(function(ep) {
                                    if (!ep)
                                        return null;

                                    return {
                                        ep: ep,
                                        referer: seasonUrl
                                    };
                                });
                            });
                    }

                    /*
                     * No separate season page.
                     *
                     * Fall back to the ORIGINAL behavior:
                     *
                     * S1E500 -> 500
                     * S2E1   -> previous season episode count + 1
                     * S3E1   -> previous seasons + 1
                     */
                    return absoluteEpisode(
                        tmdbId,
                        season,
                        episode
                    )
                    .then(function(absolute) {
                        if (!absolute)
                            return null;

                        return getDubEpisode(
                            animeId,
                            absolute
                        ).then(function(ep) {
                            if (!ep)
                                return null;

                            return {
                                ep: ep,
                                referer: result.url
                            };
                        });
                    });
                });
            });
    })
    .then(function(data) {
        if (!data)
            return null;

        return getDubServer(
            data.ep.ids,
            data.referer
        ).then(function(linkId) {
            if (!linkId)
                return null;

            return {
                linkId: linkId,
                referer: data.referer
            };
        });
    })
    .then(function(data) {
        if (!data)
            return null;

        return getEmbed(
            data.linkId,
            data.referer
        );
    })
    .then(function(embed) {
        if (!embed)
            return null;

        return resolveMegaplay(embed);
    })
    .then(function(stream) {
        if (!stream)
            return [];

        return [{
            name: "AnikotoTV",
            title: "DUB",
            url: stream.url,
            headers: stream.headers || {}
        }];
    })
    .catch(function() {
        return [];
    });
}
function getSeasonUrl(animeId, season) {
    season = parseInt(season, 10) || 1;

    return fetch(
        CONFIG.BASE_URL +
        "/api/seasons/" +
        encodeURIComponent(animeId),
        {
            headers: ajaxHeaders()
        }
    )
    .then(function(r) {
        if (!r.ok)
            return null;

        return r.json();
    })
    .then(function(data) {
        if (!data || !data.result)
            return null;

        var $ = cheerio.load(data.result);

        var found = null;

        $(".season").each(function(i, el) {
            if (found)
                return;

            var a = $(el).find("a").first();

            if (!a.length)
                return;

            var name = a.find(".name").text().trim();

            var match = name.match(
                /^Season\s+(\d+)$/i
            );

            if (!match)
                return;

            if (
                parseInt(match[1], 10) !== season
            )
                return;

            var href = a.attr("href");

            if (!href)
                return;

            found =
                href.indexOf("http") === 0
                    ? href
                    : CONFIG.BASE_URL + href;
        });

        return found;
    })
    .catch(function() {
        return null;
    });
}
module.exports = {
    getStreams: getStreams
};