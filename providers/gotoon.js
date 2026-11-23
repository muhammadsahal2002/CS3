/**
 * GoToon.tv Provider for Nuvio  (pure JS, no dependencies)
 *
 * Flow (from the captured requests):
 *   1. TMDB id  -> title (and episode name for series)
 *   2. GET  /?s=<title>                      -> search results (shows live under /tv-show/)
 *   3. GET  /tv-show/<slug>/                 -> "Season N" blocks, each with its episode list
 *   4. GET  /episode/<slug>/?series=<id>     -> page has the direct .mp4 url
 *   5. play https://ww.gotoon.tv/cartoons/<show>/<episode>.mp4
 *      with Referer: https://www.gotoon.tv/
 *
 * Movies: gotoon has no movie section, so a movie request only works
 * when the title exists as a single /episode/ page (cartoon movies / specials).
 */

"use strict";

var LOG = "[GoToon]";
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
    BASE_URL: "https://www.gotoon.tv",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36",
    MIN_SHOW_SCORE: 40,     // below this a show match is rejected
    MIN_MOVIE_SCORE: 60,    // movies must match more strictly
    MAX_SEARCH_PAGES: 3
};

// =========================================================================
// Tiny HTML helpers (replace cheerio)
// =========================================================================

var NAMED_ENTITIES = {
    nbsp: " ", lt: "<", gt: ">", quot: "\"", apos: "'",
    rsquo: "\u2019", lsquo: "\u2018", rdquo: "\u201d", ldquo: "\u201c",
    ndash: "\u2013", mdash: "\u2014", hellip: "\u2026"
};

function decodeEntities(s) {
    return String(s || "")
        .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(parseInt(n, 10)); })
        .replace(/&#x([0-9a-f]+);/gi, function(m, n) { return String.fromCharCode(parseInt(n, 16)); })
        .replace(/&([a-z]+);/gi, function(m, name) {
            var v = NAMED_ENTITIES[name.toLowerCase()];
            return v !== undefined ? v : m;
        })
        .replace(/&amp;/g, "&");
}

function stripTags(s) {
    return decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// value of an attribute inside one tag string, e.g. attr('<a href="x">', "href") -> "x"
function attr(tag, name) {
    var re = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
    var m = re.exec(tag);
    if (!m) return null;
    return decodeEntities(m[1] !== undefined ? m[1] : m[2]);
}

// [{ open: "<article ...>", html: "...inner..." }] for every <article> in the html
function splitArticles(html) {
    var out = [];
    var parts = String(html || "").split(/<article\b/i);
    parts.shift();
    for (var i = 0; i < parts.length; i++) {
        var chunk = parts[i].split(/<\/article>/i)[0];
        var gt = chunk.indexOf(">");
        if (gt === -1) continue;
        out.push({ open: "<article" + chunk.slice(0, gt + 1), html: chunk.slice(gt + 1) });
    }
    return out;
}

// first <h3 class="...entry-title..."><a href=..>Title</a> in a chunk -> { href, title }
var H3_LINK_RE = /<h3[^>]*entry-title[^>]*>\s*(<a\b[^>]*>)([\s\S]*?)<\/a>/i;

function readTitleLink(chunk) {
    var m = H3_LINK_RE.exec(chunk);
    if (!m) return null;
    var href = attr(m[1], "href");
    if (!href) return null;
    var title = stripTags(m[2]) || attr(m[1], "title") || "";
    if (!title) return null;
    return { href: href, title: title };
}

// =========================================================================
// Text helpers
// =========================================================================

function stripDiacritics(str) {
    var s = String(str || "");
    try {
        s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {}
    return s;
}

// lowercase, & -> and, strip punctuation, drop leading "the "
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

// 0-100 (100 = identical after normalize)
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

function slugify(str) {
    return stripDiacritics(str)
        .toLowerCase()
        .replace(/['\u2018\u2019]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function absUrl(u) {
    if (!u) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return CONFIG.BASE_URL + u;
    return u;
}

// =========================================================================
// HTTP
// =========================================================================

function pageHeaders(referer) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.5"
    };
    if (referer) h["Referer"] = referer;
    return h;
}

function fetchText(url, referer) {
    return fetch(url, { headers: pageHeaders(referer) })
        .then(function(r) {
            log("  GET", url, "-> HTTP", r.status);
            return r.ok ? r.text() : null;
        })
        .catch(function(e) { logErr("  fetch failed:", url, e && e.message); return null; });
}

// =========================================================================
// TMDB
// =========================================================================

function getTmdbInfo(tmdbId, mediaType) {
    var url = CONFIG.TMDB_BASE + "/" + (mediaType === "tv" ? "tv" : "movie") + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            if (!d) return null;
            var titles = [];
            var main = mediaType === "tv" ? (d.name || d.original_name) : (d.title || d.original_title);
            var orig = mediaType === "tv" ? d.original_name : d.original_title;
            if (main) titles.push(main);
            if (orig && orig !== main) titles.push(orig);
            log("  tmdb: titles =", titles.join(" | "));
            return { titles: titles };
        })
        .catch(function() { return null; });
}

