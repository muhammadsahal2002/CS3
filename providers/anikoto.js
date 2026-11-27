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

// [UPDATED] MegaPlay / Vidwish / Vidtube calls + playback use this UA (same as the working Java)
var MEGAPLAY_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

var MEGAPLAY_TOKEN_KEY         = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var MEGAPLAY_TOKEN_LIFETIME    = 604800;
var MEGAPLAY_FALLBACK_KEY_SEED = "i?LMTAx0Q6,:}50U";
var MEGAPLAY_FALLBACK_IV_SEED  = "W0;27ToaUpl_P%'c";

var MEGAPLAY_HEX_IDS_RE  = /\/([a-f0-9]{32})\/([a-f0-9]{32})\//i;
var MEGAPLAY_KEY_PAIR_RE = /[A-Za-z]\w*="([^"]{16})",[A-Za-z]\w*="([^"]{16})"/;
var MEGAPLAY_FILE_RE     = /"file"\s*:\s*"([^"]+)"/;

// [UPDATED] the Java registers MegaPlay, Vidwish and Vidtube (same API on all three)
var EMBED_HOST_RE        = /megaplay|vidwish|vidtube/i;

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

// [UPDATED] returns title + original title + year + alternative titles (romaji etc.)
function getTmdbInfo(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY + "&append_to_response=alternative_titles";
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            var isTv = mediaType === "tv";
            var title = isTv
                ? (data.name || data.original_name)
                : (data.title || data.original_title);
            var original = isTv ? data.original_name : data.original_title;
            var date = isTv ? data.first_air_date : data.release_date;
            var year = date ? String(date).substring(0, 4) : "";

            var list = [title, original];
            var alt = data.alternative_titles
                ? (data.alternative_titles.titles || data.alternative_titles.results || [])
                : [];
            for (var i = 0; i < alt.length && list.length < 16; i++) {
                var a = alt[i];
                if (!a || !a.title) continue;
                if (/^(JP|US|GB)$/.test(a.iso_3166_1 || "") || /romaji|romaniz|english/i.test(a.type || "")) {
                    list.push(a.title);
                }
            }
            var titles = [];
            list.forEach(function(t) { if (t && titles.indexOf(t) < 0) titles.push(t); });

            log("  tmdb: title =", title, "| year =", year, "| alt titles =", titles.length);
            return { title: title, originalTitle: original || "", year: year, titles: titles };
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
// AniKoto scraping with type-aware, title-aware selection
// =========================================================================

// movie / series / other (OVA, special...) / unknown
function classifyType(typeText) {
    var s = String(typeText || "").toLowerCase();
    if (/\b(movie|film)\b/.test(s)) return "movie";
    if (/\b(ova|oad|special|music|cm|pv)\b/.test(s)) return "other";
    if (/\b(tv|ona|web)\b/.test(s)) return "series";
    return "unknown";
}

// Score one wanted title against one site title (both already normalize()d), 0-100
function pairScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 100;
    var ta = a.split(" "), tb = b.split(" ");
    var inB = {}, seen = {}, inter = 0;
    tb.forEach(function(x) { inB[x] = 1; });
    ta.forEach(function(x) { if (inB[x] && !seen[x]) { inter++; seen[x] = 1; } });
    var jac = 100 * inter / (ta.length + tb.length - inter);
    var lev = (1 - levenshtein(a, b) / Math.max(a.length, b.length)) * 100;
    return Math.max(jac, lev);
}

function titleMatchScore(cand, wantedNorm) {
    var forms = [
        normalize(normalizeTitle(cand.enTitle)),
        normalize(normalizeTitle(cand.jpTitle))
    ];
    var best = 0;
    for (var i = 0; i < forms.length; i++) {
        if (!forms[i]) continue;
        for (var j = 0; j < wantedNorm.length; j++) {
            var s = pairScore(forms[i], wantedNorm[j]);
            if (s > best) best = s;
        }
    }
    return best;
}

var TITLE_ACCEPT = 72;

// Rank search results. Returns accepted candidates, best first (empty = nothing good enough).
function rankCandidates(results, info, wantMovie) {
    var wantedNorm = [];
    (info.titles && info.titles.length ? info.titles : [info.title]).forEach(function(t) {
        var n = normalize(normalizeTitle(t));
        if (n && wantedNorm.indexOf(n) < 0) wantedNorm.push(n);
    });
    var want = wantMovie ? "movie" : "series";
    var year = parseInt(info.year, 10);
    var out = [];

    results.forEach(function(r) {
        var cls = r.typeClass || classifyType(r.typeText);
        // wrong type is never allowed: a movie request must not get a series and vice versa
        if ((want === "movie" && cls === "series") || (want === "series" && cls === "movie")) {
            log("    skip", r.enTitle, "(wrong type:", cls + ")");
            return;
        }
        var ts = titleMatchScore(r, wantedNorm);
        var score = ts;
        if (cls === "unknown") score -= 8;
        if (cls === "other") score -= 15;

        if (r.year && year) {
            var diff = Math.abs(r.year - year);
            if (wantMovie) {
                if (diff === 0) score += 25;
                else if (diff === 1) score += 8;
                else score -= 12;
            } else if (diff === 0) {
                score += 5;
            }
        }
        var accepted = ts >= TITLE_ACCEPT;
        log("    cand", r.enTitle, "| type:", cls, "| year:", r.year || "-",
            "| title:", ts.toFixed(0), "| score:", score.toFixed(0), accepted ? "" : "(rejected)");
        if (!accepted) return;
        out.push({
            enTitle: r.enTitle, jpTitle: r.jpTitle, url: r.url,
            typeText: r.typeText, isMovie: cls === "movie", isSeries: cls === "series",
            titleScore: ts, score: score
        });
    });

    out.sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.enTitle.length - b.enTitle.length;
    });
    return out;
}

