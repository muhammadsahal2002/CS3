/**
 * NetMirror Disney+ provider for Nuvio  (pure JS, no dependencies, Promise chains)
 *
 * Flow:
 *   1. TMDB id  -> title(s)
 *   2. unlock session (ad-verification handshake) -> t_hash_t token cookie (cached 12h)
 *   3. GET /mobile/hs/search.php?s=<title>                 -> NetMirror content id
 *   4. movie  : playable id = content id
 *      series : GET /mobile/hs/post.php?id=<id>            -> title + season list
 *               GET /mobile/hs/episodes.php?s=<seasonId>&series=<id>&page=N -> episode id
 *   5. GET /mobile/hs/playlist.php?id=<playId>&t=<title>&tm=<ts> -> { sources[], tracks[] }
 *   6. one stream per source, with Referer + Cookie headers
 *
 * ASSUMPTIONS (not verified, see test-netmirror.js --raw to check them):
 *   - search.php returns { searchResult: [{ id, t }] }
 *   - post.php returns { title, season: [{ id, s }], episodes: [...] }
 *   - episodes.php returns { episodes: [{ id, ep, s }], nextPageShow }
 */

"use strict";

var LOG = "[NetMirror]";
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
    BASE_URL: "https://net52.cc",
    OTT: "dp",                 // Disney+
    PREFIX: "hs/",             // Disney+ path prefix
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    UA: "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0",
    UNLOCK_TIMEOUT_MS: 45000,
    POLL_MS: 2000,
    TOKEN_TTL_MS: 43200000,    // 12h
    MIN_SCORE: 40,
    COOKIE_OVERRIDE: ""        // full cookie string, skips the unlock (used by test-netmirror.js --cookie)
};

var ABUSE_MARKERS = ["220884", "Only Valid Users Allowed"];

// session cache (lost on app restart, that is fine)
var session = { token: null, expiry: 0 };

// =========================================================================
// Small helpers
// =========================================================================

function delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function nowSec() {
    return Math.round(Date.now() / 1000);
}

