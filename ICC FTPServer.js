/**
 * netmirror - Mobile (net52.cc) fixed
 * Matches real app: search/post/playlist/hls all on https://net52.cc/mobile/
 */
var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
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
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// ── constants ──────────────────────────────────────────────────────────────
var TMDB_API_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
var NET52 = "https://net52.cc";

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

var MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-M025F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 Mobile Safari/537.36 /OS.Gatu v3.1";

// ── cookie / bypass ────────────────────────────────────────────────────────
var cookieValue = "";
var cookieTimestamp = 0;

function bypass(ott) {
  return __async(this, null, function* () {
    // reuse \~12h
    if (cookieValue && Date.now() - cookieTimestamp < 43e6) return cookieValue;

    try {
      console.log("[NetMirror] mobile bypass...");
      const homeResponse = yield fetch(`${NET52}/mobile/home?app=1`, {
        headers: {
          "User-Agent": MOBILE_UA,
          "X-Requested-With": "app.netmirror.netmirrornew"
        }
      });
      const homeHtml = yield homeResponse.text();
      const match = homeHtml.match(/data-addhash=["']([^"']+)["']/i);
      if (!match) {
        console.error("[NetMirror] no data-addhash");
        return "";
      }
      const addhash = match[1];
      console.log("[NetMirror] addhash:", addhash);

      yield fetch(
        `https://userver.net52.cc/?jjoii=\( {encodeURIComponent(addhash)}&a=y&t= \){Math.floor(Date.now() / 1e3)}`,
        { headers: { "User-Agent": MOBILE_UA } }
      );

      for (let count = 1; count <= 7; count++) {
        yield new Promise((r) => setTimeout(r, 8000));
        console.log(`[NetMirror] verify ${count}/7...`);
        const verifyResponse = yield fetch(`${NET52}/mobile/verify2.php`, {
          method: "POST",
          headers: {
            "User-Agent": MOBILE_UA,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: `verify=${encodeURIComponent(addhash)}`
        });
        const verifyText = yield verifyResponse.text();
        if (verifyText.includes('"statusup":"All Done"')) {
          let newCookie = "";
          const setCookie =
            verifyResponse.headers.get("set-cookie") ||
            verifyResponse.headers.get("Set-Cookie") ||
            "";
          const m = setCookie.match(/t_hash_t=([^;]+)/);
          if (m) newCookie = m[1];

          if (!newCookie && verifyResponse.headers.entries) {
            try {
              for (const [k, v] of verifyResponse.headers.entries()) {
                if (k.toLowerCase() === "set-cookie") {
                  const m2 = v.match(/t_hash_t=([^;]+)/);
                  if (m2) {
                    newCookie = m2[1];
                    break;
                  }
                }
              }
            } catch (_) {}
          }

          cookieValue = newCookie;
          cookieTimestamp = Date.now();
          console.log("[NetMirror] cookie OK");
          return cookieValue;
        }
      }
      console.error("[NetMirror] verify timeout");
    } catch (e) {
      cookieValue = "";
      console.error("[NetMirror] bypass error:", e.message);
    }
    return "";
  });
}

function mobileHeaders(cookie, ott, extra = {}) {
  const h = {
    "User-Agent": MOBILE_UA,
    Accept: "*/*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${NET52}/mobile/home?app=1`,
    "sec-ch-ua-mobile": "?1",
    Connection: "keep-alive"
  };
  if (cookie) {
    h.Cookie = `t_hash_t=\( {cookie}; hd=on; ott= \){ott || "nf"}`;
  }
  return __spreadValues(h, extra);
}

// ── main ───────────────────────────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return __async(this, null, function* () {
    try {
      const settings = globalThis.SCRAPER_SETTINGS || {};
      const preferred = settings.preferredPlatform || "all";
      const tmdbType = mediaType === "tv" ? "tv" : "movie";

      const tmdbResp = yield fetch(
        `https://api.themoviedb.org/3/\( {tmdbType}/ \){tmdbId}?api_key=${TMDB_API_KEY}`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Accept: "application/json"
          }
        }
      );
      const tmdbData = yield tmdbResp.json();
      const title = mediaType === "tv" ? tmdbData.name : tmdbData.title;
      if (!title) throw new Error("TMDB title missing");

      let platforms = ["netflix", "primevideo", "hotstar", "disney"];
      if (preferred !== "all") {
        platforms = [preferred, ...platforms.filter((p) => p !== preferred)];
      }

      for (const platformKey of platforms) {
        try {
          const streams = yield fetchFromPlatform(
            platformKey,
            title,
            mediaType,
            season,
            episode
          );
          if (streams && streams.length > 0) return streams;
        } catch (e) {
          console.warn(`[NetMirror] ${platformKey}:`, e.message);
        }
      }
      return [];
    } catch (error) {
      console.error("[NetMirror] getStreams:", error.message);
      return [];
    }
  });
}

