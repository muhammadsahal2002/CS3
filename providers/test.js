/**
 * NetMirror Disney+ provider for Nuvio
 * (pure JS, no deps, Promise chains, NO hosted token — local cache only)
 *
 * Token handling (NO hosting):
 *   1. memory cache
 *   2. persisted copy (globalThis / localStorage / AsyncStorage / file in Node+Termux)
 *   3. unlock handshake (ad-verification) as last resort, then persisted
 *   The token's own embedded timestamp decides how long it is reused (12h).
 *
 * Flow:
 *   TMDB id -> title(s) [+ OMDb IMDb title] -> search.php -> pick (year + language rules)
 *   -> movie: playlist.php  |  series: post.php -> episodes.php -> playlist.php
 *
 * Features kept from mobile_nf.js:
 *   - OMDb/IMDb title as an extra search term (OMDb key = "8d6935ed")
 *   - year filter: strict for movies, flexible for series
 *   - language priority (Hindi > English > unmarked > other Indian languages)
 *   - post.type "m" = movie, post.main_id as the movie id
 *   - playlist.php with lang=null&hd=on and the app header, plain call as fallback
 *
 * NO TOKEN HOSTING: TOKEN_URL / fetchRemoteToken / t_hash-from-hosted are removed.
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
    NAME: "NetMirror Disney+",
    BASE_URL: "https://net52.cc",
    OTT: "dp",                 // Disney+
    PREFIX: "hs/",             // Disney+ path prefix
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    OMDB_API_KEY: "8d6935ed",  // from your mobile_nf.js (kept, optional)
    UA: "Mozilla/5.0 (Linux; Android 13; Pixel 5 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.7559.132 Safari/537.36 /OS.Gatu v3.0",
    UNLOCK_TIMEOUT_MS: 45000,
    POLL_MS: 2000,
    TOKEN_TTL_MS: 43200000,    // 12h
    TOKEN_SKEW_MS: 600000,     // stop reusing 10 min before the real expiry
    MIN_SCORE: 40,
    MAX_YEAR_LOOKUPS: 6,
    COOKIE_OVERRIDE: ""        // full cookie string, skips every token step (test --cookie)
};

var STORE_KEY = "netmirror_session_v1";
var ABUSE_MARKERS = ["220884", "Only Valid Users Allowed"];

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

var LANG_WORDS_RE = /\b(hindi|english|tamil|telugu|malayalam|kannada|bengali|marathi)\b/gi;

function stripLangTags(title) {
    return String(title || "").replace(LANG_WORDS_RE, " ").replace(/[\(\[\{]\s*[\)\]\}]/g, " ");
}

function titleScore(itemTitle, wanted) {
    return similarity(normalize(stripLangTags(itemTitle)), normalize(wanted));
}

function langPriority(title) {
    var t = String(title || "").toLowerCase();
    if (/\bhindi\b/.test(t)) return 100;
    if (/\benglish\b/.test(t)) return 90;
    if (!/\b(tamil|telugu|malayalam|kannada|bengali|marathi)\b/.test(t)) return 50;
    return 10;
}

function plainSearchTitle(str) {
    return String(str || "").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function numberOf(v) {
    var d = String(v === undefined || v === null ? "" : v).replace(/\D/g, "");
    return d ? parseInt(d, 10) : null;
}

function unique(list) {
    var seen = {};
    var out = [];
    list.forEach(function(x) {
        if (x && !seen[x]) { seen[x] = true; out.push(x); }
    });
    return out;
}

// =========================================================================
// Cookies + token rules  (no hosting)
// =========================================================================

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

function isTokenUsable(token) {
    if (!token || typeof token !== "string") return false;
    if (token.indexOf("::99") !== -1) return false;
    var parts = token.split("::");
    if (parts.length < 3) return true;
    var ts = parts[2];
    if (/^\d{10}$/.test(ts)) {
        var age = Date.now() / 1000 - Number(ts);
        if (age >= 43200) return false;
    }
    return true;
}

function tokenExpiry(token) {
    var parts = String(token || "").split("::");
    if (parts.length >= 3 && /^\d{10}$/.test(parts[2])) {
        return Number(parts[2]) * 1000 + CONFIG.TOKEN_TTL_MS - CONFIG.TOKEN_SKEW_MS;
    }
    return Date.now() + CONFIG.TOKEN_TTL_MS - CONFIG.TOKEN_SKEW_MS;
}

function tokenFromResponse(res) {
    var v = pairValue(cookiePairs(res), "t_hash_t");
    if (!v) return null;
    var tok = decode(v);
    return isTokenUsable(tok) ? tok : null;
}

// =========================================================================
// Session storage  (memory + persisted copy — NO hosted record)
// =========================================================================

var session = { token: null, expiry: 0, source: "" };
var backends = null;

function globalObject() {
    if (typeof globalThis !== "undefined") return globalThis;
    if (typeof global !== "undefined") return global;
    if (typeof window !== "undefined") return window;
    return null;
}

function getBackends() {
    if (backends) return backends;
    backends = [];
    var g = globalObject();

    if (g) {
        backends.push({
            name: "global",
            get: function() { return Promise.resolve(g.__netmirrorSession ? String(g.__netmirrorSession) : null); },
            set: function(v) { g.__netmirrorSession = v; return Promise.resolve(); },
            del: function() { try { delete g.__netmirrorSession; } catch (e) { g.__netmirrorSession = null; } return Promise.resolve(); }
        });
    }

    try {
        if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
            // probe write (private mode can throw on setItem)
            try {
                localStorage.setItem("__nm_probe__", "1");
                localStorage.removeItem("__nm_probe__");
                backends.push({
                    name: "localStorage",
                    get: function() { return Promise.resolve(localStorage.getItem(STORE_KEY)); },
                    set: function(v) { localStorage.setItem(STORE_KEY, v); return Promise.resolve(); },
                    del: function() { localStorage.removeItem(STORE_KEY); return Promise.resolve(); }
                });
            } catch (e) {}
        }
    } catch (e) {}

    try {
        var AS = g && g.AsyncStorage ? g.AsyncStorage : null;
        if (!AS && typeof require === "function") {
            try {
                var m = require("@react-native-async-storage/async-storage");
                AS = m && (m.default || m);
            } catch (e1) {}
        }
        if (AS && typeof AS.getItem === "function") {
            backends.push({
                name: "AsyncStorage",
                get: function() { return Promise.resolve(AS.getItem(STORE_KEY)); },
                set: function(v) { return Promise.resolve(AS.setItem(STORE_KEY, v)); },
                del: function() { return Promise.resolve(AS.removeItem(STORE_KEY)); }
            });
        }
    } catch (e2) {}

    try {
        if (typeof process !== "undefined" && process.versions && process.versions.node && typeof require === "function") {
            var fs = require("fs");
            var file = (process.env && process.env.NETMIRROR_SESSION_FILE) ||
                (((process.env && process.env.HOME) || ".") + "/.netmirror-session.json");
            backends.push({
                name: "file",
                get: function() { try { return Promise.resolve(fs.readFileSync(file, "utf8")); } catch (e) { return Promise.resolve(null); } },
                set: function(v) { try { fs.writeFileSync(file, v); } catch (e) {} return Promise.resolve(); },
                del: function() { try { fs.unlinkSync(file); } catch (e) {} return Promise.resolve(); }
            });
        }
    } catch (e3) {}

    log("  storage backends:", backends.map(function(b) { return b.name; }).join(", ") || "none");
    return backends;
}

function sessionValid(s) {
    return !!(s && s.token && s.expiry > Date.now() && isTokenUsable(s.token));
}

function setSessionMemory(token, source) {
    session.token = token;
    session.expiry = tokenExpiry(token);
    session.source = source || "";
}

function persistSession() {
    if (!sessionValid(session)) return Promise.resolve();
    var payload = JSON.stringify({ token: session.token, expiry: session.expiry });
    return Promise.all(getBackends().map(function(b) {
        return Promise.resolve().then(function() { return b.set(payload); }).catch(function() {});
    })).then(function() {
        log("  token saved (" + getBackends().map(function(b) { return b.name; }).join("+") + "), reusable for ~" +
            Math.round((session.expiry - Date.now()) / 60000) + " min");
    });
}

function loadStoredSession() {
    var list = getBackends();
    function tryBackend(i) {
        if (i >= list.length) return Promise.resolve(null);
        return Promise.resolve().then(function() { return list[i].get(); }).then(function(raw) {
            var s = null;
            try { s = raw ? JSON.parse(raw) : null; } catch (e) {}
            if (sessionValid(s)) return { s: s, from: list[i].name };
            return tryBackend(i + 1);
        }).catch(function() { return tryBackend(i + 1); });
    }
    return tryBackend(0).then(function(found) {
        if (!found) return false;
        session.token = found.s.token;
        session.expiry = found.s.expiry;
        session.source = "stored:" + found.from;
        log("  reusing saved token from", found.from, "(~" + Math.round((session.expiry - Date.now()) / 60000) + " min left)");
        return true;
    });
}

function clearSession() {
    session.token = null;
    session.expiry = 0;
    session.source = "";
    return Promise.all(getBackends().map(function(b) {
        return Promise.resolve().then(function() { return b.del(); }).catch(function() {});
    }));
}

// =========================================================================
// Unlock handshake (Vega-derived, no hosting)
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

function unlockSession() {
    var base = CONFIG.BASE_URL;
    log("  unlock: start");

    return fetch(base + "/mobile/home?app=1", { headers: appHomeHeaders() })
        .then(function(res) {
            var tok = tokenFromResponse(res);
            if (tok) { log("  unlock: token came with the first response"); return { token: tok }; }

            var initialCookie = cookiePairs(res).join("; ");
            return res.text().then(function(html) {
                var m = /data-addhash=["']([^"']+)["']/.exec(html);
                return { addhash: m ? m[1] : null, initialCookie: initialCookie };
            });
        })
        .then(function(state) {
            if (state.token) return state.token;
            if (!state.addhash) { logErr("  unlock: no data-addhash on the home page"); return null; }

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
                    if (tok) return tok;

                    return res.text().then(function(txt) {
                        var j = null;
                        try { j = JSON.parse(txt); } catch (e) {}
                        if (j && j.statusup === "All Done") {
                            log("  unlock: verified, reloading home for the token");
                            return fetch(base + "/mobile/home?app=1", { headers: appHomeHeaders(pollCookie) })
                                .then(function(r2) { return tokenFromResponse(r2); });
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

// =========================================================================
// Cookie for API calls
// =========================================================================

function cookieFromSession() {
    return "t_hash_t=" + session.token + "; hd=on; ott=" + CONFIG.OTT;
}

function getCookie(forceFresh) {
    if (CONFIG.COOKIE_OVERRIDE) return Promise.resolve(CONFIG.COOKIE_OVERRIDE);

    if (!forceFresh && sessionValid(session)) return Promise.resolve(cookieFromSession());

    var stored = forceFresh ? Promise.resolve(false) : loadStoredSession();
    return stored.then(function(ok) {
        if (ok) return cookieFromSession();

        return unlockSession().then(function(tok) {
            if (!tok) {
                logErr("  no token, continuing without it (may fail)");
                return "hd=on; ott=" + CONFIG.OTT;
            }
            setSessionMemory(tok, "unlock");
            return persistSession().then(cookieFromSession);
        });
    });
}

// =========================================================================
// API helpers
// =========================================================================

function apiHeaders(cookie, requestedWith) {
    var h = {
        "User-Agent": CONFIG.UA,
        "Referer": CONFIG.BASE_URL + "/home",
        "Origin": CONFIG.BASE_URL,
        "Accept": "application/json, text/plain, */*"
    };
    if (requestedWith) h["X-Requested-With"] = requestedWith;
    if (cookie) h["Cookie"] = cookie;
    return h;
}

