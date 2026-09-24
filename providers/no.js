/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Uses MAL mapping API for correct episode numbers
 */

"use strict";

var cheerio = require("cheerio-without-node-native");
var CryptoJS = require("crypto-js");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    MAPPING_API: "https://id-mapping-api-malid.hf.space/api/resolve",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

// ---- MegaPlay crypto constants (from decompiled AnikotoProvider) ----
var MEGAPLAY_TOKEN_KEY         = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var MEGAPLAY_TOKEN_LIFETIME    = 604800;
var MEGAPLAY_FALLBACK_KEY_SEED = "i?LMTAx0Q6,:}50U";
var MEGAPLAY_FALLBACK_IV_SEED  = "W0;27ToaUpl_P%'c";

var MEGAPLAY_HEX_IDS_RE  = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i;
var MEGAPLAY_KEY_PAIR_RE = /[A-Za-z]\w*="([^"]{16})",[A-Za-z]\w*="([^"]{16})"/;
var MEGAPLAY_FILE_RE     = /"file"\s*:\s*"([^"]+)"/;

// =========================================================================
// Crypto helpers (crypto-js)
// =========================================================================

function base64UrlToWordArray(b64url) {
    var b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return CryptoJS.enc.Base64.parse(b64);
}

function wordArrayToBase64Url(wa) {
    return CryptoJS.enc.Base64.stringify(wa)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function paddedWordArray(str, totalBytes) {
    var wa = CryptoJS.enc.Utf8.parse(str);
    var words = wa.words.slice(0);
    var neededWords = totalBytes / 4;
    while (words.length < neededWords) words.push(0);
    return CryptoJS.lib.WordArray.create(words, totalBytes);
}

function decryptMegaplayEnc(enc, keySeed, ivSeed) {
    try {
        var ct  = base64UrlToWordArray(enc);
        var key = paddedWordArray(keySeed, 32);
        var iv  = paddedWordArray(ivSeed, 16);

        var decrypted = CryptoJS.AES.decrypt(
            { ciphertext: ct },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );

        var text = decrypted.toString(CryptoJS.enc.Utf8);
        var m = MEGAPLAY_FILE_RE.exec(text);
        return m ? m[1] : null;
    } catch (e) {
        return null;
    }
}

function signMegaplayUrl(url) {
    var m = MEGAPLAY_HEX_IDS_RE.exec(url);
    if (!m) return url;

    var animeId   = m[1].toLowerCase();
    var episodeId = m[2].toLowerCase();
    var expires   = Math.floor(Date.now() / 1000) + MEGAPLAY_TOKEN_LIFETIME;
    var payload   = expires + "|" + animeId + "/" + episodeId;

    var sig = CryptoJS.HmacSHA256(payload, MEGAPLAY_TOKEN_KEY);

    var token = wordArrayToBase64Url(CryptoJS.enc.Utf8.parse(payload)) +
                "." +
                wordArrayToBase64Url(sig);

    var sep = url.indexOf("?") !== -1 ? "&" : "?";
    return url + sep + "token=" + token;
}

// =========================================================================
// HTTP helpers
// =========================================================================

function headers(extra) {
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

function ajaxHeaders(referer) {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
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

// =========================================================================
// TMDB helpers
// =========================================================================

function getImdbId(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "/external_ids?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) { return data && data.imdb_id ? data.imdb_id : null; })
        .catch(function() { return null; });
}

function getTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            return mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
        })
        .catch(function() { return null; });
}

function resolveMapping(imdbId, season, episode) {
    var url = CONFIG.MAPPING_API +
        "?id=" + encodeURIComponent(imdbId) +
        "&s=" + season +
        "&e=" + episode;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.error) return null;
            return data;
        })
        .catch(function() { return null; });
}

// =========================================================================
// AniKoto scraping
// =========================================================================

function searchAnime(title) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu")
        .replace(/ō/g, "ou")
        .replace(/ā/g, "aa")
        .replace(/ī/g, "ii")
        .replace(/ē/g, "ee");

    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);

    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {
                var $el = $(el);
                var a = $el.find("a.name.d-title, a[data-jp]").first();
                if (!a.length) return;

                var href = a.attr("href");
                var t = (a.attr("data-jp") || a.text() || "").trim();
                if (!href || !t) return;

                results.push({
                    title: t,
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    isMovie: /movie|film|special|ova/i.test(t)
                });
            });

            if (results.length === 0) return null;

            var q = normalize(searchTitle);
            var best = null;
            var bestScore = -999;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var t = normalize(r.title);
                var score = 0;

                if (t === q) score = 100;
                else if (t.indexOf(q) !== -1) score = 70;
                else if (q.indexOf(t) !== -1) score = 40;

                if (!r.isMovie) score += 20;
                if (r.isMovie) score -= 30;

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            }

            return best || results[0];
        })
        .catch(function() { return null; });
}

function getAnimeId(url) {
    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return null;
            var $ = cheerio.load(html);
            var id = $("[data-id]").first().attr("data-id");
            if (id) return id;
            var m = html.match(/data-id=["'](\d+)["']/);
            return m ? m[1] : null;
        })
        .catch(function() { return null; });
}

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            var found = null;
            $("a[data-ids]").each(function(i, el) {
                if (found) return;
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                if (num === episodeNum && a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });
            return found;
        })
        .catch(function() { return null; });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);
    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            return $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id") || null;
        })
        .catch(function() { return null; });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);
    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            if (typeof data.result === "string") return data.result;
            if (data.result.url) return data.result.url;
            return null;
        })
        .catch(function() { return null; });
}

// =========================================================================
// MegaPlay resolver — rewritten for AES-256-CBC + HMAC
// =========================================================================