function stripDiacritics(str) {
    var s = String(str || "");
    try { s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return s;
}

function normalize(str) {
    return stripDiacritics(str)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .replace(/^the /, "")
        .trim();
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    var matrix = [];
    var i, j;
    for (i = 0; i <= b.length; i++) matrix[i] = [i];
    for (j = 0; j <= a.length; j++) matrix[0][j] = j;
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

function titleScore(a, b) {
    return similarity(normalize(a), normalize(b));
}

// "S2", "Season 2", "2", 2 -> 2   (null when there is no digit)
function numberOf(v) {
    var d = String(v === undefined || v === null ? "" : v).replace(/\D/g, "");
    return d ? parseInt(d, 10) : null;
}

// =========================================================================
// Cookies
// =========================================================================

// Set-Cookie of a response -> ["name=value", ...]
function cookiePairs(res) {
    var raw = [];
    try {
        if (res.headers && typeof res.headers.getSetCookie === "function") raw = res.headers.getSetCookie();
    } catch (e) {}
    if (!raw || !raw.length) {
        var s = "";
        try { s = res.headers.get("set-cookie") || ""; } catch (e1) {}
        try {
            var x = res.headers.get("x-set-cookie");
            if (x) s += (s ? ", " : "") + x;
        } catch (e2) {}
        // split joined cookies, but not at the comma inside "Expires=Wed, 21 Oct ..."
        raw = s ? s.split(/,(?=\s*[A-Za-z0-9_\-]+=)/) : [];
    }
    var out = [];
    raw.forEach(function(c) {
        var p = String(c).split(";")[0].trim();
        if (p && p.indexOf("=") > 0) out.push(p);
    });
    return out;
}

function pairValue(pairs, name) {
    for (var i = 0; i < pairs.length; i++) {
        if (pairs[i].indexOf(name + "=") === 0) return pairs[i].slice(name.length + 1);
    }
    return null;
}

function decode(v) {
    try { return decodeURIComponent(v); } catch (e) { return v; }
}

// t_hash_t looks like "hash::ip::timestamp::flag"; "::99" = banned, timestamp > 12h = stale
function isTokenUsable(token) {
    if (!token || typeof token !== "string") return false;
    if (token.indexOf("::99") !== -1) return false;
    var parts = token.split("::");
    if (parts.length < 3) return true;          // no timestamp, assume usable
    var ts = parts[2];
    if (/^\d{10}$/.test(ts)) {
        var age = Date.now() / 1000 - Number(ts);
        if (age >= 43200) return false;
    }
    return true;
}

function saveToken(tok) {
    session.token = tok;
    session.expiry = Date.now() + CONFIG.TOKEN_TTL_MS;
    return tok;
}

// token out of a response's Set-Cookie (or null)
function tokenFromResponse(res) {
    var v = pairValue(cookiePairs(res), "t_hash_t");
    if (!v) return null;
    var tok = decode(v);
    return isTokenUsable(tok) ? tok : null;
}

// =========================================================================
// Unlock session (ad-verification handshake)
// =========================================================================

function appHomeHeaders(cookie) {
    var h = {
        "User-Agent": CONFIG.UA,
        "X-Requested-With": "com.netmirror.app",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    };
    if (cookie) h["Cookie"] = cookie;
    return h;
}

// resolves a usable token string, or null
function unlockSession() {
    var base = CONFIG.BASE_URL;
    log("  unlock: start");

    return fetch(base + "/mobile/home?app=1", { headers: appHomeHeaders() })
        .then(function(res) {
            var tok = tokenFromResponse(res);
            if (tok) { log("  unlock: token came with the first response"); return { token: saveToken(tok) }; }

            var initialCookie = cookiePairs(res).join("; ");
            return res.text().then(function(html) {
                var m = /data-addhash=["']([^"']+)["']/.exec(html);
                return { addhash: m ? m[1] : null, initialCookie: initialCookie };
            });
        })
        .then(function(state) {
            if (state.token) return state.token;
            if (!state.addhash) { logErr("  unlock: no data-addhash on the home page"); return null; }

            // sponsor step, fire and forget
            var domain = base.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
            fetch("https://userver." + domain + "/?hee5=" + encodeURIComponent(state.addhash) + "&a=y&t=" + Math.random(), {
                headers: {
                    "User-Agent": CONFIG.UA,
                    "Referer": base + "/mobile/home?app=1",
                    "Cookie": state.initialCookie,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                },
                redirect: "manual"
            }).catch(function() {});

            var pollCookie = "ext_name=ojplmecpdpgccookcobabopnaifgidhf; addhash=" +
                encodeURIComponent(state.addhash) + "; " + state.initialCookie;
            var start = Date.now();

            function poll() {
                if (Date.now() - start > CONFIG.UNLOCK_TIMEOUT_MS) {
                    logErr("  unlock: timed out");
                    return Promise.resolve(null);
                }
                return delay(CONFIG.POLL_MS).then(function() {
                    return fetch(base + "/mobile/verify2.php", {
                        method: "POST",
                        headers: {
                            "User-Agent": CONFIG.UA,
                            "X-Requested-With": "XMLHttpRequest",
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "Referer": base + "/mobile/home",
                            "Origin": base,
                            "Cookie": pollCookie
                        },
                        body: "verify=" + encodeURIComponent(state.addhash)
                    });
                }).then(function(res) {
                    var tok = tokenFromResponse(res);
                    if (tok) return saveToken(tok);

                    return res.text().then(function(txt) {
                        var j = null;
                        try { j = JSON.parse(txt); } catch (e) {}
                        if (j && j.statusup === "All Done") {
                            log("  unlock: verified, reloading home for the token");
                            return fetch(base + "/mobile/home?app=1", { headers: appHomeHeaders(pollCookie) })
                                .then(function(r2) {
                                    var t2 = tokenFromResponse(r2);
                                    return t2 ? saveToken(t2) : null;
                                });
                        }
                        return poll();
                    });
                }).catch(function() { return poll(); });
            }
            return poll();
        })
        .catch(function(err) {
            logErr("  unlock error:", err && err.message);
            return null;
        });
}

// full cookie header for API calls
function getCookie(forceFresh) {
    if (CONFIG.COOKIE_OVERRIDE) return Promise.resolve(CONFIG.COOKIE_OVERRIDE);

    if (!forceFresh && session.token && Date.now() < session.expiry && isTokenUsable(session.token)) {
        return Promise.resolve("t_hash_t=" + session.token + "; hd=on; ott=" + CONFIG.OTT);
    }
    return unlockSession().then(function(tok) {
        if (tok) return "t_hash_t=" + tok + "; hd=on; ott=" + CONFIG.OTT;
        logErr("  no token, continuing without it (may fail)");
        return "hd=on; ott=" + CONFIG.OTT;
    });
}

// =========================================================================
// API helpers
// =========================================================================

function apiHeaders(cookie) {
    var h = {
        "User-Agent": CONFIG.UA,
        "Referer": CONFIG.BASE_URL + "/home",
        "Origin": CONFIG.BASE_URL,
        "Accept": "application/json, text/plain, */*"
    };
    if (cookie) h["Cookie"] = cookie;
    return h;
}

// GET json (resolves null on any problem)
function apiGet(path, cookie) {
    var url = path.indexOf("http") === 0 ? path : CONFIG.BASE_URL + path;
    return fetch(url, { headers: apiHeaders(cookie) })
        .then(function(r) {
            log("  GET", url.replace(CONFIG.BASE_URL, "").slice(0, 100), "-> HTTP", r.status);
            return r.text();
        })
        .then(function(txt) {
            try { return JSON.parse(txt); } catch (e) {
                logErr("  not json:", String(txt).slice(0, 120).replace(/\s+/g, " "));
                return null;
            }
        })
        .catch(function(e) { logErr("  request failed:", e && e.message); return null; });
}

function mobilePath(file, withPrefix) {
    return "/mobile/" + (withPrefix ? CONFIG.PREFIX : "") + file;
}

// =========================================================================
// TMDB
// =========================================================================

function getTmdbTitles(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) return [];
            var main = mediaType === "tv" ? (d.name || d.original_name) : (d.title || d.original_title);
            var orig = mediaType === "tv" ? d.original_name : d.original_title;
            var titles = [];
            if (main) titles.push(main);
            if (orig && orig !== main) titles.push(orig);
            log("  tmdb: titles =", titles.join(" | "));
            return titles;
        })
        .catch(function() { return []; });
}