function apiGet(path, cookie, requestedWith) {
    var url = path.indexOf("http") === 0 ? path : CONFIG.BASE_URL + path;
    return fetch(url, { headers: apiHeaders(cookie, requestedWith === undefined ? "XMLHttpRequest" : requestedWith) })
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
// TMDB / OMDb
// =========================================================================

function getTmdbInfo(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) return null;
            var main = mediaType === "tv" ? (d.name || d.original_name) : (d.title || d.original_title);
            var orig = mediaType === "tv" ? d.original_name : d.original_title;
            var date = d.release_date || d.first_air_date || "";
            var info = {
                titles: unique([main, orig]),
                year: date ? String(date).substring(0, 4) : ""
            };
            log("  tmdb: titles =", info.titles.join(" | "), "| year =", info.year || "?");
            return info;
        })
        .catch(function() { return null; });
}

function getOmdbTitle(tmdbId, mediaType) {
    if (!CONFIG.OMDB_API_KEY) return Promise.resolve(null);
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "/external_ids?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d || !d.imdb_id) return null;
            return fetch("https://www.omdbapi.com/?i=" + d.imdb_id + "&plot=short&r=json&apikey=" + CONFIG.OMDB_API_KEY)
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(o) {
                    var t = o && o.Response === "True" && o.Title ? o.Title : null;
                    log("  omdb title =", t);
                    return t;
                });
        })
        .catch(function() { return null; });
}

