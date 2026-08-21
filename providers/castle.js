// newtv.js – Debug version with full logging

var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
var TMDB_BASE = "https://api.themoviedb.org/3";

// ⚠️ REPLACE THIS with a fresh token from the app
var CONFIG = {
    BASE: "https://tv.imgcdn.kim",
    REFERER: "https://net52.cc",
    UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
    USERTOKEN: "d945e9dc888dc22741a1eeb3abc489a5::9f4baa0702c2486030ff927d1d96dfdc::1787328769::db",
    OTT: "nf"
};

function log(msg) {
    console.log("[NewTV] " + msg);
}

function headers(extra) {
    var h = {
        "User-Agent": CONFIG.UA,
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "NetmirrorNewTV v1.0",
        "ott": CONFIG.OTT,
        "usertoken": CONFIG.USERTOKEN
    };
    if (extra) {
        for (var k in extra) {
            if (extra.hasOwnProperty(k)) h[k] = extra[k];
        }
    }
    return h;
}

function fetchJson(url, options) {
    options = options || {};
    log("fetchJson: " + url);
    return fetch(url, options)
        .then(function(res) {
            log("  status: " + res.status);
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
        })
        .then(function(data) {
            log("  response keys: " + Object.keys(data).join(", "));
            return data;
        });
}

function fetchText(url, options) {
    options = options || {};
    log("fetchText: " + url);
    return fetch(url, options)
        .then(function(res) {
            log("  status: " + res.status);
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.text();
        });
}

function getTmdbTitle(tmdbId, mediaType) {
    var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
    var url = TMDB_BASE + "/" + endpoint + "/" + tmdbId + "?api_key=" + TMDB_API_KEY;
    return fetchJson(url)
        .then(function(data) {
            var title = data.title || data.name;
            log("TMDB title: " + title);
            return title;
        });
}

function searchNewTV(query) {
    var url = CONFIG.BASE + "/newtv/search.php?s=" + encodeURIComponent(query);
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (!data || !data.searchResult) return [];
            log("Search results: " + data.searchResult.length);
            return data.searchResult;
        });
}

function getPost(id) {
    var url = CONFIG.BASE + "/newtv/post.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok") {
                log("Post status not ok: " + data.status);
                return null;
            }
            log("Post title: " + data.title);
            return data;
        });
}

function getPlayer(id) {
    var url = CONFIG.BASE + "/newtv/player.php?id=" + id;
    return fetchJson(url, { headers: headers() })
        .then(function(data) {
            if (data.status !== "ok" || !data.video_link) {
                log("Player status not ok or missing video_link");
                log("Player data: " + JSON.stringify(data));
                return null;
            }
            log("Player video_link: " + data.video_link.substring(0, 80) + "...");
            return data;
        });
}

function getM3U8Content(url, referer) {
    return fetchText(url, {
        headers: {
            "User-Agent": CONFIG.UA,
            "Referer": referer || CONFIG.REFERER,
            "X-Requested-With": "NetmirrorNewTV v1.0"
        }
    });
}

function parseM3U8(content) {
    var streams = [];
    var lines = content.split('\n');
    log("Parsing M3U8, lines: " + lines.length);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
            var streamInfo = line;
            var urlLine = '';
            var j = i + 1;
            while (j < lines.length) {
                var next = lines[j].trim();
                if (next && next.indexOf('#') !== 0) {
                    urlLine = next;
                    break;
                }
                j++;
            }
            if (urlLine) {
                var quality = 'Unknown';
                var resMatch = streamInfo.match(/RESOLUTION=(\d+x\d+)/);
                if (resMatch) {
                    var height = parseInt(resMatch[1].split('x')[1], 10);
                    if (height >= 1080) quality = '1080p';
                    else if (height >= 720) quality = '720p';
                    else if (height >= 480) quality = '480p';
                    else quality = resMatch[1];
                } else {
                    var bwMatch = streamInfo.match(/BANDWIDTH=(\d+)/);
                    if (bwMatch) {
                        var bw = parseInt(bwMatch[1], 10);
                        if (bw >= 1000000) quality = '1080p';
                        else if (bw >= 600000) quality = '720p';
                        else if (bw >= 400000) quality = '480p';
                        else quality = Math.round(bw / 1000) + 'k';
                    }
                }
                streams.push({ url: urlLine, quality: quality });
                log("  Found stream: " + quality);
            }
        }
    }
    return streams;
}

function getStreams(tmdbId, mediaType, season, episode) {
    if (!tmdbId) {
        return Promise.reject(new Error('No TMDB ID provided'));
    }
    log("START: " + tmdbId + " (" + mediaType + ")");

    var title, playerData, contentId;

    return getTmdbTitle(tmdbId, mediaType)
        .then(function(t) {
            title = t;
            return searchNewTV(title);
        })
        .then(function(results) {
            if (!results.length) throw new Error('No results found for "' + title + '"');
            var item = results[0];
            log("Selected: " + item.t + " (ID: " + item.id + ")");
            return getPost(item.id);
        })
        .then(function(post) {
            if (!post) throw new Error('Failed to get post info');
            contentId = post.main_id || post.id;
            log("Content ID for player: " + contentId);
            return getPlayer(contentId);
        })
        .then(function(player) {
            if (!player) throw new Error('Failed to get player info');
            playerData = player;
            log("Fetching M3U8...");
            return getM3U8Content(player.video_link, player.referer || CONFIG.REFERER);
        })
        .then(function(m3u8) {
            var streams = parseM3U8(m3u8);
            if (!streams.length) {
                log("No streams parsed, returning master M3U8");
                return [{
                    name: 'NewTV',
                    title: 'Master M3U8',
                    url: playerData.video_link,
                    quality: 'Auto',
                    headers: { Referer: playerData.referer || CONFIG.REFERER }
                }];
            }
            log("Returning " + streams.length + " streams");
            return streams.map(function(s) {
                return {
                    name: 'NewTV',
                    title: s.quality,
                    url: s.url,
                    quality: s.quality,
                    headers: { Referer: playerData.referer || CONFIG.REFERER }
                };
            });
        })
        .catch(function(err) {
            log("ERROR: " + err.message);
            throw err;
        });
}

module.exports = { getStreams: getStreams };