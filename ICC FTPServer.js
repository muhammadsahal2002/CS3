/**
 * netmirror - Mobile + cookie + player fallback (Nuvio)
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) =>
  key in obj
    ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value })
    : (obj[key] = value);
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b))
      if (__propIsEnum.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) =>
  new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) =>
      x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });

// ── config ─────────────────────────────────────────────────────────────────
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var NET52 = "https://net52.cc";
var MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";

var PLATFORM_MAP = {
  netflix: {
    ott: "nf",
    search: "/mobile/search.php",
    post: "/mobile/post.php",
    episodes: "/mobile/episodes.php",
    playlist: "/mobile/playlist.php"
  },
  primevideo: {
    ott: "pv",
    search: "/mobile/pv/search.php",
    post: "/mobile/pv/post.php",
    episodes: "/mobile/pv/episodes.php",
    playlist: "/mobile/pv/playlist.php"
  },
  hotstar: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php"
  },
  disney: {
    ott: "hs",
    search: "/mobile/hs/search.php",
    post: "/mobile/hs/post.php",
    episodes: "/mobile/hs/episodes.php",
    playlist: "/mobile/hs/playlist.php"
  }
};

var NEW_TV_BASE_HEADERS = {
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

// ── cookie cache ───────────────────────────────────────────────────────────
var cookieValue = "";
var cookieTimestamp = 0;
var COOKIE_TTL = 12 * 60 * 60 * 1000; // 12 hours

function getCookie() {
  return __async(this, null, function* () {
    if (cookieValue && Date.now() - cookieTimestamp < COOKIE_TTL) {
      return cookieValue;
    }

    try {
      console.log("[NetMirror] generating cookie...");
      const home = yield fetch(`${NET52}/mobile/home?app=1`, {
        headers: {
          "User-Agent": MOBILE_UA,
          "X-Requested-With": "app.netmirror.netmirrornew"
        }
      });
      const html = yield home.text();
      const m = html.match(/data-addhash=["']([^"']+)["']/i);
      if (!m) {
        console.error("[NetMirror] no addhash");
        return "";
      }
      const addhash = m[1];

      yield fetch(
        `https://userver.net52.cc/?jjoii=\( {encodeURIComponent(addhash)}&a=y&t= \){Math.floor(
          Date.now() / 1000
        )}`,
        { headers: { "User-Agent": MOBILE_UA } }
      );

      for (let i = 1; i <= 7; i++) {
        yield new Promise((r) => setTimeout(r, 8000));
        const vr = yield fetch(`${NET52}/mobile/verify2.php`, {
          method: "POST",
          headers: {
            "User-Agent": MOBILE_UA,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: `verify=${encodeURIComponent(addhash)}`
        });
        const txt = yield vr.text();
        if (txt.includes('"statusup":"All Done"')) {
          let c = "";
          const sc =
            vr.headers.get("set-cookie") || vr.headers.get("Set-Cookie") || "";
          const cm = sc.match(/t_hash_t=([^;]+)/);
          if (cm) c = cm[1];
          if (!c && vr.headers.entries) {
            try {
              for (const [k, v] of vr.headers.entries()) {
                if (k.toLowerCase() === "set-cookie") {
                  const m2 = v.match(/t_hash_t=([^;]+)/);
                  if (m2) {
                    c = m2[1];
                    break;
                  }
                }
              }
            } catch (_) {}
          }
          if (c) {
            cookieValue = c;
            cookieTimestamp = Date.now();
            console.log("[NetMirror] cookie OK");
            return cookieValue;
          }
        }
      }
      console.error("[NetMirror] cookie timeout");
    } catch (e) {
      console.error("[NetMirror] cookie error:", e.message);
    }
    return "";
  });
}

function mobileHeaders(cookie, ott, extra) {
  const h = {
    "User-Agent": MOBILE_UA,
    Accept: "*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": "app.netmirror.nmv2",
    Referer: `${NET52}/mobile/home?app=1`,
    "sec-ch-ua-mobile": "?1"
  };
  if (cookie) h.Cookie = `t_hash_t=\( {cookie}; hd=on; ott= \){ott || "nf"}`;
  return __spreadValues(h, extra || {});
}

// ── NewTV (fast fallback, no cookie) ───────────────────────────────────────
var resolvedApiUrl = "";
function safeAtob(encoded) {
  if (typeof atob === "function") return atob(encoded);
  return Buffer.from(encoded, "base64").toString("binary");
}
function resolveApiUrl() {
  return __async(this, null, function* () {
    if (resolvedApiUrl) return resolvedApiUrl;
    for (const enc of NEW_TV_DOMAINS) {
      const base = safeAtob(enc).replace(/\/$/, "");
      try {
        const r = yield fetch(`${base}/checknewtv.php`, {
          headers: __spreadProps(__spreadValues({}, NEW_TV_BASE_HEADERS), {
            "User-Agent": "Mozilla/5.0"
          })
        });
        const j = yield r.json();
        if (j.token_hash) {
          resolvedApiUrl = safeAtob(j.token_hash).replace(/\/$/, "");
          return resolvedApiUrl;
        }
      } catch (_) {}
    }
    throw new Error("no NewTV base");
  });
}
function buildNewTvHeaders(ott, extra) {
  return __spreadValues(
    __spreadProps(__spreadValues({}, NEW_TV_BASE_HEADERS), { Ott: ott }),
    extra || {}
  );
}

// ── main ───────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      const useMobile = settings.useMobile !== false; // default true

      const tmdbType = mediaType === "tv" ? "tv" : "movie";
      const tmdbResp = yield fetch(
        `https://api.themoviedb.org/3/\( {tmdbType}/ \){tmdbId}?api_key=${TMDB_API_KEY}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "application/json"
          }
        }
      );
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      if (!title) return [];

      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }

      // 1) try mobile playlist (multi quality) if enabled
      if (useMobile) {
        for (const key of platforms) {
          try {
            const streams = yield fetchMobile(key, title, mediaType, season, episode);
            if (streams && streams.length) return streams;
          } catch (e) {
            console.warn("[NetMirror] mobile", key, e.message);
          }
        }
      }

      // 2) fast NewTV player fallback
      for (const key of platforms) {
        try {
          const streams = yield fetchPlayer(key, title, mediaType, season, episode);
          if (streams && streams.length) return streams;
        } catch (e) {
          console.warn("[NetMirror] player", key, e.message);
        }
      }
      return [];
    } catch (e) {
      console.error("[NetMirror]", e.message);
      return [];
    }
  });
}

// ── mobile path (cookie + playlist) ────────────────────────────────────────
function fetchMobile(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    const cookie = yield getCookie();
    if (!cookie) return null;

    const t = Math.floor(Date.now() / 1000);
    const headers = mobileHeaders(cookie, platform.ott, {
      "X-Requested-With": "XMLHttpRequest"
    });

    // search
    const sr = yield fetch(
      `\( {NET52} \){platform.search}?s=\( {encodeURIComponent(title)}&t= \){t}&ADSearch=false`,
      { headers }
    );
    const sj = yield sr.json();
    if (!sj.searchResult || !sj.searchResult.length) return null;

    let result = sj.searchResult.find(
      (r) => r.t && r.t.toLowerCase() === title.toLowerCase()
    );
    if (!result) result = sj.searchResult[0];
    const contentId = result.id;

    // post
    const pr = yield fetch(`\( {NET52} \){platform.post}?id=\( {contentId}&t= \){t}`, {
      headers
    });
    const pj = yield pr.json();

    let targetId = contentId;
    if (mediaType === "tv") {
      const eps = yield collectEpisodes(contentId, pj, platform, cookie);
      const s = Number(season);
      const e = Number(episode);
      const hit = eps.find((x) => Number(x.s) === s && Number(x.ep) === e);
      if (!hit) return null;
      targetId = hit.id;
    } else {
      if (
        pj.type === "t" ||
        (pj.episodes && pj.episodes.filter((x) => x).length > 0)
      )
        return null;
      targetId = pj.main_id || contentId;
    }

    // playlist
    const plHeaders = mobileHeaders(cookie, platform.ott);
    const plr = yield fetch(
      `\( {NET52} \){platform.playlist}?id=\( {targetId}&t= \){encodeURIComponent(
        title
      )}&tm=${t}`,
      { headers: plHeaders }
    );
    const plj = yield plr.json();
    if (!plj || !plj[0] || !plj[0].sources) return null;

    return plj[0].sources.map((src) => {
      let url = src.file;
      if (!url.startsWith("http")) url = NET52 + url;
      const qm = src.file.match(/[?&]q=([^&]+)/);
      const quality = qm ? qm[1] : src.label === "Auto" ? "Auto" : src.label || "Auto";
      return {
        name: `NetMirror (${platformKey}) ${quality}`,
        title: `${title} - ${src.label || quality}`,
        url,
        quality,
        provider: "netmirror",
        headers: plHeaders // Cookie + Referer required for m3u8
      };
    });
  });
}

function collectEpisodes(contentId, postData, platform, cookie) {
  return __async(this, null, function* () {
    const list = [];
    const headers = mobileHeaders(cookie, platform.ott, {
      "X-Requested-With": "XMLHttpRequest"
    });

    const push = (ep, fallbackS) => {
      let epNum = null;
      let sNum = fallbackS;
      if (ep.ep != null) epNum = parseInt(String(ep.ep).replace(/E/i, ""), 10);
      if (ep.s != null) sNum = parseInt(String(ep.s).replace(/S/i, ""), 10);
      if (ep.info && Array.isArray(ep.info)) {
        for (const p of ep.info) {
          if (/^E\d+/i.test(p)) epNum = parseInt(p.replace(/E/i, ""), 10);
          if (/^S\d+/i.test(p)) sNum = parseInt(p.replace(/S/i, ""), 10);
        }
      }
      list.push({ id: ep.id, s: sNum, ep: epNum });
    };

    if (postData.episodes) {
      postData.episodes.filter((e) => e).forEach((ep) => push(ep, null));
    }

    if (postData.season) {
      for (let i = 0; i < postData.season.length; i++) {
        const season = postData.season[i];
        if (!season.id) continue;
        let pg = 1;
        while (true) {
          const url = `\( {NET52} \){platform.episodes}?s=\( {season.id}&series= \){contentId}&t=${Math.floor(
            Date.now() / 1000
          )}&page=${pg}`;
          const r = yield fetch(url, { headers });
          const d = yield r.json();
          if (d.episodes) {
            d.episodes
              .filter((e) => e)
              .forEach((ep) =>
                push(ep, season.s ? Number(String(season.s).replace(/S/i, "")) : i + 1)
              );
          }
          if (d.nextPageShow != 1) break;
          pg++;
        }
      }
    }
    return list;
  });
}

// ── NewTV player fallback ──────────────────────────────────────────────────
function fetchPlayer(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    const apiBase = yield resolveApiUrl();
    const h = buildNewTvHeaders(platform.ott);

    const sr = yield fetch(
      `\( {apiBase}/newtv/search.php?s= \){encodeURIComponent(title)}`,
      { headers: h }
    );
    const sj = yield sr.json();
    if (!sj.searchResult || !sj.searchResult.length) return null;
    const contentId = sj.searchResult[0].id;

    const pr = yield fetch(`\( {apiBase}/newtv/post.php?id= \){contentId}`, {
      headers: buildNewTvHeaders(platform.ott, { Lastep: "", Usertoken: "" })
    });
    const pj = yield pr.json();

    let targetId = contentId;
    if (mediaType === "tv") {
      // minimal episode resolve from post page only
      const eps = [];
      if (pj.episodes) {
        pj.episodes.filter((e) => e).forEach((ep) => {
          let epNum = ep.ep != null ? parseInt(String(ep.ep).replace(/E/i, ""), 10) : null;
          let sNum = ep.s != null ? parseInt(String(ep.s).replace(/S/i, ""), 10) : null;
          if (ep.info) {
            for (const p of ep.info) {
              if (/^E\d+/i.test(p)) epNum = parseInt(p.replace(/E/i, ""), 10);
              if (/^S\d+/i.test(p)) sNum = parseInt(p.replace(/S/i, ""), 10);
            }
          }
          eps.push({ id: ep.id, s: sNum, ep: epNum });
        });
      }
      const hit = eps.find(
        (x) => Number(x.s) === Number(season) && Number(x.ep) === Number(episode)
      );
      if (!hit) return null;
      targetId = hit.id;
    } else {
      if (
        pj.type === "t" ||
        (pj.episodes && pj.episodes.filter((x) => x).length > 0)
      )
        return null;
      targetId = pj.main_id || contentId;
    }

    const playerResp = yield fetch(
      `\( {apiBase}/newtv/player.php?id= \){targetId}`,
      { headers: buildNewTvHeaders(platform.ott, { Usertoken: "" }) }
    );
    const response = yield playerResp.json();
    // live returns status "otp", not "ok"
    if (!response || !response.video_link) return null;

    return [
      {
        name: `NetMirror (${platformKey}) Auto`,
        title: `\( {title} \){mediaType === "tv" ? ` S\( {season}E \){episode}` : ""}`,
        url: response.video_link,
        quality: "Auto",
        provider: "netmirror",
        headers: {
          Referer: response.referer || NET52,
          "User-Agent": NEW_TV_BASE_HEADERS["User-Agent"]
        }
      }
    ];
  });
}

function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Source" },
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
      },
      {
        type: "toggle",
        key: "useMobile",
        label: "Use mobile playlist (multi quality)",
        description:
          "Needs cookie generation (\~40s first time). Disable for faster player.php only.",
        defaultValue: true
      }
    ];
  });
}

module.exports = { getStreams, onSettings };