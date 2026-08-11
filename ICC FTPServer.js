/**
 * netmirror - final Nuvio plugin
 * TMDB title → search (NewTV) → player.php (+ optional mobile playlist)
 */
var __async = function (t, e, n) {
  return new Promise(function (r, o) {
    var i = function (v) {
      try {
        a(n.next(v));
      } catch (e) {
        o(e);
      }
    };
    var s = function (v) {
      try {
        a(n.throw(v));
      } catch (e) {
        o(e);
      }
    };
    var a = function (v) {
      v.done ? r(v.value) : Promise.resolve(v.value).then(i, s);
    };
    a((n = n.apply(t, e)).next());
  });
};

var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var NET52 = "https://net52.cc";
var MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";

var NEW_TV_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "X-Requested-With": "NetmirrorNewTV v1.0",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0",
  Accept: "application/json, text/plain, */*"
};

var NEW_TV_DOMAINS = [
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==",
  "aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=",
  "aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo="
];

var PLATFORM = {
  netflix: { ott: "nf", playlist: "/mobile/playlist.php" },
  primevideo: { ott: "pv", playlist: "/mobile/pv/playlist.php" },
  hotstar: { ott: "hs", playlist: "/mobile/hs/playlist.php" },
  disney: { ott: "hs", playlist: "/mobile/hs/playlist.php" }
};

// ── helpers ────────────────────────────────────────────────────────────────
function safeAtob(s) {
  if (typeof atob === "function") return atob(s);
  if (typeof Buffer !== "undefined")
    return Buffer.from(s, "base64").toString("binary");
  throw new Error("no base64 decoder");
}

var apiBase = "";
function resolveApi() {
  return __async(null, null, function* () {
    if (apiBase) return apiBase;
    for (var i = 0; i < NEW_TV_DOMAINS.length; i++) {
      var base = safeAtob(NEW_TV_DOMAINS[i]).replace(/\/$/, "");
      try {
        var r = yield fetch(base + "/checknewtv.php", {
          headers: Object.assign({}, NEW_TV_HEADERS, {
            "User-Agent": "Mozilla/5.0"
          })
        });
        var j = yield r.json();
        if (j.token_hash) {
          apiBase = safeAtob(j.token_hash).replace(/\/$/, "");
          return apiBase;
        }
      } catch (e) {}
    }
    throw new Error("NewTV base failed");
  });
}

function tvH(ott, extra) {
  var h = Object.assign({}, NEW_TV_HEADERS, { Ott: ott });
  if (extra) Object.assign(h, extra);
  return h;
}

// ── cookie (optional, for multi-quality) ───────────────────────────────────
var cookieVal = "";
var cookieTs = 0;

function getCookie() {
  return __async(null, null, function* () {
    if (cookieVal && Date.now() - cookieTs < 12 * 3600 * 1000) return cookieVal;
    try {
      var home = yield fetch(NET52 + "/mobile/home?app=1", {
        headers: {
          "User-Agent": MOBILE_UA,
          "X-Requested-With": "app.netmirror.netmirrornew"
        }
      });
      var html = yield home.text();
      var m = html.match(/data-addhash=["']([^"']+)["']/i);
      if (!m) return "";
      var addhash = m[1];
      yield fetch(
        "https://userver.net52.cc/?jjoii=" +
          encodeURIComponent(addhash) +
          "&a=y&t=" +
          Math.floor(Date.now() / 1000),
        { headers: { "User-Agent": MOBILE_UA } }
      );
      for (var n = 1; n <= 7; n++) {
        yield new Promise(function (r) {
          setTimeout(r, 8000);
        });
        var vr = yield fetch(NET52 + "/mobile/verify2.php", {
          method: "POST",
          headers: {
            "User-Agent": MOBILE_UA,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: "verify=" + encodeURIComponent(addhash)
        });
        var txt = yield vr.text();
        if (txt.indexOf('"statusup":"All Done"') !== -1) {
          var sc =
            vr.headers.get("set-cookie") ||
            vr.headers.get("Set-Cookie") ||
            "";
          var cm = sc.match(/t_hash_t=([^;]+)/);
          if (cm) {
            cookieVal = cm[1];
            cookieTs = Date.now();
            return cookieVal;
          }
        }
      }
    } catch (e) {}
    return "";
  });
}

// ── main ───────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(null, null, function* () {
    try {
      var settings = globalThis.SCRAPER_SETTINGS || {};
      var preferred = settings.preferredPlatform || "all";

      // TMDB title
      var kind = mediaType === "tv" ? "tv" : "movie";
      var tr = yield fetch(
        "https://api.themoviedb.org/3/" +
          kind +
          "/" +
          tmdbId +
          "?api_key=" +
          TMDB_API_KEY,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json"
          }
        }
      );
      var td = yield tr.json();
      var title = mediaType === "tv" ? td.name : td.title;
      if (!title) return [];

      var platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred].concat(
          platforms.filter(function (p) {
            return p !== preferred;
          })
        );
      }

      for (var i = 0; i < platforms.length; i++) {
        try {
          var streams = yield fromPlatform(
            platforms[i],
            title,
            mediaType,
            season,
            episode
          );
          if (streams && streams.length) return streams;
        } catch (e) {}
      }
      return [];
    } catch (e) {
      return [];
    }
  });
}