// Fetch + parse one search page
function fetchSearchResults(query) {
    var url = CONFIG.BASE_URL + "/filter?keyword=" + encodeURIComponent(query);
    log("  search: url =", url);

    return fetch(url, { headers: headers() })
        .then(function(r) {
            log("  search: HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .then(function(html) {
            if (!html) return [];
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

                // release year, if the card shows one
                var ym = /\b(19\d{2}|20\d{2})\b/.exec($el.text());

                results.push({
                    enTitle: enTitle,
                    jpTitle: jpTitle,
                    url: href.indexOf("http") === 0 ? href : CONFIG.BASE_URL + href,
                    typeText: typeText,
                    typeClass: classifyType(typeText),
                    year: ym ? parseInt(ym[1], 10) : 0
                });
            });

            log("  search: found", results.length, "results");
            return results;
        })
        .catch(function(e) { logErr("  search failed:", e.message); return []; });
}

function buildQueries(info) {
    var out = [], seen = {};
    function add(t) {
        var q = normalizeTitle(t || "").trim();
        var k = normalize(q);
        if (!k || seen[k]) return;
        seen[k] = 1;
        out.push(q);
    }
    add(info.title);
    add(info.originalTitle);
    (info.titles || []).forEach(function(t) { if (out.length < 4) add(t); });
    return out;
}

// Try each title variant until something good enough is found
function searchAnimeRanked(info, wantMovie) {
    var queries = buildQueries(info);
    log("  search: queries =", queries.join(" | "), "wantMovie =", !!wantMovie);

    function next(i) {
        if (i >= queries.length) return Promise.resolve([]);
        return fetchSearchResults(queries[i]).then(function(results) {
            var ranked = results.length ? rankCandidates(results, info, wantMovie) : [];
            if (ranked.length) {
                log("  search: best =", ranked[0].enTitle, "(score:", ranked[0].score.toFixed(0) + ")");
                return ranked;
            }
            log("  search: nothing good for", queries[i]);
            return next(i + 1);
        });
    }
    return next(0);
}