function fetchMegaplayKeySeeds(baseUrl) {
    return fetch(baseUrl + "/lib/newclient.min.js", { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(js) {
            if (!js) return null;
            var m = MEGAPLAY_KEY_PAIR_RE.exec(js);
            return m ? [m[1], m[2]] : null;
        })
        .catch(function() { return null; });
}

function resolveMegaplay(embed) {
    if (!embed) return Promise.resolve(null);

    if (embed.indexOf("autostart") === -1) {
        embed += (embed.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
    }

    // Primary API host from embed URL
    var hostMatch = embed.match(/^https?:\/\/([^\/]+)/);
    var primaryHost = hostMatch ? "https://" + hostMatch[1] : "https://megaplay.buzz";

    return fetch(embed, {
        headers: headers({
            "Referer": CONFIG.BASE_URL,
            "Origin": CONFIG.BASE_URL
        })
    })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(html) {
        if (!html) return null;

        // streamId
        var sm = html.match(/data-id=["'](\d+)["']/) ||
                 html.match(/data-realid=["'](\d+)["']/) ||
                 embed.match(/\/stream\/s-\d+\/(\d+)\//);
        if (!sm) return null;
        var streamId = sm[1];

        // asset domain (for Origin header only)
        var dm = html.match(/data-domain=["']([^"']+)["']/);
        var assetOrigin = dm ? "https://" + dm[1] : primaryHost;

        var audioType = embed.indexOf("/dub") !== -1 ? "dub" : "sub";

        // Try api hosts in order (primary first, then asset origin if different)
        var apiHosts = [primaryHost];
        if (assetOrigin !== primaryHost) apiHosts.push(assetOrigin);

        function tryOne(apiHost, endpoint) {
            var url = apiHost + "/stream/" + endpoint +
                      "?id=" + streamId + "&type=" + audioType;
            return fetch(url, {
                headers: {
                    "User-Agent": CONFIG.USER_AGENT,
                    "Accept": "*/*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": assetOrigin,
                    "Referer": embed
                }
            })
            .then(function(r) { return r.ok ? r.json() : null; })
            .catch(function() { return null; });
        }

        function tryAll(hIdx, eIdx) {
            if (hIdx >= apiHosts.length) return Promise.resolve(null);
            if (eIdx >= 2) return tryAll(hIdx + 1, 0);
            var endpoint = eIdx === 0 ? "getSourcesNew" : "getSources";
            return tryOne(apiHosts[hIdx], endpoint).then(function(d) {
                return d || tryAll(hIdx, eIdx + 1);
            });
        }

        return tryAll(0, 0);
    })
    .then(function(data) {
        if (!data) return null;

        var payload = data.result || data;

        // Plain file branch
        var plainFile = null;
        if (payload.sources) {
            if (typeof payload.sources === "string") plainFile = payload.sources;
            else if (payload.sources.file) plainFile = payload.sources.file;
            else if (Array.isArray(payload.sources) &&
                     payload.sources[0] && payload.sources[0].file)
                plainFile = payload.sources[0].file;
        }

        if (plainFile) {
            return {
                url: signMegaplayUrl(plainFile),
                headers: {
                    "Referer": "https://megaplay.buzz/",
                    "Origin": "https://megaplay.buzz"
                }
            };
        }

        // Encrypted branch — try dynamic seeds then fallback
        if (payload.enc) {
            return fetchMegaplayKeySeeds(primaryHost).then(function(dynamic) {
                var seeds = [];
                if (dynamic) seeds.push(dynamic);
                seeds.push([MEGAPLAY_FALLBACK_KEY_SEED, MEGAPLAY_FALLBACK_IV_SEED]);

                for (var i = 0; i < seeds.length; i++) {
                    var m3u8 = decryptMegaplayEnc(payload.enc, seeds[i][0], seeds[i][1]);
                    if (m3u8) {
                        return {
                            url: signMegaplayUrl(m3u8),
                            headers: {
                                "Referer": "https://megaplay.buzz/",
                                "Origin": "https://megaplay.buzz"
                            }
                        };
                    }
                }
                return null;
            });
        }

        return null;
    })
    .catch(function() { return null; });
}

// =========================================================================
// Entry point
// =========================================================================

function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) return [];

            return getImdbId(tmdbId, mediaType)
                .then(function(imdbId) {
                    var mappedEpisode = episode;

                    var mappingPromise = imdbId
                        ? resolveMapping(imdbId, season, episode)
                        : Promise.resolve(null);

                    return mappingPromise.then(function(mapping) {
                        if (mapping && mapping.mal_episode) {
                            mappedEpisode = mapping.mal_episode;
                        }

                        return searchAnime(title).then(function(best) {
                            if (!best) return [];

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) return [];

                                return getDubEpisode(animeId, mappedEpisode, best.url)
                                    .then(function(ep) {
                                        if (!ep) return [];

                                        return getDubServer(ep.ids, best.url)
                                            .then(function(linkId) {
                                                if (!linkId) return [];
                                                return getEmbed(linkId, best.url);
                                            })
                                            .then(function(embed) {
                                                if (!embed || embed.indexOf("megaplay") === -1) return [];
                                                return resolveMegaplay(embed);
                                            })
                                            .then(function(stream) {
                                                if (!stream) return [];
                                                return [{
                                                    name: "AnikotoTV",
                                                    title: "1080p DUB",
                                                    url: stream.url,
                                                    quality: "1080p",
                                                    headers: stream.headers
                                                }];
                                            });
                                    });
                            });
                        });
                    });
                });
        })
        .catch(function() {
            return [];
        });
}

module.exports = { getStreams };