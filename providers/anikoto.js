"use strict";

var CONFIG = {
    BASE_URL: "https://anikototv.to",
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

    if (season === 1)
        return Promise.resolve(episode);

    var req = [];

    for (var s = 1; s < season; s++) {
        req.push(tmdb("/tv/" + id + "/season/" + s));
    }

    return Promise.all(req).then(function(list) {
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
            headers: {
                "User-Agent": CONFIG.UA
            }
        }
    )
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html) return null;

        var m = html.match(
            /<div[^>]*class=["'][^"']*\bitem\b[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["']/i
        );

        if (!m) return null;

        return m[1].indexOf("http") === 0
            ? m[1]
            : CONFIG.BASE_URL + m[1];
    });
}


/* Get Anikoto anime ID */
function getAnimeId(url) {
    return fetch(url, {
        headers: {
            "User-Agent": CONFIG.UA
        }
    })
    .then(function(r) {
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html) return null;

        var m = html.match(
            /data-id=["'](\d+)["']/
        );

        return m ? m[1] : null;
    });
}


/* Get DUB episode data-ids */
function getEpisode(animeId, number) {
    return fetch(
        CONFIG.BASE_URL +
        "/ajax/episode/list/" +
        animeId +
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
            if (parseInt(m[1], 10) === number) {
                return {
                    number: number,
                    ids: m[2]
                };
            }
        }

        return null;
    });
}


/* Get server link */
function getServer(ids) {
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
            /data-link-id=["']([^"']+)["']/
        );

        return m ? m[1] : null;
    });
}


/* Get embed */
function getEmbed(linkId) {
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
        if (!data) return null;

        if (typeof data.result === "string")
            return data.result;

        return data.result && data.result.url
            ? data.result.url
            : null;
    });
}


/* Resolve Megaplay */
function resolveMegaplay(embed) {
    if (!embed) return null;

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
        if (!html) return null;

        var m = html.match(
            /data-id=["'](\d+)["']/
        );

        if (!m) return null;

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
        );
    })
    .then(function(r) {
        return r && r.ok ? r.json() : null;
    })
    .then(function(data) {
        if (!data || !data.sources)
            return null;

        var source = data.sources.file ||
            (
                data.sources[0] &&
                data.sources[0].file
            );

        if (!source)
            return null;

        return {
            url: source,
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        };
    });
}


function getStreams(tmdbId, mediaType, season, episode) {

    if (mediaType !== "tv") {
        season = 1;
        episode = 1;
    }

    return tmdb(
        "/" +
        (mediaType === "tv" ? "tv/" : "movie/") +
        encodeURIComponent(tmdbId)
    )
    .then(function(data) {

        var title =
            mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);

        if (!title)
            return [];

        return Promise.all([
            absoluteEpisode(
                tmdbId,
                season,
                episode
            ),
            search(title)
        ]);
    })
    .then(function(x) {

        if (!x || !x[0] || !x[1])
            return [];

        var absolute = x[0];
        var animeUrl = x[1];

        return getAnimeId(animeUrl)
            .then(function(animeId) {

                if (!animeId)
                    return null;

                return getEpisode(
                    animeId,
                    absolute
                );
            });
    })
    .then(function(ep) {

        if (!ep)
            return null;

        return getServer(ep.ids);
    })
    .then(function(linkId) {

        if (!linkId)
            return null;

        return getEmbed(linkId);
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
            quality: stream.quality || "",
            headers: stream.headers || {}
        }];
    })
    .catch(function() {
        return [];
    });
}


module.exports = {
    getStreams: getStreams
};