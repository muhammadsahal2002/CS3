/**
 * ICC FTP Server Provider for Nuvio
 * Based on Kotlin CloudStream3 implementation
 * Uses TMDB for search and metadata
 */

"use strict";

var cheerio = require("cheerio-without-node-native");

var CONFIG = {
    BASE_URL: "http://10.16.100.244",
    TMDB_API_KEY: "439c478a771f35c05022f9feabcca01c",
    TMDB_BASE: "https://api.themoviedb.org/3",
    USER_AGENT: "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
};

// ========== STATE ==========
var currentSession = null;
var currentToken = null;

// ========== HELPERS ==========
function getHeaders() {
    return {
        "User-Agent": CONFIG.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Referer": CONFIG.BASE_URL + "/",
        "X-Requested-With": "com.mycompany.app.soulbrowser"
    };
}

function fixImage(path) {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return CONFIG.BASE_URL + "/" + path;
}

function extractId(url) {
    if (!url) return "";
    var after = url.split("play=");
    if (after.length < 2) return "";
    return after[1].split("&")[0] || "";
}

function createLink(id) {
    if (!id) return "";
    var session = currentSession || "";
    if (session) {
        return CONFIG.BASE_URL + "/player.php?session=" + session + "&play=" + id;
    }
    return CONFIG.BASE_URL + "/player.php?play=" + id;
}

function extractQuality(text) {
    if (!text) return null;
    var lower = text.toLowerCase();
    var patterns = [
        ["2160p", 2160],
        ["4k", 2160],
        ["1080p", 1080],
        ["720p", 720],
        ["480p", 480],
        ["360p", 360]
    ];
    for (var i = 0; i < patterns.length; i++) {
        if (lower.indexOf(patterns[i][0]) !== -1) {
            return patterns[i][1];
        }
    }
    return null;
}

// ========== SESSION MANAGEMENT ==========
function getSession() {
    return new Promise(function(resolve, reject) {
        if (currentSession) {
            resolve(currentSession);
            return;
        }

        console.log("[ICC FTP] Getting session...");

        fetch(CONFIG.BASE_URL, {
            headers: {
                "User-Agent": CONFIG.USER_AGENT,
                "Referer": "http://10.16.100.202/"
            }
        })
        .then(function(r) {
            if (!r.ok) throw new Error("Failed to connect to server");
            return r.text();
        })
        .then(function(html) {
            // Try to extract session from page
            var match = html.match(/session=([a-f0-9]{40,})/);
            if (match) {
                currentSession = match[1];
                console.log("[ICC FTP] Session found in HTML:", currentSession.substring(0, 20) + "...");
                resolve(currentSession);
                return;
            }

            // Try to get from cookies
            var cookieMatch = html.match(/PHPSESSID=([a-f0-9]{32,})/);
            if (cookieMatch) {
                currentSession = cookieMatch[1];
                console.log("[ICC FTP] Session found in cookie:", currentSession.substring(0, 20) + "...");
                resolve(currentSession);
                return;
            }

            console.log("[ICC FTP] No session found, using empty");
            currentSession = "";
            resolve(currentSession);
        })
        .catch(function(err) {
            console.log("[ICC FTP] Session error:", err.message);
            reject(err);
        });
    });
}

function getToken(session) {
    return new Promise(function(resolve, reject) {
        if (currentToken) {
            resolve(currentToken);
            return;
        }

        console.log("[ICC FTP] Getting token...");

        var url = CONFIG.BASE_URL + "/dashboard.php?session=" + session + "&category=0";

        fetch(url, { headers: getHeaders() })
        .then(function(r) {
            if (!r.ok) throw new Error("Failed to fetch dashboard");
            return r.text();
        })
        .then(function(html) {
            var match = html.match(/name="token"\s+value="([^"]+)"/);
            if (match) {
                currentToken = match[1];
                console.log("[ICC FTP] Token found:", currentToken);
                resolve(currentToken);
            } else {
                console.log("[ICC FTP] No token found, using empty");
                currentToken = "";
                resolve(currentToken);
            }
        })
        .catch(function(err) {
            console.log("[ICC FTP] Token error:", err.message);
            reject(err);
        });
    });
}