// kept for test.js
function searchAnime(title, wantMovie) {
    return searchAnimeRanked({ title: title, originalTitle: "", year: "", titles: [title] }, wantMovie)
        .then(function(list) { return list.length ? list[0] : null; });
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

// [NEW] resolve a playlist uri against the (unsigned) master url, like parseVariants() in the Java
function resolvePlaylistUrl(uri, masterUrl) {
    if (/^https?:\/\//i.test(uri)) return uri;
    var b = masterUrl.split("?")[0];
    if (uri.indexOf("//") === 0) return "https:" + uri;
    if (uri.charAt(0) === "/") {
        var om = /^(https?:\/\/[^\/]+)/i.exec(b);
        return (om ? om[1] : "") + uri;
    }
    return b.substring(0, b.lastIndexOf("/") + 1) + uri;
}

// [NEW] read #EXT-X-STREAM-INF lines -> [{ url, quality }]
function parseMegaplayVariants(masterUrl, masterText) {
    var out = [];
    var lines = masterText.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
        var rm = /RESOLUTION=(\d+)x(\d+)/.exec(line);
        var quality = rm ? parseInt(rm[2], 10) : null;
        var uri = null;
        for (var j = i + 1; j < lines.length; j++) {
            var l = lines[j].trim();
            if (l && l.charAt(0) !== "#") { uri = l; i = j; break; }
        }
        if (!uri) continue;
        out.push({ url: resolvePlaylistUrl(uri, masterUrl), quality: quality });
    }
    out.sort(function(a, b) { return (b.quality || 0) - (a.quality || 0); });
    return out;
}

// [NEW] sign the master, fetch it, sign every quality variant (the Java's emitLinks).
// embedBase = the api host that served the stream; Referer = embedBase + "/".
function finalizeMegaplay(embedBase, m3u8) {
    var playHeaders = {
        "User-Agent": MEGAPLAY_UA,
        "Referer": embedBase + "/"
    };
    var signedMaster = signMegaplayUrl(m3u8);

    return fetch(signedMaster, { headers: playHeaders })
        .then(function(r) {
            log("resolveMegaplay: master HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .catch(function(e) { logErr("resolveMegaplay: master fetch failed:", e.message); return null; })
        .then(function(text) {
            var variants = text ? parseMegaplayVariants(m3u8, text) : [];
            log("resolveMegaplay: variants =", variants.length);

            var entries = variants.map(function(v) {
                return { url: signMegaplayUrl(v.url), quality: v.quality };
            });
            // no variants -> use the signed master itself (old behaviour)
            if (!entries.length) entries = [{ url: signedMaster, quality: null }];

            return { headers: playHeaders, entries: entries };
        });
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
        headers: headers({ "User-Agent": MEGAPLAY_UA, "Referer": CONFIG.BASE_URL, "Origin": CONFIG.BASE_URL })
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

        // [UPDATED] same order as the Java: url (/dub|/sub) -> page "type:" -> default sub
        var um = embed.match(/\/(dub|sub)(?:[\/?#]|$)/);
        var tm = html.match(/type\s*:\s*['"](dub|sub)['"]/);
        var audioType = um ? um[1] : (tm ? tm[1] : "sub");
        log("resolveMegaplay: audioType =", audioType);

        var apiHosts = [primaryHost];
        if (assetOrigin !== primaryHost) apiHosts.push(assetOrigin);

        function tryOne(apiHost, endpoint) {
            var url = apiHost + "/stream/" + endpoint +
                      "?id=" + streamId + "&type=" + audioType;
            log("resolveMegaplay: GET", endpoint);
            return fetch(url, {
                headers: {
                    "User-Agent": MEGAPLAY_UA,
                    "Accept": "*/*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Origin": apiHost,
                    "Referer": embed
                }
            })
            .then(function(r) {
                log("  ->", endpoint, "HTTP", r.status);
                return r.ok ? r.json() : null;
            })
            // [UPDATED] remember which api host answered (used for key seeds + Referer)
            .then(function(json) { return json ? { data: json, apiHost: apiHost } : null; })
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
    .then(function(res) {
        if (!res) { logErr("resolveMegaplay: no data"); return null; }
        var data = res.data;
        var apiBase = res.apiHost;
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
            return finalizeMegaplay(apiBase, plainFile);
        }

        if (payload.enc) {
            log("resolveMegaplay: enc length =", payload.enc.length);
            return fetchMegaplayKeySeeds(apiBase).then(function(dynamic) {
                var seeds = [];
                if (dynamic) seeds.push(dynamic);
                seeds.push([MEGAPLAY_FALLBACK_KEY_SEED, MEGAPLAY_FALLBACK_IV_SEED]);

                for (var i = 0; i < seeds.length; i++) {
                    var m3u8 = decryptMegaplayEnc(payload.enc, seeds[i][0], seeds[i][1]);
                    if (m3u8) {
                        log("resolveMegaplay: decrypted");
                        return finalizeMegaplay(apiBase, m3u8);
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
                    // [UPDATED] megaplay + vidwish + vidtube
                    if (!embed || !EMBED_HOST_RE.test(embed)) return null;
                    return resolveMegaplay(embed);
                });
        });
    });
}

// try the best match first; a runner-up is only used when it is also a strong title match
function resolveFirstWorking(cands, i, episodeNum, isMovie) {
    if (i >= cands.length || i >= 3) return Promise.resolve(null);
    var c = cands[i];
    if (i > 0 && c.titleScore < 85) return Promise.resolve(null);
    log("  using:", c.enTitle, "|", c.url);
    return resolveFromAnimeEntry(c, episodeNum, isMovie).then(function(stream) {
        if (stream) return stream;
        log("  no dub stream on", c.enTitle, "- trying next candidate");
        return resolveFirstWorking(cands, i + 1, episodeNum, isMovie);
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

    return getTmdbInfo(tmdbId, mediaType).then(function(info) {
        if (!info || !info.title) { logErr("no title, aborting"); return []; }

        return getImdbId(tmdbId, mediaType).then(function(imdbId) {
            var epPromise = isMovie
                ? Promise.resolve(1)
                : getAbsoluteEpisode(imdbId, season, episode);

            return epPromise.then(function(mappedEpisode) {
                log("  mapped episode =", mappedEpisode, "(isMovie =", isMovie + ")");

                return searchAnimeRanked(info, isMovie).then(function(cands) {
                    if (!cands.length) { logErr("no search result"); return []; }

                    return resolveFirstWorking(cands, 0, mappedEpisode, isMovie)
                        .then(function(stream) {
                            if (!stream) { logErr("no stream resolved"); return []; }
                            log("  SUCCESS:", stream.entries.length, "stream(s)");

                            // [UPDATED] one entry per quality (old code returned a single master url)
                            return stream.entries.map(function(e) {
                                var q = e.quality ? e.quality + "p" : "1080p";
                                return {
                                    name: "AnikotoTV",
                                    title: isMovie ? "Movie " + q + " DUB" : q + " DUB",
                                    url: e.url,
                                    quality: "Anikoto " + q,
                                    headers: stream.headers
                                };
                            });
                        });
                });
            });
        });
    }).catch(function(e) {
        logErr("outer exception:", e.message);
        return [];
    });
}

module.exports = {
    getStreams: getStreams,
    // used only by test.js
    _internals: {
        searchAnime: searchAnime,
        resolveFromAnimeEntry: resolveFromAnimeEntry
    }
};