function fetchFromPlatform(platformKey, title, mediaType, season, episode) {
  return __async(this, null, function* () {
    const platform = PLATFORM_MAP[platformKey];
    const cookie = yield bypass(platform.ott);
    if (!cookie) {
      console.warn("[NetMirror] no cookie, search may fail");
    }

    const t = Math.floor(Date.now() / 1e3);
    const headers = mobileHeaders(cookie, platform.ott);

    // ── 1. Search (real mobile endpoint) ───────────────────────────────────
    const searchUrl = `\( {NET52} \){platform.search}?s=\( {encodeURIComponent(title)}&t= \){t}&ADSearch=false`;
    const searchResp = yield fetch(searchUrl, { headers });
    const searchData = yield searchResp.json();

    if (!searchData.searchResult || searchData.searchResult.length === 0) {
      return null;
    }

    // prefer exact / starts-with match
    let result = searchData.searchResult.find(
      (r) => r.t && r.t.toLowerCase() === title.toLowerCase()
    );
    if (!result) {
      result = searchData.searchResult.find(
        (r) => r.t && r.t.toLowerCase().startsWith(title.toLowerCase().slice(0, 12))
      );
    }
    if (!result) result = searchData.searchResult[0];

    const contentId = result.id;
    console.log(`[NetMirror] found "\( {result.t}" id= \){contentId}`);

    // ── 2. Post ────────────────────────────────────────────────────────────
    const postUrl = `\( {NET52} \){platform.post}?id=\( {contentId}&t= \){t}`;
    const postResp = yield fetch(postUrl, { headers });
    const postData = yield postResp.json();

    let targetId = contentId;

    if (mediaType === "tv") {
      const episodes = yield getAllEpisodes(
        contentId,
        postData,
        platform,
        cookie
      );
      const s = Number(season);
      const e = Number(episode);
      const targetEp = episodes.find(
        (ep) => ep && Number(ep.s) === s && Number(ep.ep) === e
      );
      if (!targetEp) {
        console.warn(
          `[NetMirror] S\( {s}E \){e} not found among ${episodes.length} episodes`
        );
        return null;
      }
      targetId = targetEp.id;
    } else {
      // movie: reject series
      const isSeries =
        postData.type === "t" ||
        (postData.episodes &&
          postData.episodes.filter((x) => x !== null).length > 0);
      if (isSeries) return null;
      targetId = postData.main_id || contentId;
    }

    // ── 3. Playlist ────────────────────────────────────────────────────────
    const playlistUrl = `\( {NET52} \){platform.playlist}?id=\( {targetId}&t= \){encodeURIComponent(title)}&tm=${t}`;
    const playlistHeaders = mobileHeaders(cookie, platform.ott, {
      "X-Requested-With": "app.netmirror.nmv2"
    });

    const playlistResp = yield fetch(playlistUrl, { headers: playlistHeaders });
    const playlistData = yield playlistResp.json();

    if (!playlistData || !playlistData.length) return null;
    const item = playlistData[0];
    if (!item.sources || !item.sources.length) return null;

    return item.sources.map((source) => {
      let streamUrl = source.file;
      if (!streamUrl.startsWith("http")) {
        streamUrl = NET52 + streamUrl; // /mobile/hls/... must stay on net52.cc
      }
      const qMatch = source.file.match(/[?&]q=([^&]+)/);
      const quality = qMatch
        ? qMatch[1]
        : source.label === "Auto"
        ? "Auto"
        : source.label || "Auto";

      return {
        name: `NetMirror (${platformKey.charAt(0).toUpperCase() + platformKey.slice(1)})`,
        title: `${title} - ${source.label || quality}`,
        url: streamUrl,
        quality,
        type: "m3u8",
        isM3U8: true,
        // player MUST send these when fetching the m3u8 + segments
        headers: playlistHeaders
      };
    });
  });
}