// ========== TMDB HELPERS ==========
function getTmdbDetails(tmdbId, mediaType) {
    return new Promise(function(resolve, reject) {
        var endpoint = mediaType === "tv" ? "tv" : "movie";
        var url = CONFIG.TMDB_BASE + "/" + endpoint + "/" + tmdbId +
            "?api_key=" + CONFIG.TMDB_API_KEY;

        console.log("[ICC FTP] Fetching TMDB details for:", tmdbId);

        fetch(url)
        .then(function(r) {
            if (!r.ok) throw new Error("TMDB request failed: " + r.status);
            return r.json();
        })
        .then(function(data) {
            if (!data) {
                resolve(null);
                return;
            }
            var result = {
                title: mediaType === "tv" ? (data.name || data.original_name) : (data.title || data.original_title),
                poster: data.poster_path ? "https://image.tmdb.org/t/p/w500" + data.poster_path : null,
                backdrop: data.backdrop_path ? "https://image.tmdb.org/t/p/w1280" + data.backdrop_path : null,
                year: mediaType === "tv" ? data.first_air_date : data.release_date,
                overview: data.overview,
                genres: data.genres ? data.genres.map(function(g) { return g.name; }) : [],
                seasons: mediaType === "tv" ? data.seasons : null
            };
            console.log("[ICC FTP] TMDB found:", result.title);
            resolve(result);
        })
        .catch(function(err) {
            console.log("[ICC FTP] TMDB error:", err.message);
            reject(err);
        });
    });
}

// ========== SEARCH ==========
function searchICC(query) {
    return new Promise(function(resolve, reject) {
        if (!query || query.trim().length === 0) {
            resolve([]);
            return;
        }

        console.log("[ICC FTP] Searching for:", query);

        getSession()
        .then(function(session) {
            return getToken(session);
        })
        .then(function(token) {
            var url = CONFIG.BASE_URL + "/dashboard.php?session=" + session;
            var body = "token=" + encodeURIComponent(token) + "&psearch=" + encodeURIComponent(query.trim());

            console.log("[ICC FTP] POST to:", url);
            console.log("[ICC FTP] Body:", body);

            return fetch(url, {
                method: "POST",
                headers: getHeaders(),
                body: body
            });
        })
        .then(function(r) {
            if (!r.ok) {
                console.log("[ICC FTP] Search response status:", r.status);
                resolve([]);
                return;
            }
            return r.text();
        })
        .then(function(html) {
            if (!html) {
                console.log("[ICC FTP] No HTML response");
                resolve([]);
                return;
            }

            //console.log("[ICC FTP] HTML preview:", html.substring(0, 300));

            var $ = cheerio.load(html);
            var results = [];

            // Parse search results like Kotlin version
            $(".post a.image[href*='play='], .post-wrapper > a[href*='play=']").each(function() {
                var a = $(this);
                var href = a.attr("href") || "";
                var id = extractId(href);
                if (!id) return;

                var post = a.closest(".post");
                var title = "";
                if (post) {
                    title = post.find(".title").text().trim();
                }
                if (!title) {
                    title = a.find("img").attr("alt") || "";
                }
                if (!title) return;

                var image = a.find("img").attr("src") || "";

                results.push({
                    title: title,
                    url: createLink(id),
                    poster: fixImage(image),
                    id: id
                });
            });

            console.log("[ICC FTP] Found", results.length, "results");
            resolve(results);
        })
        .catch(function(err) {
            console.log("[ICC FTP] Search error:", err.message);
            resolve([]);
        });
    });
}

