/**
 * AnikotoTV Provider for Nuvio
 * DUB only
 * Handles movies vs series with type-filtered search
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
    CINEMETA_BASE: "https://v3-cinemeta.strem.io/meta",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.181 Mobile Safari/537.36"
};

var MEGAPLAY_TOKEN_KEY         = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var MEGAPLAY_TOKEN_LIFETIME    = 604800;
var MEGAPLAY_FALLBACK_KEY_SEED = "i?LMTAx0Q6,:}50U";
var MEGAPLAY_FALLBACK_IV_SEED  = "W0;27ToaUpl_P%'c";

var MEGAPLAY_HEX_IDS_RE  = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i;
var MEGAPLAY_KEY_PAIR_RE = /[A-Za-z]\w*="([^"]{16})",[A-Za-z]\w*="([^"]{16})"/;
var MEGAPLAY_FILE_RE     = /"file"\s*:\s*"([^"]+)"/;

// =========================================================================
// Crypto
// =========================================================================

function base64UrlToWordArray(b64url) {
    var b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return CryptoJS.enc.Base64.parse(b64);
}

function wordArrayToBase64Url(wa) {
    return CryptoJS.enc.Base64.stringify(wa)
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
            { ciphertext: ct }, key,
            { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
        );
        var text = decrypted.toString(CryptoJS.enc.Utf8);
        var m = MEGAPLAY_FILE_RE.exec(text);
        return m ? m[1] : null;
    } catch (e) { return null; }
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
                "." + wordArrayToBase64Url(sig);
    return url + (url.indexOf("?") !== -1 ? "&" : "?") + "token=" + token;
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

// Strip diacritics: Naruto Shippūden -> Naruto Shippuden
function normalizeTitle(str) {
    var s = String(str || "");
    try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
        s = s.replace(/ū/g, "u").replace(/ō/g, "o")
             .replace(/ā/g, "a").replace(/ī/g, "i")
             .replace(/ē/g, "e");
    }
    return s;
}

// Full comparison normalize: lowercase, collapse double vowels, strip punctuation
function normalize(str) {
    return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/uu/g, "u")
        .replace(/oo/g, "o")
        .replace(/aa/g, "a")
        .replace(/ii/g, "i")
        .replace(/ee/g, "e")
        .replace(/\s+/g, " ")
        .trim();
}

// Levenshtein similarity, 0-100
function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) {
        var longer = a.length > b.length ? a : b;
        var shorter = a.length > b.length ? b : a;
        return 70 * (shorter.length / longer.length);
    }
    var dist = levenshtein(a, b);
    var maxLen = Math.max(a.length, b.length);
    return maxLen > 0 ? (1 - dist / maxLen) * 50 : 0;
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    var matrix = [];
    for (var i = 0; i <= b.length; i++) matrix[i] = [i];
    for (var j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (i = 1; i <= b.length; i++) {
        for (j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// =========================================================================
// TMDB
// =========================================================================

function getImdbId(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "/external_ids?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            var id = d && d.imdb_id ? d.imdb_id : null;
            log("  tmdb: imdbId =", id);
            return id;
        })
        .catch(function() { return null; });
}

function getTitle(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            var t = mediaType === "tv"
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
            log("  tmdb: title =", t);
            return t;
        })
        .catch(function() { return null; });
}

// =========================================================================
// Cinemeta absolute episode
// =========================================================================

function getAbsoluteEpisode(imdbId, season, episode) {
    if (!imdbId) return Promise.resolve(episode);
    var url = CONFIG.CINEMETA_BASE + "/series/" + imdbId + ".json";
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.meta || !data.meta.videos || !data.meta.videos.length) {
                log("  absEp: no cinemeta data, using episode =", episode);
                return episode;
            }
            var videos = data.meta.videos;
            var abs = 0;
            for (var i = 0; i < videos.length; i++) {
                var v = videos[i];
                if (v.season === 0) continue;
                abs++;
                if (v.season === season && v.episode === episode) {
                    log("  absEp: S" + season + "E" + episode + " ->", abs);
                    return abs;
                }
            }
            log("  absEp: (S" + season + "E" + episode + ") not found, using episode =", episode);
            return episode;
        })
        .catch(function() { return episode; });
}

// =========================================================================
// AniKoto scraping with type-aware search
// =========================================================================

function searchAnime(title, wantMovie) {
    var searchTitle = normalizeTitle(title);
    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(searchTitle);
    log("  search: url =", url, "wantMovie =", !!wantMovie);

    return fetch(url, { headers: headers() })
        .then(function(r) {
            log("  search: HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) return null;
            log("  search: html length =", html.length);

            var $ = cheerio.load(html);
            var results = [];

            $("div.item").each(function(i, el) {
                var $el = $(el);
                var a = $el.find("a.name.d-title, a[data-jp]").first();
                if (!a.length) return;

                var href = a.attr("href");
                var jpTitle = a.attr("data-jp") || "";
                var enTitle = a.text().trim();
                if (!href) return;

                // Extract type badge
                var typeText = $el.find(".type, .item-type, .tick-type").text().trim();
                if (!typeText) {
                    typeText = $el.find(".fd-infor .tick-item").first().text().trim();
                }

                var typeLower = typeText.toLowerCase();
                var isMovie = /\bmovie\b|\bfilm\b/.test(typeLower);
                var isTv = /\btv\b/.test(typeLower) && !isMovie;

                results.push({
                    enTitle: enTitle,
                    jpTitle: jpTitle,
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    typeText: typeText,
                    isMovie: isMovie,
                    isSeries: isTv
                });
            });

            log("  search: found", results.length, "results");
            results.slice(0, 30).forEach(function(r) {
                log("    -", r.enTitle, "| type:", r.typeText,
                    "| movie:", r.isMovie, "| series:", r.isSeries);
            });

            if (results.length === 0) return null;

            // Filter by media type
            var candidates;
            if (wantMovie) {
                candidates = results.filter(function(r) { return r.isMovie; });
            } else {
                candidates = results.filter(function(r) { return r.isSeries; });
            }

            log("  search: filtered by type ->", candidates.length, "candidates");

            // If filter removed everything, use all results
            if (candidates.length === 0) {
                log("  search: type filter removed all, falling back to all");
                candidates = results;
            }

            // Exact normalized match
            var q = normalize(normalizeTitle(searchTitle));
            var exact = candidates.filter(function(r) {
                return normalize(normalizeTitle(r.enTitle)) === q ||
                       normalize(normalizeTitle(r.jpTitle)) === q;
            });

            if (exact.length > 0) {
                log("  search: EXACT match =", exact[0].enTitle);
                return exact[0];
            }

            // Fuzzy scoring
            var best = null;
            var bestScore = -999;

            candidates.forEach(function(r) {
                var en = normalize(normalizeTitle(r.enTitle));
                var jp = normalize(normalizeTitle(r.jpTitle));
                var score = Math.max(similarity(en, q), similarity(jp, q));
                score -= Math.abs(r.enTitle.length - searchTitle.length) * 0.5;

                if (score > bestScore) {
                    bestScore = score;
                    best = r;
                }
            });

            log("  search: best fuzzy =", best ? best.enTitle : "null",
                "(score:", bestScore.toFixed(1) + ")");
            return best;
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
            if (!html) return null;
            var m = html.match(/id="watch-main"[^>]*data-id="(\d+)"/) ||
                    html.match(/data-id="(\d+)"[^>]*id="watch-main"/) ||
                    html.match(/data-id=["'](\d+)["']/);
            if (m) { log("  animeId =", m[1]); return m[1]; }
            logErr("  animeId: not found");
            return null;
        })
        .catch(function(e) { logErr("  animeId failed:", e.message); return null; });
}

function getDubEpisode(animeId, episodeNum, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
    log("  dubEp: fetching episode", episodeNum);

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
            if (found) log("  dubEp: FOUND ep", episodeNum);
            else logErr("  dubEp: episode", episodeNum, "not in dub list");
            return found;
        })
        .catch(function(e) { logErr("  dubEp failed:", e.message); return null; });
}

function getFirstDubEpisode(animeId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/episode/list/" + animeId + "?vrf=";
    log("  firstDubEp: fetching (movie mode)");

    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            var $ = cheerio.load(data.result);
            var total = 0;
            var found = null;
            $("a[data-ids]").each(function(i, el) {
                total++;
                if (found) return;
                var a = $(el);
                if (a.attr("data-dub") === "1" && a.attr("data-ids")) {
                    found = {
                        ids: a.attr("data-ids"),
                        number: parseInt(a.attr("data-num") || "1", 10)
                    };
                }
            });
            log("  firstDubEp: total entries =", total);
            if (found) log("  firstDubEp: using ep", found.number);
            else logErr("  firstDubEp: no dub entries");
            return found;
        })
        .catch(function(e) { logErr("  firstDubEp failed:", e.message); return null; });
}

function getDubServer(ids, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server/list?servers=" + encodeURIComponent(ids);
    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) { logErr("  dubSrv: no result"); return null; }
            var $ = cheerio.load(data.result);
            var linkId = $('div.type[data-type="dub"] li[data-link-id]').first().attr("data-link-id");
            if (!linkId) {
                linkId = $('li[data-link-id]').first().attr("data-link-id");
                if (linkId) log("  dubSrv: fallback to any server");
            } else {
                log("  dubSrv: dub link-id found");
            }
            return linkId || null;
        })
        .catch(function(e) { logErr("  dubSrv failed:", e.message); return null; });
}

function getEmbed(linkId, referer) {
    var url = CONFIG.BASE_URL + "/ajax/server?get=" + encodeURIComponent(linkId);
    return fetch(url, { headers: ajaxHeaders(referer) })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data || !data.result) return null;
            return typeof data.result === "string" ? data.result
                 : (data.result.url ? data.result.url : null);
        })
        .catch(function() { return null; });
}

// =========================================================================
// MegaPlay
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
    log("resolveMegaplay: embed =", embed);

    var hostMatch = embed.match(/^https?:\/\/([^\/]+)/);
    var primaryHost = hostMatch ? "https://" + hostMatch[1] : "https://megaplay.buzz";

    return fetch(embed, {
        headers: headers({ "Referer": CONFIG.BASE_URL, "Origin": CONFIG.BASE_URL })
    })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(html) {
        if (!html) return null;
        var sm = html.match(/data-id=["'](\d+)["']/) ||
                 html.match(/data-realid=["'](\d+)["']/) ||
                 embed.match(/\/stream\/s-\d+\/(\d+)\//);
        if (!sm) { logErr("resolveMegaplay: no streamId"); return null; }
        var streamId = sm[1];
        log("resolveMegaplay: streamId =", streamId);

        var dm = html.match(/data-domain=["']([^"']+)["']/);
        var assetOrigin = dm ? "https://" + dm[1] : primaryHost;
        var audioType = embed.indexOf("/dub") !== -1 ? "dub" : "sub";
        log("resolveMegaplay: audioType =", audioType);

        var apiHosts = [primaryHost];
        if (assetOrigin !== primaryHost) apiHosts.push(assetOrigin);

        function tryOne(apiHost, endpoint) {
            var url = apiHost + "/stream/" + endpoint +
                      "?id=" + streamId + "&type=" + audioType;
            log("resolveMegaplay: GET", endpoint);
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
                log("  ->", endpoint, "HTTP", r.status);
                return r.ok ? r.json() : null;
            })
            .catch(function(e) { logErr("  ->", endpoint, "failed:", e.message); return null; });
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
        if (!data) { logErr("resolveMegaplay: no data"); return null; }
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
            log("resolveMegaplay: plain file");
            return {
                url: signMegaplayUrl(plainFile),
                headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" }
            };
        }

        if (payload.enc) {
            log("resolveMegaplay: enc length =", payload.enc.length);
            return fetchMegaplayKeySeeds(primaryHost).then(function(dynamic) {
                var seeds = [];
                if (dynamic) seeds.push(dynamic);
                seeds.push([MEGAPLAY_FALLBACK_KEY_SEED, MEGAPLAY_FALLBACK_IV_SEED]);

                for (var i = 0; i < seeds.length; i++) {
                    var m3u8 = decryptMegaplayEnc(payload.enc, seeds[i][0], seeds[i][1]);
                    if (m3u8) {
                        log("resolveMegaplay: decrypted");
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
        logErr("resolveMegaplay: no sources, no enc");
        return null;
    })
    .catch(function(e) { logErr("resolveMegaplay exception:", e.message); return null; });
}

// =========================================================================
// Common tail
// =========================================================================

function resolveFromAnimeEntry(best, episodeNum, isMovie) {
    return getAnimeId(best.url).then(function(animeId) {
        if (!animeId) return null;

        var episodePromise = isMovie
            ? getFirstDubEpisode(animeId, best.url)
            : getDubEpisode(animeId, episodeNum, best.url);

        return episodePromise.then(function(ep) {
            if (!ep) return null;
            return getDubServer(ep.ids, best.url)
                .then(function(linkId) {
                    if (!linkId) return null;
                    return getEmbed(linkId, best.url);
                })
                .then(function(embed) {
                    if (!embed || embed.indexOf("megaplay") === -1) return null;
                    return resolveMegaplay(embed);
                });
        });
    });
}

// =========================================================================
// Entry point
// =========================================================================

function getStreams(tmdbId, mediaType, season, episode) {
    var isMovie = mediaType === "movie";
    season  = parseInt(season, 10)  || 1;
    episode = parseInt(episode, 10) || 1;

    log("========== getStreams ==========");
    log("  tmdbId =", tmdbId, "mediaType =", mediaType, "S" + season + "E" + episode);

    return getTitle(tmdbId, mediaType).then(function(title) {
        if (!title) { logErr("no title, aborting"); return []; }

        return getImdbId(tmdbId, mediaType).then(function(imdbId) {
            var epPromise = isMovie
                ? Promise.resolve(1)
                : getAbsoluteEpisode(imdbId, season, episode);

            return epPromise.then(function(mappedEpisode) {
                log("  mapped episode =", mappedEpisode, "(isMovie =", isMovie + ")");

                return searchAnime(title, isMovie).then(function(best) {
                    if (!best) { logErr("no search result"); return []; }
                    log("  using:", best.enTitle, "|", best.url);

                    return resolveFromAnimeEntry(best, mappedEpisode, isMovie)
                        .then(function(stream) {
                            if (!stream) { logErr("no stream resolved"); return []; }
                            log("  SUCCESS");
                            return [{
                                name: "AnikotoTV",
                                title: isMovie ? "Movie DUB" : "1080p DUB",
                                url: stream.url,
                                quality: "Anikoto 1080p",
                                headers: stream.headers
                            }];
                        });
                });
            });
        });
    }).catch(function(e) {
        logErr("outer exception:", e.message);
        return [];
    });
}

module.exports = { getStreams };