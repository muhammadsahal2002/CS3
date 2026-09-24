/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Uses MAL mapping API for correct episode numbers
 * Debug logs prefixed with [AnikotoTV] for easy filtering
 */

"use strict";

var cheerio = require("cheerio-without-node-native");
var CryptoJS = require("crypto-js");

var LOG = "[AnikotoTV]";
function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG);
    console.log.apply(console, args);
}
function logErr() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG, "ERROR");
    console.error.apply(console, args);
}

log("=== provider file loaded ===");

var CONFIG = {
    BASE_URL: "https://anikoto.cz",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    MAPPING_API: "https://id-mapping-api-malid.hf.space/api/resolve",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

// ---- MegaPlay crypto constants ----
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
        log("  decrypt: enc length =", enc.length);
        var ct  = base64UrlToWordArray(enc);
        log("  decrypt: ct sigBytes =", ct.sigBytes);
        var key = paddedWordArray(keySeed, 32);
        var iv  = paddedWordArray(ivSeed, 16);
        log("  decrypt: key hex =", key.toString(CryptoJS.enc.Hex).slice(0, 32) + "...");
        log("  decrypt: iv hex  =", iv.toString(CryptoJS.enc.Hex));

        var decrypted = CryptoJS.AES.decrypt(
            { ciphertext: ct },
            key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );

        var text = decrypted.toString(CryptoJS.enc.Utf8);
        log("  decrypt: plaintext (first 200) =", JSON.stringify(text.slice(0, 200)));

        var m = MEGAPLAY_FILE_RE.exec(text);
        if (m) {
            log("  decrypt: SUCCESS ->", m[1]);
            return m[1];
        }
        log("  decrypt: no 'file' key in plaintext");
        return null;
    } catch (e) {
        logErr("  decrypt exception:", e.message);
        return null;
    }
}

function signMegaplayUrl(url) {
    var m = MEGAPLAY_HEX_IDS_RE.exec(url);
    if (!m) {
        log("  sign: URL has no hex IDs, returning as-is");
        return url;
    }

    var animeId   = m[1].toLowerCase();
    var episodeId = m[2].toLowerCase();
    var expires   = Math.floor(Date.now() / 1000) + MEGAPLAY_TOKEN_LIFETIME;
    var payload   = expires + "|" + animeId + "/" + episodeId;

    var sig = CryptoJS.HmacSHA256(payload, MEGAPLAY_TOKEN_KEY);

    var token = wordArrayToBase64Url(CryptoJS.enc.Utf8.parse(payload)) +
                "." +
                wordArrayToBase64Url(sig);

    log("  sign: expires =", expires);
    log("  sign: payload =", payload);
    log("  sign: token   =", token.slice(0, 80) + "...");

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
    if (extra) { for (var k in extra) h[k] = extra[k]; }
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
        .then(function(data) {
            var id = data && data.imdb_id ? data.imdb_id : null;
            log("  tmdb: imdbId =", id);
            return id;
        })
        .catch(function(e) { logErr("  tmdb imdbId failed:", e.message); return null; });
}

function getTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) { log("  tmdb: no title data"); return null; }
            var t = mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
            log("  tmdb: title =", t);
            return t;
        })
        .catch(function(e) { logErr("  tmdb title failed:", e.message); return null; });
}

function resolveMapping(imdbId, season, episode) {
    var url = CONFIG.MAPPING_API +
        "?id=" + encodeURIComponent(imdbId) +
        "&s=" + season +
        "&e=" + episode;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || data.error) { log("  mapping: no mapping found"); return null; }
            log("  mapping:", JSON.stringify(data).slice(0, 200));
            return data;
        })
        .catch(function(e) { logErr("  mapping failed:", e.message); return null; });
}

// =========================================================================
// AniKoto scraping
// =========================================================================

function searchAnime(title) {
    var searchTitle = String(title || "")
        .replace(/ū/g, "uu").replace(/ō/g, "ou").replace(/ā/g, "aa")
        .replace(/ī/g, "ii").replace(/ē/g, "ee");

    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);
    log("  search: url =", url);

    return fetch(url, { headers: headers() })
        .then(function(r) {
            log("  search: HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) { logErr("  search: empty HTML"); return null; }
            log("  search: html length =", html.length);

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

            log("  search: found", results.length, "results");
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
                if (score > bestScore) { bestScore = score; best = r; }
            }

            log("  search: best =", JSON.stringify(best));
            return best || results[0];
        })
        .catch(function(e) { logErr("  search failed:", e.message); return null; });
}

