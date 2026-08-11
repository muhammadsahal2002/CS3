/**
 * netmirror - cookie-only mobile (Nuvio)
 * Confirmed: home → verify → search → playlist → hls on net52.cc
 */
var __async = function (t, e, n) {
  return new Promise(function (r, o) {
    var i = function (v) {
      try {
        a(n.next(v));
      } catch (err) {
        o(err);
      }
    };
    var s = function (v) {
      try {
        a(n.throw(v));
      } catch (err) {
        o(err);
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
var UA =
  "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";
var COOKIE_TTL = 12 * 60 * 60 * 1000;

function loadCookie() {
  try {
    if (
      globalThis.__nm_cookie &&
      globalThis.__nm_cookie_ts &&
      Date.now() - globalThis.__nm_cookie_ts < COOKIE_TTL
    ) {
      return globalThis.__nm_cookie;
    }
  } catch (e) {}
  return "";
}

function saveCookie(c) {
  if (!c) return;
  try {
    globalThis.__nm_cookie = c;
    globalThis.__nm_cookie_ts = Date.now();
  } catch (e) {}
}

function getCookie() {
  return __async(null, null, function* () {
    var existing = loadCookie();
    if (existing) {
      console.log("[NetMirror] cookie from cache");
      return existing;
    }

    console.log("[NetMirror] generating cookie...");
    try {
      var home = yield fetch(NET52 + "/mobile/home?app=1", {
        headers: {
          "User-Agent": UA,
          "X-Requested-With": "app.netmirror.netmirrornew"
        }
      });
      var html = yield home.text();
      var m = html.match(/data-addhash=["']([^"']+)["']/i);
      if (!m) {
        console.error("[NetMirror] no addhash");
        return "";
      }
      var addhash = m[1];
      console.log("[NetMirror] addhash ok");

      yield fetch(
        "https://userver.net52.cc/?jjoii=" +
          encodeURIComponent(addhash) +
          "&a=y&t=" +
          Math.floor(Date.now() / 1000),
        { headers: { "User-Agent": UA } }
      );

      for (var i = 1; i <= 8; i++) {
        yield new Promise(function (r) {
          setTimeout(r, 8000);
        });
        console.log("[NetMirror] verify " + i + "/8");

        var vr = yield fetch(NET52 + "/mobile/verify2.php", {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: "verify=" + encodeURIComponent(addhash)
        });

        var txt = yield vr.text();
        if (txt.indexOf('"statusup":"All Done"') === -1) continue;

        var cookie = "";
        var sc =
          vr.headers.get("set-cookie") ||
          vr.headers.get("Set-Cookie") ||
          "";
        var cm = sc.match(/t_hash_t=([^;]+)/);
        if (cm) cookie = cm[1];

        if (!cookie) {
          try {
            if (vr.headers.forEach) {
              vr.headers.forEach(function (val, key) {
                if (String(key).toLowerCase() === "set-cookie") {
                  var m2 = String(val).match(/t_hash_t=([^;]+)/);
                  if (m2) cookie = m2[1];
                }
              });
            }
          } catch (e) {}
        }

        if (!cookie) {
          try {
            if (vr.headers.entries) {
              var it = vr.headers.entries();
              var step = it.next();
              while (!step.done) {
                if (String(step.value[0]).toLowerCase() === "set-cookie") {
                  var m3 = String(step.value[1]).match(/t_hash_t=([^;]+)/);
                  if (m3) cookie = m3[1];
                }
                step = it.next();
              }
            }
          } catch (e) {}
        }

        if (cookie) {
          saveCookie(cookie);
          console.log("[NetMirror] cookie saved");
          return cookie;
        }
        console.error("[NetMirror] All Done but no Set-Cookie");
      }
    } catch (e) {
      console.error("[NetMirror] cookie error", e.message || e);
    }
    return "";
  });
}

function mobHeaders(cookie, xrw) {
  return {
    "User-Agent": UA,
    Accept: "*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": xrw || "XMLHttpRequest",
    Referer: NET52 + "/mobile/home?app=1",
    "sec-ch-ua-mobile": "?1",
    Cookie: "t_hash_t=" + cookie + "; hd=on; ott=nf"
  };
}

function getStreams(tmdbId, mediaType, season, episode) {
  return __async(null, null, function* () {
    try {
      var cookie = yield getCookie();
      if (!cookie) {
        console.error("[NetMirror] no cookie — abort");
        return [];
      }

      var kind = mediaType === "tv" ? "tv" : "movie";
      var tr = yield fetch(
        "https://api.themoviedb.org/3/" +
          kind +
          "/" +
          tmdbId +
          "?api_key=" +
          TMDB_API_KEY,
        {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
        }
      );
      var td = yield tr.json();
      var title = mediaType === "tv" ? td.name : td.title;
      if (!title) {
        console.error("[NetMirror] no TMDB title");
        return [];
      }

      var t = Math.floor(Date.now() / 1000);
      var h = mobHeaders(cookie, "XMLHttpRequest");

      // SEARCH
      var sr = yield fetch(
        NET52 +
          "/mobile/search.php?s=" +
          encodeURIComponent(title) +
          "&t=" +
          t +
          "&ADSearch=false",
        { headers: h }
      );
      var sj = yield sr.json();
      if (!sj.searchResult || !sj.searchResult.length || sj.status === "n") {
        console.warn("[NetMirror] search failed", sj.status);
        return [];
      }

      var hit = sj.searchResult[0];
      for (var i = 0; i < sj.searchResult.length; i++) {
        var r = sj.searchResult[i];
        if (r.t && r.t.toLowerCase() === title.toLowerCase()) {
          hit = r;
          break;
        }
      }
      var contentId = hit.id;
      console.log("[NetMirror] found", hit.t, contentId);

      // POST
      var pr = yield fetch(
        NET52 + "/mobile/post.php?id=" + contentId + "&t=" + t,
        { headers: h }
      );
      var pj = yield pr.json();
      var targetId = contentId;

      if (mediaType === "tv") {
        var eps = [];
        function addEp(ep, fbS) {
          var epN =
            ep.ep != null
              ? parseInt(String(ep.ep).replace(/E/i, ""), 10)
              : null;
          var sN =
            ep.s != null
              ? parseInt(String(ep.s).replace(/S/i, ""), 10)
              : fbS;
          eps.push({ id: ep.id, s: sN, ep: epN });
        }

        if (pj.episodes) {
          pj.episodes
            .filter(function (e) {
              return e;
            })
            .forEach(function (ep) {
              addEp(ep, null);
            });
        }

        if (pj.season) {
          for (var si = 0; si < pj.season.length; si++) {
            var so = pj.season[si];
            if (!so.id) continue;
            var pg = 1;
            while (true) {
              var er = yield fetch(
                NET52 +
                  "/mobile/episodes.php?s=" +
                  so.id +
                  "&series=" +
                  contentId +
                  "&t=" +
                  Math.floor(Date.now() / 1000) +
                  "&page=" +
                  pg,
                { headers: h }
              );
              var ej = yield er.json();
              if (ej.episodes) {
                ej.episodes
                  .filter(function (e) {
                    return e;
                  })
                  .forEach(function (ep) {
                    addEp(
                      ep,
                      so.s
                        ? parseInt(String(so.s).replace(/S/i, ""), 10)
                        : si + 1
                    );
                  });
              }
              if (ej.nextPageShow != 1) break;
              pg++;
            }
          }
        }

        var wantS = Number(season);
        var wantE = Number(episode);
        var found = null;
        for (var ei = 0; ei < eps.length; ei++) {
          if (Number(eps[ei].s) === wantS && Number(eps[ei].ep) === wantE) {
            found = eps[ei];
            break;
          }
        }
        if (!found) {
          console.warn("[NetMirror] episode not found S" + wantS + "E" + wantE);
          return [];
        }
        targetId = found.id;
      } else {
        if (
          pj.type === "t" ||
          (pj.episodes &&
            pj.episodes.filter(function (e) {
              return e;
            }).length > 0)
        ) {
          return [];
        }
        targetId = pj.main_id || contentId;
      }

      // PLAYLIST
      var plH = mobHeaders(cookie, "app.netmirror.nmv2");
      var plr = yield fetch(
        NET52 +
          "/mobile/playlist.php?id=" +
          targetId +
          "&t=" +
          encodeURIComponent(title) +
          "&tm=" +
          t,
        { headers: plH }
      );
      var plj = yield plr.json();
      if (!plj || !plj[0] || !plj[0].sources) {
        console.warn("[NetMirror] empty playlist");
        return [];
      }

      return plj[0].sources.map(function (src) {
        var url = src.file;
        if (url.indexOf("http") !== 0) url = NET52 + url;
        var qm = src.file.match(/[?&]q=([^&]+)/);
        var quality = qm
          ? qm[1]
          : src.label === "Auto"
          ? "Auto"
          : src.label || "Auto";
        return {
          name: "NetMirror " + quality,
          title: title + " - " + (src.label || quality),
          url: url,
          quality: quality,
          provider: "netmirror",
          headers: plH
        };
      });
    } catch (e) {
      console.error("[NetMirror]", e.message || e);
      return [];
    }
  });
}

module.exports = { getStreams };