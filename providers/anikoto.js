"use strict";

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_BASE: "https://api.themoviedb.org/3",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    UA: "Mozilla/5.0 (Linux; Android 12; SM-M025F)"
};

function tmdb(path) {
    return fetch(
        CONFIG.TMDB_BASE + path +
        (path.indexOf("?") >= 0 ? "&" : "?") +
        "api_key=" + encodeURIComponent(CONFIG.TMDB_API_KEY)
    ).then(function(r) {
        return r.ok ? r.json() : null;
    });
}

function absoluteEpisode(id, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    if (season <= 1)
        return Promise.resolve(episode);

    var requests = [];

    for (var s = 1; s < season; s++) {
        requests.push(
            tmdb("/tv/" + encodeURIComponent(id) + "/season/" + s)
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

function getStreams(tmdbId, mediaType, season, episode) {
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

        var title = mediaType === "tv"
            ? (data.name || data.original_name)
            : (data.title || data.original_title);

        return Promise.all([
            title,
            absoluteEpisode(tmdbId, season, episode)
        ]);
    })
    .then(function(x) {
        if (!x || !x[0] || !x[1])
            return null;

        return fetch(
            CONFIG.BASE_URL +
            "/filter?keyword=" +
            encodeURIComponent(x[0]),
            { headers: { "User-Agent": CONFIG.UA } }
        )
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html)
                return null;

            var m = html.match(
                /<a[^>]+href=["']([^"']+)["'][^>]*>/
            );

            if (!m)
                return null;

            return m[1].indexOf("http") === 0
                ? m[1]
                : CONFIG.BASE_URL + m[1];
        })
        .then(function(url) {
            if (!url)
                return null;

            return fetch(url, {
                headers: { "User-Agent": CONFIG.UA }
            })
            .then(function(r) {
                return r.ok ? r.text() : null;
            });
        })
        .then(function(html) {
            if (!html)
                return null;

            var m = html.match(
                /data-id=["'](\d+)["']/
            );

            return m
                ? {
                    id: m[1],
                    absolute: x[1]
                }
                : null;
        });
    })
    .then(function(anime) {
        if (!anime)
            return null;

        return fetch(
            CONFIG.BASE_URL +
            "/ajax/episode/list/" +
            anime.id +
            "?vrf=",
            {
                headers: {
                    "User-Agent": CONFIG.UA,
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01"
                }
            }
        )
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result)
                return null;

            var re =
                /<a\b[^>]*data-num=["'](\d+)["'][^>]*data-dub=["']1["'][^>]*data-ids=["']([^"']+)["']/g;

            var m;

            while ((m = re.exec(data.result))) {
                if (parseInt(m[1], 10) === anime.absolute) {
                    return m[2];
                }
            }

            return null;
        });
    })
    .then(function(ids) {
        if (!ids)
            return null;

        return fetch(
            CONFIG.BASE_URL +
            "/ajax/server/list?servers=" +
            encodeURIComponent(ids),
            {
                headers: {
                    "User-Agent": CONFIG.UA,
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01"
                }
            }
        )
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result)
                return null;

            var m = data.result.match(
                /<div[^>]+data-type=["']dub["'][\s\S]*?<li[^>]+data-link-id=["']([^"']+)["']/i
            );

            return m ? m[1] : null;
        });
    })
    .then(function(linkId) {
        if (!linkId)
            return null;

        return fetch(
            CONFIG.BASE_URL +
            "/ajax/server?get=" +
            encodeURIComponent(linkId),
            {
                headers: {
                    "User-Agent": CONFIG.UA,
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01"
                }
            }
        )
        .then(function(r) {
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result)
                return null;

            return typeof data.result === "string"
                ? data.result
                : data.result.url;
        });
    })
    .then(function(embed) {
        if (!embed)
            return null;

        return fetch(embed, {
            headers: {
                "User-Agent": CONFIG.UA,
                "Referer": CONFIG.BASE_URL,
                "Origin": CONFIG.BASE_URL
            }
        })
        .then(function(r) {
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html)
                return null;

            var m = html.match(
                /data-id=["'](\d+)["']/
            );

            if (!m)
                return null;

            return fetch(
                "https://megaplay.buzz/stream/getSources?id=" +
                m[1],
                {
                    headers: {
                        "User-Agent": CONFIG.UA,
                        "X-Requested-With": "XMLHttpRequest",
                        "Referer": embed,
                        "Accept": "application/json"
                    }
                }
            )
            .then(function(r) {
                return r.ok ? r.json() : null;
            });
        });
    })
    .then(function(data) {
        if (!data || !data.sources)
            return [];

        var source = data.sources.file ||
            (data.sources[0] && data.sources[0].file);

        if (!source)
            return [];

        return [{
            name: "AnikotoTV",
            title: "DUB",
            url: source,
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        }];
    })
    .catch(function() {
        return [];
    });
}

module.exports = {
    getStreams: getStreams
};