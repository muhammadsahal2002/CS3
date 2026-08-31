/**
 * ICC FTP Server Provider for Nuvio
 * Uses TMDB for search and metadata
 * Plays local media files from ICC FTP Server
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "http://10.16.100.244",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
};

let currentSession = null;
let currentToken = null;

// ========== HELPERS ==========
function headers(extra) {
    var h = {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Referer": CONFIG.BASE_URL + "/",
        "X-Requested-With": "com.mycompany.app.soulbrowser"
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

function fixImage(path) {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return CONFIG.BASE_URL + "/" + path;
}

function extractId(url) {
    if (!url) return null;
    var match = url.match(/play=([^&]+)/);
    return match ? match[1] : null;
}

function createLink(id) {
    var session = currentSession || "";
    if (session) {
        return CONFIG.BASE_URL + "/player.php?session=" + session + "&play=" + id;
    }
    return CONFIG.BASE_URL + "/player.php?play=" + id;
}

function extractQuality(text) {
    if (!text) return null;
    var lower = text.toLowerCase();
    if (lower.includes("2160p") || lower.includes("4k")) return 2160;
    if (lower.includes("1080p")) return 1080;
    if (lower.includes("720p")) return 720;
    if (lower.includes("480p")) return 480;
    if (lower.includes("360p")) return 360;
    return null;
}

// ========== TMDB HELPERS ==========
function getTmdbTitle(tmdbId, mediaType) {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = CONFIG.TMDB_BASE + "/" + endpoint + "/" + tmdbId +
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

function getTmdbDetails(tmdbId, mediaType) {
    var endpoint = mediaType === "tv" ? "tv" : "movie";
    var url = CONFIG.TMDB_BASE + "/" + endpoint + "/" + tmdbId +
        "?api_key=" + CONFIG.TMDB_API_KEY;

    return fetch(url)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
            if (!data) return null;
            return {
                title: mediaType === "tv" ? (data.name || data.original_name) : (data.title || data.original_title),
                poster: data.poster_path ? "https://image.tmdb.org/t/p/w500" + data.poster_path : null,
                backdrop: data.backdrop_path ? "https://image.tmdb.org/t/p/w1280" + data.backdrop_path : null,
                year: mediaType === "tv" ? data.first_air_date : data.release_date,
                overview: data.overview,
                genres: data.genres ? data.genres.map(function(g) { return g.name; }) : [],
                seasons: mediaType === "tv" ? data.seasons : null
            };
        })
        .catch(function() { return null; });
}

// ========== SESSION MANAGEMENT ==========
function getSession() {
    if (currentSession) return Promise.resolve(currentSession);

    return fetch(CONFIG.BASE_URL, {
        headers: headers({ "Referer": "http://10.16.100.202/" })
    })
    .then(function(r) { return r.ok ? r.text() : null; })
    .then(function(html) {
        if (!html) throw new Error("Failed to connect to server");

        var match = html.match(/session=([a-f0-9]{20,})/);
        if (match) {
            currentSession = match[1];
        } else {
            // Try to get from cookies
            var cookies = html.match(/PHPSESSID=([a-f0-9]{20,})/);
            if (cookies) {
                currentSession = cookies[1];
            }
        }
        return currentSession || "";
    });
}

function getToken(session) {
    if (currentToken) return Promise.resolve(currentToken);

    var url = CONFIG.BASE_URL + "/dashboard.php?session=" + session + "&category=0";

    return fetch(url, { headers: headers() })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return "";
            var match = html.match(/name="token"\s+value="([^"]+)"/);
            if (match) {
                currentToken = match[1];
            }
            return currentToken || "";
        });
}

// ========== SEARCH ==========
function searchICC(query) {
    if (!query || query.trim().length === 0) return Promise.resolve([]);

    return getSession()
        .then(function(session) {
            return getToken(session).then(function(token) {
                var url = CONFIG.BASE_URL + "/dashboard.php?session=" + session;
                return fetch(url, {
                    method: "POST",
                    headers: headers({
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Origin": CONFIG.BASE_URL,
                        "Referer": url
                    }),
                    body: "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim())
                });
            });
        })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) return [];

            var $ = cheerio.load(html);
            var results = [];

            $(".post a.image[href*='play='], .post-wrapper > a[href*='play=']").each(function() {
                var a = $(this);
                var href = a.attr("href") || "";
                var id = extractId(href);
                if (!id) return;

                var post = a.closest(".post");
                var title = post ? post.find(".title").text().trim() : null;
                if (!title) title = a.find("img").attr("alt") || "";

                var image = a.find("img").attr("src") || "";

                if (title) {
                    results.push({
                        title: title,
                        url: createLink(id),
                        poster: fixImage(image)
                    });
                }
            });

            return results;
        })
        .catch(function() { return []; });
}

// ========== LOAD ==========
function loadICC(url) {
    var id = extractId(url);
    if (!id) return Promise.reject(new Error("Invalid URL"));

    return getSession()
        .then(function(session) {
            // Record visit
            return fetch(CONFIG.BASE_URL + "/command.php", {
                method: "POST",
                headers: headers({
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                }),
                body: "id=" + id + "&type=visit"
            }).catch(function() { return null; });
        })
        .then(function() {
            var playerUrl = CONFIG.BASE_URL + "/player.php?session=" + session + "&play=" + id;
            return fetch(playerUrl, { headers: headers() });
        })
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(html) {
            if (!html) throw new Error("Failed to load player");

            var $ = cheerio.load(html);
            var modal = $(".modal-dialog");

            var title = modal.find(".modal-title").text().trim() || $("title").text().replace("ICC FTP SERVER", "").trim();
            var poster = "";
            var year = null;
            var genre = "";
            var description = "";
            var category = "";
            var videoUrls = [];

            modal.find("table.ewTable tr").each(function() {
                var cells = $(this).find("td");
                if (cells.length >= 2) {
                    var label = $(cells[0]).text().trim().replace(":", "");
                    var value = $(cells[1]).text().trim();
                    switch (label) {
                        case "Generic Name": genre = value; break;
                        case "Category": category = value; break;
                        case "Year": year = parseInt(value) || null; break;
                        case "Discription":
                        case "Description": description = value; break;
                    }
                }
            });

            var img = modal.find("img");
            if (img.length) poster = fixImage(img.attr("src"));

            modal.find("a[href]").each(function() {
                var href = $(this).attr("href") || "";
                if (href.includes(".mp4") || href.includes(".mkv") || href.includes(".avi")) {
                    videoUrls.push(href.startsWith("http") ? href : CONFIG.BASE_URL + "/" + href);
                }
            });

            if (videoUrls.length === 0) {
                $("video source, video").each(function() {
                    var src = $(this).attr("src") || $(this).attr("data-src") || "";
                    if (src) {
                        videoUrls.push(src.startsWith("http") ? src : CONFIG.BASE_URL + "/" + src);
                    }
                });
            }

            var tags = genre.split(",").map(function(t) { return t.trim(); }).filter(function(t) { return t; });
            var isSeries = title.toLowerCase().includes("season") ||
                title.toLowerCase().includes("episode") ||
                category.toLowerCase().includes("serials");

            var dataUrl = videoUrls.length > 0 ? videoUrls.join("||") : playerUrl;

            return {
                id: id,
                title: title,
                poster: poster,
                year: year,
                description: description,
                genre: genre,
                category: category,
                tags: tags,
                isSeries: isSeries,
                url: dataUrl,
                videoUrls: videoUrls
            };
        });
}

// ========== LOAD LINKS ==========
function loadLinks(data) {
    var videoUrls = [];

    if (data.includes("||")) {
        videoUrls = data.split("||").map(function(s) { return s.trim(); }).filter(function(s) { return s; });
    } else if (data.includes(".mp4") || data.includes(".mkv") || data.includes(".avi")) {
        videoUrls.push(data);
    } else {
        // Try to extract from URL
        var id = extractId(data);
        if (id) {
            return loadICC(data).then(function(result) {
                return loadLinks(result.url);
            });
        }
        return Promise.resolve([]);
    }

    var streams = [];
    videoUrls.forEach(function(url) {
        var quality = extractQuality(url) || 1080;
        var qualityLabel = quality + "p";
        streams.push({
            name: "ICC FTP",
            title: qualityLabel,
            url: url,
            quality: qualityLabel,
            headers: {
                "Referer": CONFIG.BASE_URL + "/",
                "User-Agent": CONFIG.USER_AGENT,
                "Range": "bytes=0-"
            }
        });
    });

    return Promise.resolve(streams);
}

// ========== MAIN EXPORTED FUNCTION ==========
function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    console.log("[ICC FTP] Searching for TMDB ID:", tmdbId, "Type:", mediaType, "S" + season + "E" + episode);

    return getTmdbDetails(tmdbId, mediaType)
        .then(function(details) {
            if (!details) {
                console.log("[ICC FTP] Failed to get TMDB details");
                return [];
            }

            console.log("[ICC FTP] Found:", details.title);

            // Search ICC FTP server for the title
            return searchICC(details.title)
                .then(function(results) {
                    if (results.length === 0) {
                        // Try searching without year or with alternative title
                        var searchTitle = details.title.replace(/\s*\(\d{4}\)\s*/, "").trim();
                        if (searchTitle !== details.title) {
                            return searchICC(searchTitle);
                        }
                        return [];
                    }
                    return results;
                });
        })
        .then(function(results) {
            if (results.length === 0) {
                console.log("[ICC FTP] No results found");
                return [];
            }

            // Find best match (prefer exact title match)
            var bestMatch = results[0];
            var targetTitle = details ? details.title.toLowerCase() : "";

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                var rTitle = r.title.toLowerCase();
                if (rTitle === targetTitle) {
                    bestMatch = r;
                    break;
                }
                // Prefer matches that contain the full title
                if (rTitle.indexOf(targetTitle) !== -1 || targetTitle.indexOf(rTitle) !== -1) {
                    bestMatch = r;
                }
            }

            console.log("[ICC FTP] Selected:", bestMatch.title);

            return loadICC(bestMatch.url)
                .then(function(data) {
                    if (!data) {
                        console.log("[ICC FTP] Failed to load content");
                        return [];
                    }

                    // If it's a movie or no season/episode specified
                    if (!data.isSeries || mediaType === "movie") {
                        return loadLinks(data.url);
                    }

                    // For series, we need to find the specific episode
                    // Since ICC FTP doesn't have structured episode data,
                    // we search again with the episode title
                    var episodeTitle = details.title + " S" + season + "E" + episode;
                    if (data.episodes && data.episodes.length > 0) {
                        // Find matching episode
                        var ep = data.episodes.find(function(e) {
                            return e.season === season && e.episode === episode;
                        });
                        if (ep) {
                            return loadICC(createLink(ep.id)).then(function(epData) {
                                return loadLinks(epData.url);
                            });
                        }
                    }

                    // Fallback: try to load the episode URL directly
                    var epUrl = CONFIG.BASE_URL + "/player.php?play=" + data.id + "&s=" + season + "&e=" + episode;
                    return loadICC(epUrl).then(function(epData) {
                        return loadLinks(epData.url);
                    }).catch(function() {
                        return loadLinks(data.url);
                    });
                });
        })
        .catch(function(err) {
            console.log("[ICC FTP] Error:", err.message);
            return [];
        });
}

// ========== ADDITIONAL EXPORTS ==========
module.exports = {
    getStreams: getStreams,
    // Expose internal functions for testing
    searchICC: searchICC,
    loadICC: loadICC,
    loadLinks: loadLinks,
    getSession: getSession,
    getToken: getToken
};