function getAnimeId(url) {
    log("  animeId: fetching", url);
    return fetch(url, { headers: headers() })
        .then(function(r) {
            log("  animeId: HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) { logErr("  animeId: empty HTML"); return null; }
            var $ = cheerio.load(html);
            var id = $("[data-id]").first().attr("data-id");
            if (id) { log("  animeId: found via cheerio =", id); return id; }
            var m = html.match(/data-id=["'](\d+)["']/);
            if (m) { log("  animeId: found via regex =", m[1]); return m[1]; }
            logErr("  animeId: not found");
            return null;
        })
        .catch(function(e) { logErr("  animeId failed:", e.message); return null; });
}

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
    log("  dubEp: fetching episode", episodeNum, "url =", url);

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            log("  dubEp: HTTP", r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result) { logErr("  dubEp: no result"); return null; }
            log("  dubEp: result length =", data.result.length);

            var $ = cheerio.load(data.result);
            var found = null;
            var available = [];

            $("a[data-ids]").each(function(i, el) {
                var a = $(el);
                var num = parseInt(a.attr("data-num") || "0", 10);
                var hasDub = a.attr("data-dub") === "1";
                if (hasDub) available.push(num);
                if (num === episodeNum && hasDub && a.attr("data-ids")) {
                    found = { ids: a.attr("data-ids"), number: num };
                }
            });

            log("  dubEp: available dub episodes =", available.slice(0, 20).join(","), "...");
            if (found) {
                log("  dubEp: FOUND ep", episodeNum, "ids length =", found.ids.length);
            } else {
                logErr("  dubEp: episode", episodeNum, "not found in dub list");
            }
            return found;
        })
        .catch(function(e) { logErr("  dubEp failed:", e.message); return null; });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);
    log("  dubSrv: fetching server list");

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            log("  dubSrv: HTTP", r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result) { logErr("  dubSrv: no result"); return null; }
            var $ = cheerio.load(data.result);
            var linkId = $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id");
            if (linkId) {
                log("  dubSrv: linkId =", linkId.slice(0, 40) + "...");
            } else {
                logErr("  dubSrv: no dub link-id found");
            }
            return linkId || null;
        })
        .catch(function(e) { logErr("  dubSrv failed:", e.message); return null; });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);
    log("  embed: fetching");

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) {
            log("  embed: HTTP", r.status);
            return r.ok ? r.json() : null;
        })
        .then(function(data) {
            if (!data || !data.result) { logErr("  embed: no result"); return null; }
            var embed = typeof data.result === "string" ? data.result
                      : (data.result.url ? data.result.url : null);
            log("  embed: url =", embed);
            return embed;
        })
        .catch(function(e) { logErr("  embed failed:", e.message); return null; });
}

// =========================================================================
// MegaPlay resolver
// =========================================================================