function getAllEpisodes(contentId, postData, platform, cookie) {
  return __async(this, null, function* () {
    const episodes = [];
    const headers = mobileHeaders(cookie, platform.ott);

    // current page episodes
    if (postData.episodes) {
      postData.episodes
        .filter((e) => e !== null)
        .forEach((ep) => {
          const epNum = ep.ep
            ? parseInt(String(ep.ep).replace("E", ""), 10)
            : ep.epNum
            ? parseInt(String(ep.epNum).replace("E", ""), 10)
            : null;
          const sNum = ep.s
            ? parseInt(String(ep.s).replace("S", ""), 10)
            : ep.sNum
            ? parseInt(String(ep.sNum).replace("S", ""), 10)
            : null;
          episodes.push({ id: ep.id, s: sNum, ep: epNum });
        });
    }

    // more pages for current season
    if (postData.nextPageShow == 1 && postData.nextPageSeason) {
      const more = yield fetchEpisodesPage(
        contentId,
        postData.nextPageSeason,
        postData.nextPage || 2,
        null,
        platform,
        cookie
      );
      episodes.push(...more);
    }

    // other seasons
    if (postData.season && Array.isArray(postData.season)) {
      for (const season of postData.season) {
        if (!season.id) continue;
        // skip if we already have this season's first page from post
        const already = episodes.some(
          (e) =>
            season.s &&
            Number(e.s) === Number(String(season.s).replace("S", ""))
        );
        // still fetch full list for safety
        const more = yield fetchEpisodesPage(
          contentId,
          season.id,
          1,
          season.s ? Number(String(season.s).replace("S", "")) : null,
          platform,
          cookie
        );
        // avoid duplicates by id
        for (const ep of more) {
          if (!episodes.find((x) => x.id === ep.id)) episodes.push(ep);
        }
      }
    }

    return episodes;
  });
}

function fetchEpisodesPage(
  contentId,
  seasonId,
  page,
  seasonNumber,
  platform,
  cookie
) {
  return __async(this, null, function* () {
    const episodes = [];
    const headers = mobileHeaders(cookie, platform.ott);
    let pg = page;

    while (true) {
      // real mobile episodes endpoint
      const url = `\( {NET52} \){platform.episodes}?s=\( {seasonId}&series= \){contentId}&t=\( {Math.floor(Date.now() / 1e3)}&page= \){pg}`;
      const resp = yield fetch(url, { headers });
      const data = yield resp.json();

      if (data.episodes) {
        data.episodes
          .filter((e) => e !== null)
          .forEach((ep) => {
            const epNum = ep.ep
              ? parseInt(String(ep.ep).replace("E", ""), 10)
              : ep.epNum
              ? parseInt(String(ep.epNum).replace("E", ""), 10)
              : null;
            const sNum =
              seasonNumber ||
              (ep.s
                ? parseInt(String(ep.s).replace("S", ""), 10)
                : ep.sNum
                ? parseInt(String(ep.sNum).replace("S", ""), 10)
                : null);
            episodes.push({ id: ep.id, s: sNum, ep: epNum });
          });
      }

      if (data.nextPageShow != 1) break;
      pg++;
    }
    return episodes;
  });
}

function onSettings() {
  return __async(this, null, function* () {
    return [
      { type: "header", label: "Source Selection" },
      {
        type: "select",
        key: "preferredPlatform",
        label: "Preferred Streaming Source",
        description: "Tried first; others used as fallback.",
        options: [
          { label: "All Sources (Ordered)", value: "all" },
          { label: "Netflix", value: "netflix" },
          { label: "Prime Video", value: "primevideo" },
          { label: "Hotstar / Disney+", value: "hotstar" }
        ],
        defaultValue: "all"
      },
      { type: "header", label: "Advanced" },
      {
        type: "toggle",
        key: "forceHd",
        label: "Force HD Quality",
        description: "Adds hd=on cookie.",
        defaultValue: true
      }
    ];
  });
}

module.exports = { getStreams, onSettings };