function getTmdbEpisodeName(tmdbId, season, episode) {
    var url = CONFIG.TMDB_BASE + "/tv/" + tmdbId + "/season/" + season + "/episode/" + episode +
        "?api_key=" + CONFIG.TMDB_API_KEY;
    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
            var n = d && d.name ? d.name : null;
            log("  tmdb: episode name =", n);
            return n;
        })
        .catch(function() { return null; });
}

// =========================================================================
// Search
// =========================================================================

// html of one search page -> [{ title, url, isShow }]
function parseSearchHtml(html) {
    var out = [];
    splitArticles(html).forEach(function(art) {
        if (!/post-item/.test(art.open)) return;
        var link = readTitleLink(art.html);
        if (!link) return;
        out.push({
            title: link.title,
            url: absUrl(link.href),
            isShow: /vid_series/.test(art.open) || link.href.indexOf("/tv-show/") !== -1
        });
    });
    return out;
}

// One search page -> [{ title, url, isShow }]
function searchPage(query, page) {
    var url = page > 1
        ? CONFIG.BASE_URL + "/page/" + page + "/?s=" + encodeURIComponent(query)
        : CONFIG.BASE_URL + "/?s=" + encodeURIComponent(query);

    return fetchText(url, CONFIG.BASE_URL + "/").then(function(html) {
        if (!html) return [];
        var out = parseSearchHtml(html);
        log("  search p" + page + ": " + out.length + " results (" +
            out.filter(function(r) { return r.isShow; }).length + " shows)");
        return out;
    });
}

// Walk search pages until a pick function accepts something
function searchUntil(query, pickFn) {
    var all = [];
    function go(page) {
        if (page > CONFIG.MAX_SEARCH_PAGES) return Promise.resolve(pickFn(all));
        return searchPage(query, page).then(function(items) {
            if (!items.length) return pickFn(all);
            all = all.concat(items);
            var picked = pickFn(all, true);   // true = only stop early on a strong match
            return picked ? picked : go(page + 1);
        });
    }
    return go(1);
}

function bestByTitle(items, titles, wantShow, minScore, strongOnly) {
    var best = null;
    var bestScore = -1;
    items.forEach(function(it) {
        if (wantShow !== it.isShow) return;
        var s = 0;
        titles.forEach(function(t) { s = Math.max(s, titleScore(it.title, t)); });
        if (s > bestScore) { bestScore = s; best = it; }
    });
    if (!best) return null;
    if (strongOnly && bestScore < 100) return null;   // keep paging unless exact
    if (bestScore < minScore) return null;
    log("  match:", best.title, "(score " + bestScore.toFixed(1) + ")", best.url);
    return best;
}

