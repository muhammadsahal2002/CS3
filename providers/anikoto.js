/**
 * AnikotoTV - Single file version (no build needed)
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36",
    TIMEOUT: 25000
};

function getHeaders(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    };
    if (extra) {
        for (var k in extra) h[k] = extra[k];
    }
    return h;
}

function getAjaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": referer || CONFIG.BASE_URL
    };
}

function fetchText(url, headers) {
    return fetch(url, { headers: headers || getHeaders() })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
        });
}

function fetchJson(url, headers) {
    return fetch(url, { headers: headers || getHeaders() })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        });
}

// ==================== SEARCH ====================
function searchAnime(query) {
    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(query);
    console.log("[AnikotoTV] Searching: " + url);

    return fetchText(url).then(function(html) {
        var $ = cheerio.load(html);
        var results = [];

        $("div.item").each(function(i, el) {
            var $el = $(el);
            var titleEl = $el.find("a.name.d-title, a[data-jp]").first();
            if (!titleEl.length) return;

            var href = titleEl.attr("href");
            var title = (titleEl.attr("data-jp") || titleEl.text() || "").trim();
            if (!href || !title) return;

            results.push({
                title: title,
                url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href
            });
        });

        console.log("[AnikotoTV] Found " + results.length + " results");
        return results;
    }).catch(function(err) {
        console.log("[AnikotoTV] Search error: " + err.message);
        return [];
    });
}

// ==================== EPISODES ====================
function getEpisodes(animeId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
    console.log("[AnikotoTV] Getting episodes: " + url);

    return fetchText(url, getAjaxHeaders(referer)).then(function(jsonText) {
        var data = JSON.parse(jsonText);
        if (!data || data.status !== 200 || !data.result) return [];

        var $ = cheerio.load(data.result);
        var episodes = [];

        $("a[data-ids]").each(function(i, el) {
            var $el = $(el);
            var ids = $el.attr("data-ids");
            var num = parseInt($el.attr("data-num") || "0", 10);
            var hasSub = $el.attr("data-sub") === "1";
            var hasDub = $el.attr("data-dub") === "1";
            var name = $el.closest("li").attr("title") || ("Episode " + num);

            if (!ids) return;

            if (hasSub) {
                episodes.push({ number: num, type: "sub", ids: ids, name: name, referer: referer });
            }
            if (hasDub) {
                episodes.push({ number: num, type: "dub", ids: ids, name: name + " (Dub)", referer: referer });
            }
        });

        console.log("[AnikotoTV] Episodes found: " + episodes.length);
        return episodes;
    }).catch(function(err) {
        console.log("[AnikotoTV] Episodes error: " + err.message);
        return [];
    });
}

// ==================== GET ONE STREAM ====================
function getOneStream(ep) {
    console.log("[AnikotoTV] Getting stream for " + ep.type);

    var listUrl = CONFIG.BASE_URL + "/ajax/server/list?servers=" + ep.ids;

    return fetchText(listUrl, getAjaxHeaders(ep.referer)).then(function(jsonText) {
        var data = JSON.parse(jsonText);
        if (!data || data.status !== 200 || !data.result) return null;

        var $ = cheerio.load(data.result);
        var selector = ep.type === "dub"
            ? 'div.type[data-type="dub"] li[data-link-id]'
            : 'div.type[data-type="sub"] li[data-link-id], div.type[data-type="hsub"] li[data-link-id]';

        var linkId = null;
        $(selector).each(function(i, el) {
            if (!linkId) linkId = $(el).attr("data-link-id");
        });

        if (!linkId) {
            // fallback
            $("li[data-link-id]").each(function(i, el) {
                if (!linkId) linkId = $(el).attr("data-link-id");
            });
        }

        if (!linkId) {
            console.log("[AnikotoTV] No linkId found");
            return null;
        }

        var serverUrl = CONFIG.BASE_URL + "/ajax/server?get=" + linkId;
        return fetchText(serverUrl, getAjaxHeaders(ep.referer));
    }).then(function(jsonText) {
        if (!jsonText) return null;

        var data = JSON.parse(jsonText);
        var embedUrl = null;

        if (data && data.status === 200 && data.result) {
            if (typeof data.result === "string") embedUrl = data.result;
            else if (data.result.url) embedUrl = data.result.url;
        }

        if (!embedUrl || embedUrl.indexOf("megaplay") === -1) {
            console.log("[AnikotoTV] No megaplay embed");
            return null;
        }

        console.log("[AnikotoTV] Embed: " + embedUrl);
        return extractMegaPlay(embedUrl);
    }).catch(function(err) {
        console.log("[AnikotoTV] getOneStream error: " + err.message);
        return null;
    });
}

// ==================== MEGAPLAY ====================
function extractMegaPlay(embedUrl) {
    if (embedUrl.indexOf("autostart=true") === -1) {
        embedUrl += (embedUrl.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
    }

    return fetchText(embedUrl, getHeaders({
        "Referer": CONFIG.BASE_URL,
        "Origin": CONFIG.BASE_URL
    })).then(function(html) {
        var match = html.match(/data-id=["'](\d+)["']/);
        if (!match) {
            console.log("[AnikotoTV] No data-id");
            return null;
        }

        var sourcesUrl = "https://megaplay.buzz/stream/getSources?id=" + match[1];
        console.log("[AnikotoTV] Sources: " + sourcesUrl);

        return fetchJson(sourcesUrl, {
            "User-Agent": CONFIG.USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": embedUrl,
            "Accept": "application/json"
        });
    }).then(function(sources) {
        if (!sources || !sources.sources) return null;

        var videoUrl = null;
        if (sources.sources.file) {
            videoUrl = sources.sources.file;
        } else if (Array.isArray(sources.sources) && sources.sources[0]) {
            videoUrl = sources.sources[0].file;
        }

        if (!videoUrl) return null;

        console.log("[AnikotoTV] Got stream: " + videoUrl);
        return {
            url: videoUrl,
            quality: "1080p",
            headers: {
                "Referer": "https://megaplay.buzz/",
                "Origin": "https://megaplay.buzz"
            }
        };
    }).catch(function(err) {
        console.log("[AnikotoTV] MegaPlay error: " + err.message);
        return null;
    });
}

// ==================== LOAD ANIME ====================
function loadAnime(watchUrl) {
    console.log("[AnikotoTV] Loading: " + watchUrl);

    return fetchText(watchUrl).then(function(html) {
        var $ = cheerio.load(html);
        var title = $("h1.title, h1[itemprop=name], h1").first().text().trim();
        if (!title) return null;

        var animeId = $("[data-id]").first().attr("data-id");
        if (!animeId) {
            var m = html.match(/data-id=["'](\d+)["']/);
            animeId = m ? m[1] : null;
        }
        if (!animeId) {
            console.log("[AnikotoTV] No animeId");
            return null;
        }

        console.log("[AnikotoTV] AnimeID: " + animeId + " | " + title);
        return getEpisodes(animeId, watchUrl).then(function(episodes) {
            return { title: title, episodes: episodes, url: watchUrl };
        });
    }).catch(function(err) {
        console.log("[AnikotoTV] loadAnime error: " + err.message);
        return null;
    });
}

// ==================== MAIN ====================
function getStreams(tmdbId, mediaType, season, episode) {
    console.log("[AnikotoTV] === START === " + tmdbId + " " + mediaType + " S" + season + "E" + episode);

    var searchTitle = String(tmdbId);
    var epNum = episode || 1;

    // Try TMDB first
    var tmdbUrl = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetchJson(tmdbUrl).then(function(data) {
        if (data) {
            searchTitle = mediaType === "tv" ? (data.name || searchTitle) : (data.title || searchTitle);
            console.log("[AnikotoTV] TMDB: " + searchTitle);
        }
        return searchAnime(searchTitle);
    }).catch(function() {
        return searchAnime(searchTitle);
    }).then(function(results) {
        if (!results || results.length === 0) {
            console.log("[AnikotoTV] No search results");
            return [];
        }

        var best = results[0];
        console.log("[AnikotoTV] Using: " + best.title);
        return loadAnime(best.url);
    }).then(function(anime) {
        if (!anime || !anime.episodes || anime.episodes.length === 0) {
            console.log("[AnikotoTV] No episodes");
            return [];
        }

        var targets = anime.episodes.filter(function(e) {
            return e.number === epNum;
        });

        if (targets.length === 0) {
            targets = [anime.episodes[0]];
        }

        console.log("[AnikotoTV] Targets: " + targets.map(function(t) { return t.type; }).join(", "));

        // Get streams one by one (safer for the app)
        var streams = [];
        var chain = Promise.resolve();

        targets.forEach(function(ep) {
            chain = chain.then(function() {
                return getOneStream(ep).then(function(link) {
                    if (link) {
                        streams.push({
                            name: "AnikotoTV",
                            title: (link.quality || "1080p") + " " + ep.type.toUpperCase(),
                            url: link.url,
                            quality: link.quality || "1080p",
                            headers: link.headers || {}
                        });
                    }
                });
            });
        });

        return chain.then(function() {
            console.log("[AnikotoTV] === DONE === " + streams.length + " streams");
            return streams;
        });
    }).catch(function(err) {
        console.log("[AnikotoTV] Fatal: " + err.message);
        return [];
    });
}

module.exports = { getStreams };