// =========================================================================
// Search + metadata
// =========================================================================

// -> [{ id, title }]
function searchContent(query, cookie) {
    var path = mobilePath("search.php", true) + "?s=" + encodeURIComponent(query) + "&t=" + nowSec();
    return apiGet(path, cookie).then(function(d) {
        if (!d) return [];
        var list = Array.isArray(d) ? d : (d.searchResult || d.results || d.data || []);
        var out = [];
        (Array.isArray(list) ? list : []).forEach(function(x) {
            var id = x && (x.id !== undefined ? x.id : x.ID);
            var title = x && (x.t || x.title || x.name);
            if (id !== undefined && id !== null && title) out.push({ id: String(id), title: String(title) });
        });
        log("  search \"" + query + "\":", out.length, "results");
        return out;
    });
}

function findContent(titles, cookie) {
    function tryTitle(i) {
        if (i >= titles.length) return Promise.resolve(null);
        return searchContent(titles[i], cookie).then(function(items) {
            var best = null;
            var bestScore = -1;
            items.forEach(function(it) {
                var s = 0;
                titles.forEach(function(t) { s = Math.max(s, titleScore(it.title, t)); });
                if (s > bestScore) { bestScore = s; best = it; }
            });
            if (best && bestScore >= CONFIG.MIN_SCORE) {
                log("  match:", best.title, "(score " + bestScore.toFixed(1) + ") id =", best.id);
                return best;
            }
            return tryTitle(i + 1);
        });
    }
    return tryTitle(0);
}

function postInfo(id, cookie) {
    return apiGet(mobilePath("post.php", true) + "?id=" + encodeURIComponent(id) + "&t=" + nowSec(), cookie);
}