// Direct /tv-show/<slug>/ guess when search does not surface the show
function guessShowBySlug(titles) {
    var tried = {};
    function tryTitle(i) {
        if (i >= titles.length) return Promise.resolve(null);
        var slug = slugify(titles[i]);
        if (!slug || tried[slug]) return tryTitle(i + 1);
        tried[slug] = true;
        var url = CONFIG.BASE_URL + "/tv-show/" + slug + "/";
        return fetchText(url, CONFIG.BASE_URL + "/").then(function(html) {
            if (html && html.indexOf("series-heading") !== -1) {
                var m = /<h1[^>]*entry-title[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
                var h1 = m ? stripTags(m[1]) : titles[i];
                log("  slug guess hit:", url);
                return { title: h1 || titles[i], url: url, isShow: true };
            }
            return tryTitle(i + 1);
        });
    }
    return tryTitle(0);
}

function findShow(titles) {
    function tryQuery(i) {
        if (i >= titles.length) return Promise.resolve(null);
        return searchUntil(titles[i], function(items, strongOnly) {
            return bestByTitle(items, titles, true, CONFIG.MIN_SHOW_SCORE, strongOnly);
        }).then(function(show) {
            return show || tryQuery(i + 1);
        });
    }
    return tryQuery(0).then(function(show) {
        return show || guessShowBySlug(titles);
    });
}

// Movie = single /episode/ page whose title matches
function findMovie(titles) {
    function tryQuery(i) {
        if (i >= titles.length) return Promise.resolve(null);
        return searchUntil(titles[i], function(items, strongOnly) {
            return bestByTitle(items, titles, false, CONFIG.MIN_MOVIE_SCORE, strongOnly);
        }).then(function(m) {
            return m || tryQuery(i + 1);
        });
    }
    return tryQuery(0);
}

// =========================================================================
// Series page -> seasons
// =========================================================================

function readEpisodes(segmentHtml) {
    var eps = [];
    splitArticles(segmentHtml).forEach(function(art) {
        var link = readTitleLink(art.html);
        if (!link || link.href.indexOf("/episode/") === -1) return;
        eps.push({ title: link.title, url: absUrl(link.href) });
    });
    return eps;
}

// html of a series page -> [{ season: 1, label: "Season 1", episodes: [{ title, url }] }]
function parseSeasonsHtml(html) {
    var end = html.indexOf("</main>");
    var doc = end !== -1 ? html.slice(0, end) : html;

    var blocks = [];
    var headRe = /<div[^>]*class="[^"]*\bseries-heading\b[^"]*"[^>]*>/gi;
    var starts = [];
    var m;
    while ((m = headRe.exec(doc)) !== null) starts.push(m.index);

    for (var i = 0; i < starts.length; i++) {
        var seg = doc.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : doc.length);
        var itemsAt = seg.search(/<div[^>]*class="[^"]*\bblog-items\b/i);
        var labelHtml = itemsAt !== -1 ? seg.slice(0, itemsAt) : seg.slice(0, 400);
        var label = stripTags(labelHtml);
        var sm = /season\s*(\d+)/i.exec(label);
        var eps = readEpisodes(itemsAt !== -1 ? seg.slice(itemsAt) : seg);
        if (eps.length) {
            blocks.push({ season: sm ? parseInt(sm[1], 10) : null, label: label, episodes: eps });
        }
    }

    // no season headings -> treat the whole list as season 1
    if (!blocks.length) {
        var itemsFrom = doc.search(/<div[^>]*class="[^"]*\bblog-items\b/i);
        var all = readEpisodes(itemsFrom !== -1 ? doc.slice(itemsFrom) : doc);
        if (all.length) blocks.push({ season: 1, label: "Season 1", episodes: all });
    }
    return blocks;
}

// returns [{ season: 1, label: "Season 1", episodes: [{ title, url }] }]
function getSeasons(seriesUrl) {
    return fetchText(seriesUrl, CONFIG.BASE_URL + "/").then(function(html) {
        if (!html) return [];
        var blocks = parseSeasonsHtml(html);
        log("  seasons:", blocks.map(function(b) {
            return (b.season || "?") + " (" + b.episodes.length + " eps)";
        }).join(", ") || "none");
        return blocks;
    });
}

// Pick the episode. Order: TMDB episode name inside the season -> position E in season S
// -> same name in any season.
function pickEpisode(blocks, season, episode, tmdbEpisodeName) {
    if (!blocks.length) return null;

    var block = null;
    var i;
    for (i = 0; i < blocks.length; i++) {
        if (blocks[i].season === season) { block = blocks[i]; break; }
    }
    if (!block && blocks.length >= season) block = blocks[season - 1];

    function byName(list) {
        if (!tmdbEpisodeName) return null;
        var n = normalize(tmdbEpisodeName);
        if (!n) return null;
        for (var k = 0; k < list.length; k++) {
            if (normalize(list[k].title) === n) return list[k];
        }
        return null;
    }

    var hit = block ? byName(block.episodes) : null;
    if (hit) { log("  episode: matched by name in season", season, "->", hit.title); return hit; }

    if (block && block.episodes[episode - 1]) {
        var ep = block.episodes[episode - 1];
        log("  episode: by position S" + season + "E" + episode, "->", ep.title);
        return ep;
    }

    var all = [];
    blocks.forEach(function(b) { all = all.concat(b.episodes); });
    hit = byName(all);
    if (hit) { log("  episode: matched by name in other season ->", hit.title); return hit; }

    logErr("  episode: S" + season + "E" + episode, "not found");
    return null;
}