// =========================================================================
// Search + choosing the right entry
// =========================================================================

function searchContent(query, cookie) {
    function run(extra) {
        var path = mobilePath("search.php", true) + "?s=" + encodeURIComponent(query) + "&t=" + nowSec() + extra;
        return apiGet(path, cookie).then(function(d) {
            if (!d) return [];
            if (d.status === "n") { logErr("  search refused:", d.error || ""); return []; }
            var list = Array.isArray(d) ? d : (d.searchResult || d.results || d.data || []);
            var out = [];
            (Array.isArray(list) ? list : []).forEach(function(x) {
                var id = x && (x.id !== undefined ? x.id : x.ID);
                var title = x && (x.t || x.title || x.name);
                if (id !== undefined && id !== null && title) {
                    out.push({ id: String(id), title: String(title), year: x.y ? String(x.y) : "" });
                }
            });
            return out;
        });
    }
    return run("&ADSearch=false").then(function(items) {
        if (items.length) return items;
        return run("");
    }).then(function(items) {
        log("  search \"" + query + "\":", items.length, "results");
        return items;
    });
}

function postInfo(id, cookie) {
    return apiGet(mobilePath("post.php", true) + "?id=" + encodeURIComponent(id) + "&t=" + nowSec(), cookie);
}

function bestScore(item, scoreTitles) {
    var s = 0;
    scoreTitles.forEach(function(t) { s = Math.max(s, titleScore(item.title, t)); });
    return s;
}