// ========== LOAD ==========
function loadICC(url) {
    return new Promise(function(resolve, reject) {
        var id = extractId(url);
        if (!id) {
            console.log("[ICC FTP] No ID found in URL:", url);
            reject(new Error("Invalid URL"));
            return;
        }

        console.log("[ICC FTP] Loading ID:", id);

        getSession()
        .then(function(session) {
            // Record visit (like Kotlin version)
            return fetch(CONFIG.BASE_URL + "/command.php", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "User-Agent": CONFIG.USER_AGENT,
                    "Referer": CONFIG.BASE_URL + "/"
                },
                body: "id=" + id + "&type=visit"
            }).catch(function() { return null; });
        })
        .then(function() {
            var playerUrl = CONFIG.BASE_URL + "/player.php?session=" + session + "&play=" + id;
            console.log("[ICC FTP] Player URL:", playerUrl);
            return fetch(playerUrl, { headers: getHeaders() });
        })
        .then(function(r) {
            if (!r.ok) {
                console.log("[ICC FTP] Player response status:", r.status);
                throw new Error("Failed to load player");
            }
            return r.text();
        })
        .then(function(html) {
            var $ = cheerio.load(html);
            var modal = $(".modal-dialog");

            var title = modal.find(".modal-title").text().trim();
            if (!title) {
                title = $("title").text().replace("ICC FTP SERVER", "").trim();
            }

            var poster = "";
            var year = null;
            var genre = "";
            var description = "";
            var category = "";
            var videoUrls = [];

            // Parse table like Kotlin version
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
            if (img.length) {
                poster = fixImage(img.attr("src"));
            }

            // Find video links
            modal.find("a[href]").each(function() {
                var href = $(this).attr("href") || "";
                if (href.indexOf(".mp4") !== -1 || href.indexOf(".mkv") !== -1 || href.indexOf(".avi") !== -1) {
                    var full = href.startsWith("http") ? href : CONFIG.BASE_URL + "/" + href;
                    videoUrls.push(full);
                }
            });

            if (videoUrls.length === 0) {
                $("video source, video").each(function() {
                    var src = $(this).attr("src") || $(this).attr("data-src") || "";
                    if (src) {
                        var full = src.startsWith("http") ? src : CONFIG.BASE_URL + "/" + src;
                        videoUrls.push(full);
                    }
                });
            }

            var isSeries = title.toLowerCase().indexOf("season") !== -1 ||
                title.toLowerCase().indexOf("episode") !== -1 ||
                category.toLowerCase().indexOf("serials") !== -1;

            var dataUrl = videoUrls.length > 0 ? videoUrls.join("||") : playerUrl;

            resolve({
                id: id,
                title: title,
                poster: poster,
                year: year,
                description: description,
                genre: genre,
                category: category,
                isSeries: isSeries,
                url: dataUrl,
                videoUrls: videoUrls
            });
        })
        .catch(function(err) {
            console.log("[ICC FTP] Load error:", err.message);
            reject(err);
        });
    });
}

// ========== LOAD LINKS ==========
function loadLinks(data) {
    return new Promise(function(resolve) {
        var videoUrls = [];

        if (data.indexOf("||") !== -1) {
            videoUrls = data.split("||").map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        } else if (data.indexOf(".mp4") !== -1 || data.indexOf(".mkv") !== -1 || data.indexOf(".avi") !== -1) {
            videoUrls.push(data);
        } else {
            var id = extractId(data);
            if (id) {
                loadICC(data).then(function(result) {
                    loadLinks(result.url).then(resolve);
                }).catch(function() {
                    resolve([]);
                });
                return;
            }
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

        resolve(streams);
    });
}

// ========== MAIN EXPORTED FUNCTION ==========
function getStreams(tmdbId, mediaType, season, episode) {
    season = parseInt(season, 10) || 1;
    episode = parseInt(episode, 10) || 1;

    console.log("[ICC FTP] ========================================");
    console.log("[ICC FTP] Searching for TMDB ID:", tmdbId);
    console.log("[ICC FTP] Type:", mediaType);
    console.log("[ICC FTP] Season:", season, "Episode:", episode);
    console.log("[ICC FTP] ========================================");

    return new Promise(function(resolve) {
        getTmdbDetails(tmdbId, mediaType)
        .then(function(details) {
            if (!details) {
                console.log("[ICC FTP] ❌ Failed to get TMDB details");
                resolve([]);
                return null;
            }

            var title = details.title;
            var year = details.year ? details.year.substring(0, 4) : "";
            console.log("[ICC FTP] ✅ TMDB Found:", title, "(" + year + ")");

            // Search with title
            return searchICC(title);
        })
        .then(function(results) {
            if (!results || results.length === 0) {
                console.log("[ICC FTP] ❌ No results found");
                resolve([]);
                return null;
            }

            console.log("[ICC FTP] ✅ Found", results.length, "results");

            // Use first result (like Kotlin version)
            var selected = results[0];
            console.log("[ICC FTP] Selected:", selected.title);

            return loadICC(selected.url);
        })
        .then(function(data) {
            if (!data) {
                console.log("[ICC FTP] ❌ Failed to load content");
                resolve([]);
                return null;
            }

            console.log("[ICC FTP] ✅ Loaded:", data.title);
            console.log("[ICC FTP] Video URLs:", data.videoUrls.length);

            return loadLinks(data.url);
        })
        .then(function(streams) {
            if (!streams) {
                resolve([]);
                return;
            }
            console.log("[ICC FTP] ✅ Returning", streams.length, "streams");
            resolve(streams);
        })
        .catch(function(err) {
            console.log("[ICC FTP] ❌ Error:", err.message);
            resolve([]);
        });
    });
}

// ========== EXPORTS ==========
module.exports = {
    getStreams: getStreams,
    searchICC: searchICC,
    loadICC: loadICC,
    loadLinks: loadLinks,
    getSession: getSession,
    getToken: getToken
};