// all episodes of one season (follows paging)
function getSeasonEpisodes(seriesId, seasonId, cookie) {
    var all = [];
    function page(n) {
        if (n > 12) return Promise.resolve(all);
        var path = mobilePath("episodes.php", true) + "?s=" + encodeURIComponent(seasonId) +
            "&series=" + encodeURIComponent(seriesId) + "&t=" + nowSec() + "&page=" + n;
        return apiGet(path, cookie).then(function(d) {
            if (!d) return all;
            var eps = Array.isArray(d.episodes) ? d.episodes : [];
            all = all.concat(eps);
            var more = d.nextPageShow;
            if (eps.length && (more === 1 || more === "1" || more === true)) return page(n + 1);
            return all;
        });
    }
    return page(1);
}

function pickEpisode(list, episode) {
    var i;
    for (i = 0; i < list.length; i++) {
        if (numberOf(list[i].ep !== undefined ? list[i].ep : list[i].episode) === episode) return list[i];
    }
    return list[episode - 1] || null;
}

// -> { playId, title } or null
function resolvePlayable(hit, isMovie, season, episode, cookie) {
    if (isMovie) return Promise.resolve({ playId: hit.id, title: hit.title });

    return postInfo(hit.id, cookie).then(function(info) {
        if (!info) return null;
        var title = info.title || hit.title;
        var seasons = Array.isArray(info.season) ? info.season : [];
        var inlineEps = Array.isArray(info.episodes) ? info.episodes : [];

        var wanted = null;
        seasons.forEach(function(s) {
            if (numberOf(s.s !== undefined ? s.s : (s.name !== undefined ? s.name : s.season)) === season) wanted = s;
        });
        if (!wanted && seasons.length === 1 && season === 1) wanted = seasons[0];

        var epsPromise;
        if (wanted) {
            epsPromise = getSeasonEpisodes(hit.id, wanted.id, cookie).then(function(list) {
                // post.php already carries the first season's episodes
                return list.length || wanted !== seasons[0] ? list : inlineEps;
            });
        } else if (!seasons.length) {
            epsPromise = Promise.resolve(inlineEps);
        } else {
            epsPromise = Promise.resolve([]);
        }

        return epsPromise.then(function(list) {
            var ep = pickEpisode(list, episode);
            if (!ep || ep.id === undefined) {
                logErr("  S" + season + "E" + episode, "not found (" + list.length + " episodes seen)");
                return null;
            }
            log("  episode: S" + season + "E" + episode, "-> id", ep.id);
            return { playId: String(ep.id), title: title };
        });
    });
}

// =========================================================================
// Playlist + streams
// =========================================================================

function playlistUrl(playId, title, withPrefix) {
    return mobilePath("playlist.php", withPrefix) + "?id=" + encodeURIComponent(playId) +
        "&t=" + encodeURIComponent(title) + "&tm=" + nowSec();
}

function normalizePlaylist(d) {
    var p = Array.isArray(d) ? d[0] : d;
    return p && Array.isArray(p.sources) && p.sources.length ? p : null;
}

// prefix path first, plain path as fallback
function fetchPlaylist(playId, title, cookie) {
    return apiGet(playlistUrl(playId, title, true), cookie).then(function(d) {
        var p = normalizePlaylist(d);
        if (p) return p;
        return apiGet(playlistUrl(playId, title, false), cookie).then(normalizePlaylist);
    });
}

function isAbused(text) {
    for (var i = 0; i < ABUSE_MARKERS.length; i++) {
        if (String(text).indexOf(ABUSE_MARKERS[i]) !== -1) return true;
    }
    return false;
}

function absoluteUrl(u) {
    if (!u) return "";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.indexOf("http") === 0) return u;
    return CONFIG.BASE_URL + u;
}

// playlist + a check of the first source; one retry with a fresh session when abused.
// ctx.cookie is updated when the session is refreshed.
function getPlaylistChecked(playId, title, ctx) {
    function attempt(retried) {
        return fetchPlaylist(playId, title, ctx.cookie).then(function(pl) {
            if (!pl) return null;
            var first = absoluteUrl(pl.sources[0].file);
            if (!first) return null;

            return fetch(first, { headers: apiHeaders(ctx.cookie) })
                .then(function(r) { return r.text(); })
                .then(function(txt) { return isAbused(txt); })
                .catch(function() { return false; })      // check failed -> try anyway
                .then(function(abused) {
                    if (!abused) return pl;
                    if (retried) { logErr("  session still rejected after retry"); return null; }
                    log("  session rejected, getting a fresh one");
                    session.token = null;
                    session.expiry = 0;
                    return getCookie(true).then(function(c) {
                        ctx.cookie = c;
                        return attempt(true);
                    });
                });
        });
    }
    return attempt(false);
}

