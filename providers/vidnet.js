const PROVIDER_NAME = "🟡 PlayIMDb";
const BASE_API = "https://streamdata.vaplayer.ru/api.php";
const TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";

const HEADERS = {
  Origin: "https://nextgencloudfabric.com",
  Referer: "https://nextgencloudfabric.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = 10000;
  const signal =
    typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(timeoutMs)
      : null;

  const requestOptions = {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  };
  if (signal) requestOptions.signal = signal;

  return fetch(url, requestOptions);
}

async function fetchJson(url, options = {}) {
  try {
    const res = await fetchWithTimeout(url, options);
    if (res.ok) return await res.json();
    return null;
  } catch (err) {
    console.log(`[${PROVIDER_NAME}] fetchJson error:`, err);
    return null;
  }
}

async function getTmdbMetadata(tmdbId, mediaType, season, episode) {
  let title = "Unknown Title";
  let duration = mediaType === "tv" ? "45 min" : "90 min";

  try {
    const tmdbType = mediaType === "movie" ? "movie" : "tv";
    const url = `https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return { name: title, year: "N/A", duration };

    const data = await res.json();
    let runtime = duration;

    if (mediaType === "movie" && data.runtime) {
      runtime = data.runtime + " min";
    } else if (mediaType === "tv") {
      const epUrl = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${episode}?api_key=${TMDB_API_KEY}`;
      const epRes = await fetch(epUrl);
      if (epRes.ok) {
        const epData = await epRes.json();
        if (epData.runtime) runtime = epData.runtime + " min";
        else if (data.episode_run_time && data.episode_run_time.length > 0)
          runtime = data.episode_run_time[0] + " min";
      }
    }

    return {
      name: data.title || data.name || title,
      year: (data.release_date || data.first_air_date || "").split("-")[0] || "N/A",
      duration: runtime,
    };
  } catch (err) {
    return { name: title, year: "N/A", duration };
  }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  const streams = [];

  try {
    const isTv = mediaType === "tv" || mediaType === "series";
    const apiType = isTv ? "tv" : "movie";

    if (!tmdbId) {
      console.log(`[${PROVIDER_NAME}] Missing TMDB ID`);
      return streams;
    }

    const metadata = await getTmdbMetadata(tmdbId, apiType, season, episode);

    let apiUrl = `${BASE_API}?tmdb_id=${tmdbId}&type=${apiType}`;
    if (isTv) {
      if (!season || !episode) return streams;
      apiUrl += `&season=${season}&episode=${episode}`;
    }

    console.log(`[${PROVIDER_NAME}] Fetching: ${apiUrl}`);

    const data = await fetchJson(apiUrl, { headers: HEADERS });

    if (
      data &&
      (data.status_code === 200 || data.status_code === "success") &&
      data.data &&
      data.data.stream_urls
    ) {
      let qualityLabel = "1080p FHD";
      let qualityShort = "1080P";
      const fileName = String(data.data.file_name || "").toLowerCase();

      if (fileName.includes("2160p") || fileName.includes("4k")) {
        qualityLabel = "4K UHD";
        qualityShort = "2160P";
      } else if (fileName.includes("1080p")) {
        qualityLabel = "1080p FHD";
        qualityShort = "1080P";
      } else if (fileName.includes("720p")) {
        qualityLabel = "720p HD";
        qualityShort = "720P";
      }

      let audioLabel = "Original-Audio";
      let audioShort = "Original-Audio";

      if (
        fileName.includes("dual") ||
        (fileName.includes("multi") && fileName.includes("english"))
      ) {
        audioLabel = "Dual-Audio";
        audioShort = "English • Hindi";
      } else if (fileName.includes("multi")) {
        audioLabel = "Multi-Audio";
        audioShort = "Multilingual";
      } else if (fileName.includes("hindi")) {
        audioLabel = "Hindi-Audio";
        audioShort = "Hindi";
      } else if (fileName.includes("english")) {
        audioLabel = "English-Audio";
        audioShort = "English";
      }

      const showTitle = metadata.name || "Unknown Title";
      const year = metadata.year || "N/A";

      data.data.stream_urls.forEach((url, index) => {
        const lowerUrl = url.toLowerCase();
        const serverName = "Server " + (index + 1);
        let format = "MKV";
        if (lowerUrl.includes(".mp4")) format = "MP4";
        if (lowerUrl.includes(".m3u8")) format = "M3U8";

        const streamName = `${PROVIDER_NAME} | ${qualityLabel} - ${audioLabel}`;
        const streamTitle = isTv
          ? `🎬 ${showTitle} - S${season}E${episode} (${year})`
          : `🎬 ${showTitle} - ${year}`;
        const qualityInfo = `💎 ${qualityShort} | 🌍 ${audioShort}`;
        const formatInfo = `🎞️ ${format} | ⏱️ ${metadata.duration} | 📌 ${serverName}`;
        const fullTitle = `${streamTitle}\n${qualityInfo}\n${formatInfo}`;

        const streamObj = {
          name: streamName,
          title: fullTitle,
          url: url,
          quality: qualityShort.toUpperCase(),
          type: "video/mp4",
        };
        streamObj.headers = HEADERS;

        if (
          data.default_subs &&
          Array.isArray(data.default_subs) &&
          data.default_subs.length > 0
        ) {
          streamObj.subtitles = data.default_subs.map((sub) => ({
            id: sub.code || sub.language,
            url: sub.url,
            lang: sub.lang,
          }));
        }

        streams.push(streamObj);
      });
    }
  } catch (err) {
    console.log(`[${PROVIDER_NAME}] Error: ${err.message}`);
  }

  return streams;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}