function chooseCandidate(items, scoreTitles, year, isMovie, cookie) {
    var scored = items.map(function(it) {
        return { item: it, score: bestScore(it, scoreTitles) };
    }).filter(function(x) { return x.score >= CONFIG.MIN_SCORE; });
    if (!scored.length) return Promise.resolve(null);

    function pick(list, preferYear) {
        var best = null;
        var bestKey = -1;
        list.forEach(function(x) {
            var key = (preferYear && year && x.item.year === year ? 1000000 : 0) +
                langPriority(x.item.title) * 1000 + x.score;
            if (key > bestKey) { bestKey = key; best = x; }
        });
        return best ? best.item : null;
    }

    if (!year) return Promise.resolve(pick(scored, false));

    if (!isMovie) {
        return Promise.resolve(pick(scored, true));
    }

    var withYear = scored.filter(function(x) { return x.item.year === year; });
    if (withYear.length) return Promise.resolve(pick(withYear, false));

    var toCheck = scored.slice(0, CONFIG.MAX_YEAR_LOOKUPS);
    var matched = [];
    return toCheck.reduce(function(chain, x) {
        return chain.then(function() {
            return postInfo(x.item.id, cookie).then(function(post) {
                var py = post && post.year ? String(post.year) : "";
                log("  \"" + x.item.title + "\" -> year", py || "?");
                if (py === year) {
                    x.item.year = py;
                    x.item.post = post;
                    matched.push(x);
                }
            });
        });
    }, Promise.resolve()).then(function() {
        if (!matched.length) { logErr("  no movie with year", year); return null; }
        return pick(matched, false);
    });
}