function fromPlatform(key, title, mediaType, season, episode) {
  return __async(null, null, function* () {
    var p = PLATFORM[key];
    var base = yield resolveApi();
    var h = tvH(p.ott);

    // SEARCH (NewTV — no cookie needed)
    var sr = yield fetch(
      base + "/newtv/search.php?s=" + encodeURIComponent(title),
      { headers: h }
    );
    var sj = yield sr.json();
    if (!sj.searchResult || !sj.searchResult.length) return null;

    var item = sj.searchResult[0];
    for (var i = 0; i < sj.searchResult.length; i++) {
      var r = sj.searchResult[i];
      if (r.t && r.t.toLowerCase() === title.toLowerCase()) {
        item = r;
        break;
      }
    }
    var contentId = item.id;

    // POST
    var pr = yield fetch(base + "/newtv/post.php?id=" + contentId, {
      headers: tvH(p.ott, { Lastep: "", Usertoken: "" })
    });
    var pd = yield pr.json();

    var targetId = contentId;
    if (mediaType === "tv") {
      var eps = yield loadEpisodes(contentId, pd, p, base);
      var s = Number(season);
      var e = Number(episode);
      var hit = null;
      for (var j = 0; j < eps.length; j++) {
        if (Number(eps[j].s) === s && Number(eps[j].ep) === e) {
          hit = eps[j];
          break;
        }
      }
      if (!hit) return null;
      targetId = hit.id;
    } else {
      if (
        pd.type === "t" ||
        (pd.episodes &&
          pd.episodes.filter(function (x) {
            return x;
          }).length > 0)
      )
        return null;
      targetId = pd.main_id || contentId;
    }

    var out = [];

    // Mobile playlist (multi quality) if cookie available quickly
    try {
      var cookie = yield getCookie();
      if (cookie) {
        var plH = {
          "User-Agent": MOBILE_UA,
          Accept: "*/*",
          "X-Requested-With": "app.netmirror.nmv2",
          Referer: NET52 + "/mobile/home?app=1",
          Cookie: "t_hash_t=" + cookie + "; hd=on; ott=" + p.ott
        };
        var plr = yield fetch(
          NET52 +
            p.playlist +
            "?id=" +
            targetId +
            "&t=" +
            encodeURIComponent(title) +
            "&tm=" +
            Math.floor(Date.now() / 1000),
          { headers: plH }
        );
        var plj = yield plr.json();
        if (plj && plj[0] && plj[0].sources) {
          for (var k = 0; k < plj[0].sources.length; k++) {
            var src = plj[0].sources[k];
            var url = src.file;
            if (url.indexOf("http") !== 0) url = NET52 + url;
            var qm = src.file.match(/[?&]q=([^&]+)/);
            var q = qm
              ? qm[1]
              : src.label === "Auto"
              ? "Auto"
              : src.label || "Auto";
            out.push({
              name: "NetMirror (" + key + ") " + q,
              title: title + " - " + (src.label || q),
              url: url,
              quality: q,
              provider: "netmirror",
              headers: plH
            });
          }
        }
      }
    } catch (e) {}

    // player.php fallback (always works, status may be "otp")
    if (!out.length) {
      var playerR = yield fetch(base + "/newtv/player.php?id=" + targetId, {
        headers: tvH(p.ott, { Usertoken: "" })
      });
      var player = yield playerR.json();
      if (player && player.video_link) {
        out.push({
          name: "NetMirror (" + key + ")",
          title:
            title +
            (mediaType === "tv" ? " S" + season + "E" + episode : ""),
          url: player.video_link,
          quality: "Auto",
          provider: "netmirror",
          headers: {
            Referer: player.referer || NET52,
            "User-Agent": NEW_TV_HEADERS["User-Agent"]
          }
        });
      }
    }

    return out.length ? out : null;
  });
}

function loadEpisodes(contentId, postData, platform, base) {
  return __async(null, null, function* () {
    var list = [];

    function push(ep, fbS) {
      var epN =
        ep.ep != null ? parseInt(String(ep.ep).replace(/E/i, ""), 10) : null;
      var sN =
        ep.s != null ? parseInt(String(ep.s).replace(/S/i, ""), 10) : fbS;
      if (ep.info) {
        for (var i = 0; i < ep.info.length; i++) {
          var p = ep.info[i];
          if (/^E\d+/i.test(p)) epN = parseInt(p.replace(/E/i, ""), 10);
          if (/^S\d+/i.test(p)) sN = parseInt(p.replace(/S/i, ""), 10);
        }
      }
      list.push({ id: ep.id, s: sN, ep: epN });
    }

    if (postData.episodes) {
      postData.episodes
        .filter(function (e) {
          return e;
        })
        .forEach(function (ep) {
          push(ep, null);
        });
    }

    if (postData.season) {
      for (var i = 0; i < postData.season.length; i++) {
        var season = postData.season[i];
        if (!season.id) continue;
        var pg = 1;
        while (true) {
          var r = yield fetch(
            base + "/newtv/episodes.php?id=" + season.id + "&page=" + pg,
            { headers: tvH(platform.ott) }
          );
          var d = yield r.json();
          if (d.episodes) {
            d.episodes
              .filter(function (e) {
                return e;
              })
              .forEach(function (ep) {
                push(
                  ep,
                  season.s
                    ? parseInt(String(season.s).replace(/S/i, ""), 10)
                    : i + 1
                );
              });
          }
          if (d.nextPageShow != 1) break;
          pg++;
        }
      }
    }
    return list;
  });
}

function onSettings() {
  return __async(null, null, function* () {
    return [
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred platform",
        options: [
          { label: "All", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      }
    ];
  });
}

module.exports = { getStreams, onSettings };