// =========================================================================
// Episode page -> direct video url
// =========================================================================

function cleanUrl(u) {
    if (!u) return null;
    var s = decodeEntities(String(u).replace(/\\\//g, "/")).trim();
    if (!s || s.indexOf("javascript:") === 0) return null;
    return absUrl(s);
}

// html of an episode page -> direct media url (or null)
function parseVideoHtml(html) {
    var cands = [];
    var m;

    // 1) the <video> / <source> the player actually uses
    var tagRe = /<(?:video|source)\b[^>]*>/gi;
    while ((m = tagRe.exec(html)) !== null) {
        var s = attr(m[0], "src");
        if (s) cands.push(s);
    }
    // 2) meta og:video / og:video:url (either attribute order)
    var metaRe = /<meta\b[^>]*>/gi;
    while ((m = metaRe.exec(html)) !== null) {
        var p = attr(m[0], "property");
        if (p === "og:video:url" || p === "og:video") {
            var c = attr(m[0], "content");
            if (c) cands.push(c);
        }
    }
    // 3) page settings JSON / json-ld
    var m1 = /"single_video_url"\s*:\s*"([^"]+)"/.exec(html);
    if (m1) cands.push(m1[1]);
    var m2 = /"contentUrl"\s*:\s*"([^"]+\.(?:mp4|m3u8)[^"]*)"/i.exec(html);
    if (m2) cands.push(m2[1]);
    // 4) any direct media url on the page
    var m3 = /https?:\\?\/\\?\/[^"'\s<>]+\.(?:mp4|m3u8)/i.exec(html);
    if (m3) cands.push(m3[0]);

    for (var i = 0; i < cands.length; i++) {
        var u = cleanUrl(cands[i]);
        if (u && /\.(mp4|m3u8)(\?|$)/i.test(u)) return u;
    }
    return null;
}

function getVideoUrl(episodeUrl, referer) {
    return fetchText(episodeUrl, referer || CONFIG.BASE_URL + "/").then(function(html) {
        if (!html) return null;
        var u = parseVideoHtml(html);
        if (u) log("  video url =", u);
        else logErr("  no video url on", episodeUrl);
        return u;
    });
}

function makeStream(url, label) {
    return {
        name: "GoToon",
        title: label,
        url: url,
        quality: "GoToon",
        headers: {
            "User-Agent": CONFIG.USER_AGENT,
            "Referer": CONFIG.BASE_URL + "/"
        }
    };
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

        if (isMovie) {
            return findMovie(info.titles).then(function(movie) {
                if (!movie) { logErr("movie not found on gotoon"); return []; }
                return getVideoUrl(movie.url).then(function(video) {
                    if (!video) return [];
                    log("  SUCCESS");
                    return [makeStream(video, movie.title)];
                });
            });
        }

        return findShow(info.titles).then(function(show) {
            if (!show) { logErr("show not found on gotoon"); return []; }

            return Promise.all([
                getSeasons(show.url),
                getTmdbEpisodeName(tmdbId, season, episode)
            ]).then(function(res) {
                var blocks = res[0];
                var ep = pickEpisode(blocks, season, episode, res[1]);
                if (!ep) return [];

                return getVideoUrl(ep.url, show.url).then(function(video) {
                    if (!video) return [];
                    var tag = "S" + (season < 10 ? "0" : "") + season + "E" + (episode < 10 ? "0" : "") + episode;
                    log("  SUCCESS");
                    return [makeStream(video, tag + " - " + ep.title)];
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
    // used only by test-gotoon.js
    _internals: {
        searchPage: searchPage,
        findShow: findShow,
        findMovie: findMovie,
        getSeasons: getSeasons,
        pickEpisode: pickEpisode,
        getVideoUrl: getVideoUrl,
        makeStream: makeStream,
        parseSearchHtml: parseSearchHtml,
        parseSeasonsHtml: parseSeasonsHtml,
        parseVideoHtml: parseVideoHtml,
        CONFIG: CONFIG
    }
};
