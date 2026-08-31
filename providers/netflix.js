// ---------- Main getStreams ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  await fetchToken();

  const tmdbInfo = await getTmdbInfo(tmdbId, mediaType);
  const title = tmdbInfo.title;
  const year = tmdbInfo.year;
  log(`TMDB: "${title}" (${year})`);

  const imdbId = await getImdbId(tmdbId, mediaType);
  let imdbTitle = null;
  if (imdbId) {
    imdbTitle = await getImdbTitle(imdbId);
    if (imdbTitle) {
      log(`IMDb title: "${imdbTitle}"`);
    }
  }

  const results = await searchWithFallback(title, year, imdbTitle);
  if (!results.length) throw new Error(`No results found for "${title}"`);

  log("All search results:");
  for (const item of results) {
    log(`  "${item.t}" (year: ${item.y || 'unknown'}) id=${item.id}`);
  }

  let candidates = [];
  if (year) {
    const existingYearMatches = results.filter(item => item.y === year);
    if (existingYearMatches.length > 0) {
      candidates = existingYearMatches;
      log(`✅ Found ${candidates.length} results with year ${year}`);
    } else {
      log(`Fetching year from post.php for ${results.length} candidates...`);
      for (const item of results) {
        try {
          const post = await getPost(item.id);
          const itemYear = post.year || "";
          log(`  "${item.t}" → year: "${itemYear}"`);
          candidates.push({ ...item, y: itemYear, post: post });
        } catch (e) {
          log(`  Failed to get year for "${item.t}": ${e.message}`);
        }
      }
      if (candidates.length === 0) {
        throw new Error(`No results found for "${title}"`);
      }
      const matchingYear = candidates.filter(item => item.y === year);
      if (matchingYear.length > 0) {
        candidates = matchingYear;
        log(`✅ Found ${candidates.length} results with year ${year}`);
      } else {
        log(`⚠️ No results with year ${year}, using all results (${candidates.length})`);
      }
    }
  } else {
    candidates = results;
  }

  let selected = pickBestResult(candidates, year);
  if (!selected) {
    selected = candidates[0];
    log(`No language pick, using first: "${selected.t}" (${selected.y})`);
  } else {
    log(`Selected: "${selected.t}" (${selected.y})`);
  }

  const post = selected.post || await getPost(selected.id);
  log(`Type: ${post.type}, title: ${post.title}`);

  let contentId;

  const isMovie = (post.type === "m" || mediaType === "movie");

  if (isMovie) {
    contentId = post.main_id || selected.id;
    log(`Movie, using ID: ${contentId}`);
  } else {
    // ---- SERIES ----
    const seasonList = post.season || [];
    let targetSeasonId = null;
    let targetSeasonNum = season;

    // Check if requested season exists
    for (const s of seasonList) {
      const sNum = parseInt(s.s, 10);
      if (sNum === season) {
        targetSeasonId = s.id;
        targetSeasonNum = season;
        break;
      }
    }

    // If requested season not found, fallback to first available season
    if (!targetSeasonId && seasonList.length > 0) {
      const firstSeason = seasonList[0];
      targetSeasonId = firstSeason.id;
      targetSeasonNum = parseInt(firstSeason.s, 10);
      log(`⚠️ Season ${season} not found, falling back to Season ${targetSeasonNum}`);
    }

    if (!targetSeasonId) {
      throw new Error(`No seasons found for this show`);
    }

    log(`Season ID: ${targetSeasonId} (Season ${targetSeasonNum})`);

    const episodes = await getEpisodes(targetSeasonId, selected.id);
    if (!episodes.length) {
      throw new Error(`No episodes found for season ${targetSeasonNum}`);
    }

    // Find target episode
    let targetEp = null;
    let availableEpisodes = [];

    for (const ep of episodes) {
      const epNum = parseInt(ep.ep.replace(/^E/i, ''), 10);
      availableEpisodes.push(epNum);
      if (epNum === episode) {
        targetEp = ep;
        break;
      }
    }

    // If episode not found, use the first episode of the season
    if (!targetEp && episodes.length > 0) {
      log(`⚠️ Episode ${episode} not found, available episodes: ${availableEpisodes.join(', ')}`);
      log(`Using first episode: ${episodes[0].ep}`);
      targetEp = episodes[0];
    }

    if (!targetEp) {
      throw new Error(`No episodes found for season ${targetSeasonNum}`);
    }

    log(`Found episode: ${targetEp.t} (ID: ${targetEp.id})`);
    contentId = targetEp.id;
  }

  const playlist = await getPlaylist(contentId, post.title || title);
  if (!playlist.sources || !playlist.sources.length) {
    throw new Error("No sources in playlist");
  }

  const qualities = playlist.sources.map(s => s.label || s.quality || 'unknown');
  log(`Available qualities: ${qualities.join(', ')}`);

  const subtitles = [];
  if (playlist.tracks && playlist.tracks.length) {
    for (const track of playlist.tracks) {
      let url = track.file || "";
      if (url && url.indexOf("http") !== 0) {
        url = (url.indexOf("//") === 0) ? "https:" + url : "https://net52.cc" + url;
      }
      subtitles.push({
        url: url,
        language: track.label || "Unknown",
        default: (track.label && track.label.toLowerCase().indexOf("english") !== -1) ? true : false
      });
    }
  }

  return playlist.sources.map(src => {
    const fileUrl = src.file.startsWith("http") ? src.file : `https://net52.cc${src.file}`;
    return {
      name: "Netflix",
      title: src.label || "Auto",
      url: fileUrl,
      quality: src.label || "Auto",
      headers: {
        Referer: "https://net52.cc/",
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Cookie": cookieHeader,
        "Origin": "https://net52.cc"
      },
      subtitles: subtitles
    };
  });
}