function fetchMegaplayKeySeeds(baseUrl) {
    log("  seeds: fetching", baseUrl + "/lib/newclient.min.js");
    return fetch(baseUrl + "/lib/newclient.min.js", { headers: headers() })
        .then(function(r) {
            log("  seeds: HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .then(function(js) {
            if (!js) { log("  seeds: no js"); return null; }
            var m = MEGAPLAY_KEY_PAIR_RE.exec(js);
            if (m) {
                log("  seeds: dynamic =", JSON.stringify([m[1], m[2]]));
                return [m[1], m[2]];
            }
            log("  seeds: no dynamic match in js");
            return null;
        })
        .catch(function(e) { logErr("  seeds failed:", e.message); return null; });
}

function resolveMegaplay(embed) {
    if (!embed) { logErr("resolveMegaplay: no embed URL"); return Promise.resolve(null); }

    if (embed.indexOf("autostart") === -1) {
        embed += (embed.indexOf("?") === -1 ? "?" : "&") + "autostart=true";
    }

    log("resolveMegaplay: embed =", embed);

    var hostMatch = embed.match(/^https?:\/\/([^\/]+)/);
    var primaryHost = hostMatch ? "https://" + hostMatch[1] : "https://megaplay.buzz";
    log("resolveMegaplay: primaryHost =", primaryHost);

    return fetch(embed, {
        headers: headers({ "Referer": CONFIG.BASE_URL, "Origin": CONFIG.BASE_URL })
    })
    .then(function(r) {
        log("resolveMegaplay: embed HTTP", r.status);
        return r.ok ? r.text() : null;
    })
    .then(function(html) {
        if (!html) { logErr("resolveMegaplay: empty embed html"); return null; }
        log("resolveMegaplay: html length =", html.length);

        var sm = html.match(/data-id=["'](\d+)["']/) ||
                 html.match(/data-realid=["'](\d+)["']/) ||
                 embed.match(/\/stream\/s-\d+\/(\d+)\//);
        if (!sm) { logErr("resolveMegaplay: no streamId"); return null; }
        var streamId = sm[1];
        log("resolveMegaplay: streamId =", streamId);

        var dm = html.match(/data-domain=["']([^"']+)["']/);
        var assetOrigin = dm ? "https://" + dm[1] : primaryHost;
        log("resolveMegaplay: assetOrigin =", assetOrigin);

        var audioType = embed.indexOf("/dub") !== -1 ? "dub" : "sub";
        log("resolveMegaplay: audioType =", audioType);

        var apiHosts = [primaryHost];
        if (assetOrigin !== primaryHost) apiHosts.push(assetOrigin);

        function tryOne(apiHost, endpoint) {
            var url = apiHost + "/stream/" + endpoint +
                      "?id=" + streamId + "&type=" + audioType;
            log("resolveMegaplay: GET", url);
            return fetch(url, {
                headers: {
                    "User-Agent": CONFIG.USER_AGENT,
                    "Accept": "*/*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": assetOrigin,
                    "Referer": embed
                }
            })
            .then(function(r) {
                log("  ->", endpoint, "on", apiHost, "HTTP", r.status);
                return r.ok ? r.json() : null;
            })
            .catch(function(e) { logErr("  ->", endpoint, "failed:", e.message); return null; });
        }

        function tryAll(hIdx, eIdx) {
            if (hIdx >= apiHosts.length) { logErr("resolveMegaplay: all hosts exhausted"); return Promise.resolve(null); }
            if (eIdx >= 2) return tryAll(hIdx + 1, 0);
            var endpoint = eIdx === 0 ? "getSourcesNew" : "getSources";
            return tryOne(apiHosts[hIdx], endpoint).then(function(d) {
                return d || tryAll(hIdx, eIdx + 1);
            });
        }

        return tryAll(0, 0);
    })
    .then(function(data) {
        if (!data) { logErr("resolveMegaplay: no sources data"); return null; }
        log("resolveMegaplay: response keys =", Object.keys(data).join(","));

        var payload = data.result || data;
        log("resolveMegaplay: payload keys =", Object.keys(payload).join(","));

        var plainFile = null;
        if (payload.sources) {
            if (typeof payload.sources === "string") plainFile = payload.sources;
            else if (payload.sources.file) plainFile = payload.sources.file;
            else if (Array.isArray(payload.sources) &&
                     payload.sources[0] && payload.sources[0].file)
                plainFile = payload.sources[0].file;
        }

        if (plainFile) {
            log("resolveMegaplay: plain file =", plainFile);
            return {
                url: signMegaplayUrl(plainFile),
                headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" }
            };
        }

        if (payload.enc) {
            log("resolveMegaplay: encrypted, enc length =", payload.enc.length);
            return fetchMegaplayKeySeeds(primaryHost).then(function(dynamic) {
                var seeds = [];
                if (dynamic) seeds.push(dynamic);
                seeds.push([MEGAPLAY_FALLBACK_KEY_SEED, MEGAPLAY_FALLBACK_IV_SEED]);
                log("resolveMegaplay: trying", seeds.length, "seed candidates");

                for (var i = 0; i < seeds.length; i++) {
                    log("resolveMegaplay: seed #" + (i + 1), JSON.stringify(seeds[i]));
                    var m3u8 = decryptMegaplayEnc(payload.enc, seeds[i][0], seeds[i][1]);
                    if (m3u8) {
                        return {
                            url: signMegaplayUrl(m3u8),
                            headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" }
                        };
                    }
                }
                logErr("resolveMegaplay: all seeds failed");
                return null;
            });
        }

        logErr("resolveMegaplay: no 'sources' and no 'enc' in response");
        logErr("  payload:", JSON.stringify(payload).slice(0, 300));
        return null;
    })
    .catch(function(e) {
        logErr("resolveMegaplay exception:", e.message);
        return null;
    });
}

// =========================================================================
// Entry point
// =========================================================================

function getStreams(tmdbId, mediaType, season, episode) {
    log("========== getStreams called ==========");
    log("  args: tmdbId =", tmdbId, "mediaType =", mediaType,
        "season =", season, "episode =", episode);

    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    return getTitle(tmdbId, mediaType)
        .then(function(title) {
            if (!title) { logErr("getStreams: no title, aborting"); return []; }

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
                        log("getStreams: mapped episode =", mappedEpisode);

                        return searchAnime(title).then(function(best) {
                            if (!best) { logErr("getStreams: no search result"); return []; }

                            return getAnimeId(best.url).then(function(animeId) {
                                if (!animeId) { logErr("getStreams: no animeId"); return []; }

                                return getDubEpisode(animeId, mappedEpisode, best.url)
                                    .then(function(ep) {
                                        if (!ep) { logErr("getStreams: no dub episode"); return []; }

                                        return getDubServer(ep.ids, best.url)
                                            .then(function(linkId) {
                                                if (!linkId) { logErr("getStreams: no linkId"); return []; }
                                                return getEmbed(linkId, best.url);
                                            })
                                            .then(function(embed) {
                                                if (!embed || embed.indexOf("megaplay") === -1) {
                                                    logErr("getStreams: no megaplay embed, got =", embed);
                                                    return [];
                                                }
                                                return resolveMegaplay(embed);
                                            })
                                            .then(function(stream) {
                                                if (!stream) { logErr("getStreams: resolveMegaplay returned null"); return []; }
                                                log("getStreams: SUCCESS url =", stream.url);
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
        .catch(function(e) {
            logErr("getStreams outer exception:", e.message, e.stack);
            return [];
        });
}

module.exports = { getStreams };