function findContent(queries, scoreTitles, year, isMovie, cookie) {
    function tryQuery(i) {
        if (i >= queries.length) return Promise.resolve(null);
        return searchContent(queries[i], cookie).then(function(items) {
            if (!items.length) return tryQuery(i + 1);
            return chooseCandidate(items, scoreTitles, year, isMovie, cookie).then(function(hit) {
                if (hit) { log("  picked:", hit.title, "(" + (hit.year || "?") + ") id =", hit.id); return hit; }
                return tryQuery(i + 1);
            });
        });
    }
    return tryQuery(0);
}

// =========================================================================
// Series: seasons + episodes
// =========================================================================

function getSeasonEpisodes(seriesId, seasonId, cookie) {
    var all = [];
    function page(n) {
        if (n > 12) return Promise.resolve(all);
        var path = mobilePath("episodes.php", true) + "?s=" + encodeURIComponent(seasonId) +
            "&series=" + encodeURIComponent(seriesId) + "&t=" + nowSec() + (n > 1 ? "&page=" + n : "");
        return apiGet(path, cookie).then(function(d) {
            if (!d) return all;
            var eps = Array.isArray(d.episodes) ? d.episodes : [];
            all = all.concat(eps);
            var more = d.nextPageShow === 1 || d.nextPageShow === "1" || d.nextPageShow === true;
            if (eps.length && more) return page(d.nextPage ? Number(d.nextPage) || n + 1 : n + 1);
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
    return null;
}

function resolvePlayable(hit, isMovie, season, episode, cookie) {
    var postPromise = hit.post ? Promise.resolve(hit.post) : postInfo(hit.id, cookie);

    return postPromise.then(function(post) {
        if (!post) return null;
        var title = post.title || hit.title;
        log("  post: type =", post.type, "| title =", post.title);

        if (isMovie || post.type === "m") {
            return { playId: String(post.main_id || hit.id), title: title };
        }

        var seasons = Array.isArray(post.season) ? post.season : [];
        var inlineEps = Array.isArray(post.episodes) ? post.episodes : [];

        var wanted = null;
        seasons.forEach(function(s) {
            if (numberOf(s.s !== undefined ? s.s : (s.name !== undefined ? s.name : s.season)) === season) wanted = s;
        });
        if (!wanted && seasons.length === 1 && season === 1) wanted = seasons[0];

        function inlineForSeason() {
            if (!inlineEps.length) return [];
            var s0 = numberOf(inlineEps[0].s);
            return (s0 === null || s0 === season) ? inlineEps : [];
        }

        var epsPromise;
        if (wanted) {
            epsPromise = getSeasonEpisodes(hit.id, wanted.id, cookie).then(function(list) {
                return list.length ? list : inlineForSeason();
            });
        } else if (!seasons.length) {
            epsPromise = Promise.resolve(inlineEps);
        } else {
            logErr("  season", season, "not found (site has", seasons.length, "seasons)");
            epsPromise = Promise.resolve([]);
        }

        return epsPromise.then(function(list) {
            var ep = pickEpisode(list, episode);
            if (!ep || ep.id === undefined) {
                logErr("  S" + season + "E" + episode, "not found (" + list.length + " episodes seen)");
                return null;
            }
            log("  episode: S" + season + "E" + episode, "->", ep.t || "", "id", ep.id);
            return { playId: String(ep.id), title: title };
        });
    });
}

// =========================================================================
// Playlist + streams
// =========================================================================

function playlistPath(playId, title, withPrefix, extras) {
    return mobilePath("playlist.php", withPrefix) + "?id=" + encodeURIComponent(playId) +
        "&t=" + encodeURIComponent(title) + "&tm=" + nowSec() + (extras ? "&lang=null&hd=on" : "");
}

function normalizePlaylist(d) {
    var p = Array.isArray(d) ? d[0] : d;
    return p && Array.isArray(p.sources) && p.sources.length ? p : null;
}

function fetchPlaylist(playId, title, cookie) {
    return apiGet(playlistPath(playId, title, true, true), cookie, "app.netmirror.nmv2").then(function(d) {
        var p = normalizePlaylist(d);
        if (p) return p;
        return apiGet(playlistPath(playId, title, true, false), cookie).then(function(d2) {
            var p2 = normalizePlaylist(d2);
            if (p2) return p2;
            return apiGet(playlistPath(playId, title, false, false), cookie).then(normalizePlaylist);
        });
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

function getPlaylistChecked(playId, title, ctx) {
    function attempt(retried) {
        return fetchPlaylist(playId, title, ctx.cookie).then(function(pl) {
            if (!pl) return null;
            var first = absoluteUrl(pl.sources[0].file);
            if (!first) return null;

            return fetch(first, { headers: apiHeaders(ctx.cookie) })
                .then(function(r) { return r.text(); })
                .then(function(txt) { return isAbused(txt); })
                .catch(function() { return false; })
                .then(function(abused) {
                    if (!abused) return pl;
                    if (retried) { logErr("  session still rejected after retry"); return null; }
                    log("  session rejected, getting a fresh one");
                    return clearSession().then(function() { return getCookie(true); }).then(function(c) {
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
        var label = tr.label || "Unknown";
        subs.push({
            url: uri,
            uri: uri,
            title: label,
            language: label,
            default: label.toLowerCase().indexOf("english") !== -1,
            type: uri.indexOf(".vtt") !== -1 ? "text/vtt" : "application/x-subrip"
        });
    });
    return subs;
}

function streamHeaders(cookie) {
    return {
        "User-Agent": CONFIG.UA,
        "Referer": CONFIG.BASE_URL + "/",
        "Origin": CONFIG.BASE_URL,
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

        var q = "1080";
        var isAuto = false;
        var l = String(src.label || "").toLowerCase();
        if (l.indexOf("auto") !== -1) isAuto = true;
        else if (l.indexOf("full hd") !== -1 || url.indexOf("1080p") !== -1) q = "1080";
        else if (l.indexOf("mid hd") !== -1 || url.indexOf("720p") !== -1) q = "720";
        else if (l.indexOf("low hd") !== -1 || url.indexOf("480p") !== -1) q = "480";
        else if (l.indexOf("360p") !== -1) q = "360";

        var stream = {
            name: CONFIG.NAME,
            title: label + " " + (src.label || "HLS") + (isAuto ? "" : " (" + q + "p)"),
            url: url,
            quality: isAuto ? "Auto" : q + "p",
            headers: streamHeaders(cookie)
        };
        if (subs.length) stream.subtitles = subs;
        streams.push(stream);
    });

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

    return getTmdbInfo(tmdbId, mediaType).then(function(info) {
        if (!info || !info.titles.length) { logErr("no title, aborting"); return []; }

        return getOmdbTitle(tmdbId, mediaType).then(function(omdbTitle) {
            var scoreTitles = unique([omdbTitle].concat(info.titles));
            var queries = [];
            scoreTitles.forEach(function(t) {
                queries.push(t);
                var plain = plainSearchTitle(t);
                if (plain && plain !== t) queries.push(plain);
            });
            queries = unique(queries);

            var ctx = { cookie: null };
            return getCookie().then(function(cookie) {
                ctx.cookie = cookie;
                return findContent(queries, scoreTitles, info.year, isMovie, ctx.cookie);
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
        });
    }).catch(function(e) {
        logErr("outer exception:", e && e.message);
        return [];
    });
}

module.exports = {
    getStreams: getStreams,
    _internals: {
        getCookie: getCookie,
        unlockSession: unlockSession,
        searchContent: searchContent,
        findContent: findContent,
        chooseCandidate: chooseCandidate,
        postInfo: postInfo,
        getSeasonEpisodes: getSeasonEpisodes,
        resolvePlayable: resolvePlayable,
        getPlaylistChecked: getPlaylistChecked,
        buildStreams: buildStreams,
        isTokenUsable: isTokenUsable,
        langPriority: langPriority,
        cookiePairs: cookiePairs,
        getSession: function() { return { token: session.token, expiry: session.expiry, source: session.source }; },
        clearSession: clearSession,
        resetMemory: function() { session.token = null; session.expiry = 0; session.source = ""; },
        CONFIG: CONFIG
    }
};