function buildSubtitles(pl) {
    var subs = [];
    (Array.isArray(pl.tracks) ? pl.tracks : []).forEach(function(tr) {
        var uri = absoluteUrl(tr.file || "");
        if (!uri) return;
        subs.push({
            title: tr.label || "Subtitle",
            language: tr.label || "English",
            uri: uri,
            type: uri.indexOf(".vtt") !== -1 ? "text/vtt" : "application/x-subrip"
        });
    });
    return subs;
}

function streamHeaders(cookie) {
    return {
        "User-Agent": CONFIG.UA,
        "Referer": CONFIG.BASE_URL + "/",
        "Accept": "*/*",
        "Cookie": cookie
    };
}

function buildStreams(pl, cookie, label) {
    var subs = buildSubtitles(pl);
    var streams = [];

    pl.sources.forEach(function(src) {
        var url = absoluteUrl(src.file || "");
        if (!url || isAbused(url)) return;

        // the first source is the adaptive master playlist ("Auto"), the others are fixed qualities
        var q = "1080";
        var isAuto = false;
        var l = String(src.label || "").toLowerCase();
        if (l.indexOf("auto") !== -1) isAuto = true;
        else if (l.indexOf("full hd") !== -1 || url.indexOf("1080p") !== -1) q = "1080";
        else if (l.indexOf("mid hd") !== -1 || url.indexOf("720p") !== -1) q = "720";
        else if (l.indexOf("low hd") !== -1 || url.indexOf("480p") !== -1) q = "480";
        else if (l.indexOf("360p") !== -1) q = "360";

        var stream = {
            name: "NetMirror Disney+",
            title: label + " " + (src.label || "HLS") + (isAuto ? "" : " (" + q + "p)"),
            url: url,
            quality: isAuto ? "Auto" : q + "p",
            headers: streamHeaders(cookie)
        };
        if (subs.length) stream.subtitles = subs;
        streams.push(stream);
    });

    // Auto (adaptive master) first, then best quality down
    function rank(st) { return st.quality === "Auto" ? 100000 : parseInt(st.quality, 10) || 0; }
    streams.sort(function(a, b) { return rank(b) - rank(a); });
    return streams;
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

    return getTmdbTitles(tmdbId, mediaType).then(function(titles) {
        if (!titles.length) { logErr("no title, aborting"); return []; }

        var ctx = { cookie: null };
        return getCookie().then(function(cookie) {
            ctx.cookie = cookie;
            return findContent(titles, ctx.cookie);
        }).then(function(hit) {
            if (!hit) { logErr("not found on netmirror"); return []; }

            return resolvePlayable(hit, isMovie, season, episode, ctx.cookie).then(function(target) {
                if (!target) return [];

                return getPlaylistChecked(target.playId, target.title, ctx).then(function(pl) {
                    if (!pl) { logErr("no playlist"); return []; }
                    var label = isMovie
                        ? target.title
                        : target.title + " S" + (season < 10 ? "0" : "") + season + "E" + (episode < 10 ? "0" : "") + episode;
                    var streams = buildStreams(pl, ctx.cookie, label);
                    log("  SUCCESS:", streams.length, "stream(s)");
                    return streams;
                });
            });
        });
    }).catch(function(e) {
        logErr("outer exception:", e && e.message);
        return [];
    });
}

module.exports = {
    getStreams: getStreams,
    // used only by test-netmirror.js
    _internals: {
        getCookie: getCookie,
        unlockSession: unlockSession,
        searchContent: searchContent,
        findContent: findContent,
        postInfo: postInfo,
        getSeasonEpisodes: getSeasonEpisodes,
        resolvePlayable: resolvePlayable,
        getPlaylistChecked: getPlaylistChecked,
        buildStreams: buildStreams,
        isTokenUsable: isTokenUsable,
        cookiePairs: cookiePairs,
        getSession: function() { return { token: session.token, expiry: session.expiry }; },
        setSession: function(token, expiry) { session.token = token; session.expiry = expiry; },
        CONFIG: CONFIG
    }
};
