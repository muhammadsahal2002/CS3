// Nuvio plugin for DhakaFlix BDIX
// Hermes-compatible: Promise chains only, no async/await

var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

// ---------- Provider Config ----------
var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: '(BDIX) DhakaFlix 14',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'series']
  },
  dhakaflix12: {
    mainUrl: 'http://172.16.50.12',
    serverName: 'DHAKA-FLIX-12',
    name: '(BDIX) DhakaFlix 12',
    tvSeriesKeyword: ['TV-WEB-Series'],
    supportedTypes: ['series']
  },
  dhakaflix9: {
    mainUrl: 'http://172.16.50.9',
    serverName: 'DHAKA-FLIX-9',
    name: '(BDIX) DhakaFlix 9',
    tvSeriesKeyword: ['Awards', 'WWE', 'KOREAN', 'Documentary', 'Anime'],
    supportedTypes: ['movie', 'series', 'anime']
  },
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: '(BDIX) DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie']
  }
};

// ---------- In-memory cache ----------
var searchCache = {};
var streamCache = {};

// ---------- Entry Point ----------
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DhakaFlix] getStreams: ' + tmdbId + ' type=' + mediaType);

  var cacheKey = tmdbId + ':' + mediaType + ':' + (season || 0) + ':' + (episode || 0);
  if (streamCache[cacheKey]) return Promise.resolve(streamCache[cacheKey]);

  return resolveTmdbToImdb(tmdbId, mediaType)
    .then(function(imdbId) {
      if (!imdbId) throw new Error('No IMDB ID for TMDB ' + tmdbId);
      return fetchOmdbTitle(imdbId);
    })
    .then(function(media) {
      if (!media) throw new Error('No OMDb result');
      return searchAllProviders(media.Title, mediaType, media.Year);
    })
    .then(function(allMatches) {
      return processMatches(allMatches, mediaType, season, episode);
    })
    .then(function(streams) {
      streamCache[cacheKey] = streams;
      return streams;
    })
    .catch(function(err) {
      console.error('[DhakaFlix] Fatal: ' + err.message);
      return [];
    });
}

// ---------- TMDB → IMDB ----------
function resolveTmdbToImdb(tmdbId, mediaType) {
  var url = 'https://api.themoviedb.org/3/' +
            (mediaType === 'tv' ? 'tv' : 'movie') + '/' +
            tmdbId + '?api_key=' + TMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) { return data.imdb_id || null; })
    .catch(function() { return null; });
}

// ---------- IMDB → Title ----------
function fetchOmdbTitle(imdbId) {
  var url = 'https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.Response !== 'True') return null;
      return { Title: data.Title, Year: parseInt(data.Year) || null };
    })
    .catch(function() { return null; });
}

// ---------- Parallel Search ----------
function searchAllProviders(title, mediaType, year) {
  var ids = Object.keys(PROVIDERS);
  var promises = [];

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var provider = PROVIDERS[id];
    if (provider.supportedTypes.indexOf(mediaType) === -1) continue;

    promises.push(
      searchProvider(title, provider, id)
        .then(function(results) {
          return scoreAndPickBest(results, title, year, mediaType);
        })
        .then(function(match) {
          return match ? [match] : [];
        })
        .catch(function() { return []; })
    );
  }

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var j = 0; j < arrs.length; j++) {
      for (var k = 0; k < arrs[j].length; k++) flat.push(arrs[j][k]);
    }
    return flat;
  });
}

function searchProvider(query, provider, providerId) {
  var body = JSON.stringify({
    action: 'get',
    search: {
      href: '/' + provider.serverName + '/',
      pattern: query,
      ignorecase: true
    }
  });

  return fetch(provider.mainUrl + '/' + provider.serverName + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var list = (data.search || []).filter(function(p) { return !p.size; });
    return list.slice(0, 20).map(function(post) {
      var name = nameFromUrl(post.href);
      var isSeries = containsAny(post.href, provider.tvSeriesKeyword);
      return {
        name: name,
        type: isSeries ? 'series' : 'movie',
        url: post.href,
        providerId: providerId
      };
    });
  })
  .catch(function() { return []; });
}

// ---------- Scoring / Best Match ----------
function scoreAndPickBest(results, title, year, mediaType) {
  var cleanTarget = clean(title);
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.type !== mediaType && !(mediaType === 'tv' && r.type === 'series')) continue;

    var cleanName = clean(r.name);
    if (cleanName.indexOf(cleanTarget) === -1 && cleanTarget.indexOf(cleanName) === -1) continue;

    var score = 10;
    if (cleanName === cleanTarget) score += 5;

    var parsed = extractMovieTitleAndYear(r.name);
    if (parsed.year && year) {
      var diff = Math.abs(parsed.year - year);
      if (diff === 0) score += 10;
      else if (diff === 1) score += 3;
    }

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// ---------- Process Matches → Streams ----------
function processMatches(matches, mediaType, season, episode) {
  var promises = [];

  for (var i = 0; i < matches.length; i++) {
    (function(match) {
      var provider = PROVIDERS[match.providerId];
      promises.push(
        loadContent(match.url, provider, match.providerId)
          .then(function(content) {
            if (!content) return [];
            if (mediaType === 'series' && content.episodes) {
              // Series: filter to requested episode if provided
              if (season && episode) {
                return content.episodes
                  .filter(function(ep) {
                    return ep.season === season && ep.episode === episode;
                  })
                  .map(toStream);
              }
              return content.episodes.map(toStream);
            }
            if (content.videoFiles) return content.videoFiles.map(toStream);
            if (content.url) return [toStream(content)];
            return [];
          })
          .catch(function() { return []; })
      );
    })(matches[i]);
  }

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var j = 0; j < arrs.length; j++) {
      for (var k = 0; k < arrs[j].length; k++) flat.push(arrs[j][k]);
    }
    return flat;
  });
}

function toStream(item) {
  return {
    name: 'DhakaFlix BDIX',
    title: item.name || 'Stream',
    url: item.url,
    quality: extractQuality(item.name || ''),
    provider: 'dhakaflix'
  };
}

// ---------- Load Content (movie/series + season folders) ----------
function loadContent(url, provider, providerId) {
  var fullUrl = constructUrl(provider.mainUrl, url);

  return fetch(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var isSeries = containsAny(url, provider.tvSeriesKeyword);

      if (isSeries) return parseSeries($, provider, fullUrl, url);
      return parseMovie($, provider, fullUrl);
    })
    .catch(function() { return null; });
}

// ---------- Parse Series (with season folder recursion) ----------
function parseSeries($, provider, fullUrl, url) {
  var name = nameFromUrl(url);
  var episodes = [];
  var seasonFolderUrls = [];

  // Direct season folder in URL
  var directSeason = url.match(/season\s*(\d+)/i);

  $('tbody > tr:gt(1)').each(function(_, row) {
    var $row = $(row);
    var $a = $row.find('td.fb-n > a');
    var link = $a.attr('href');
    var itemName = $a.text();
    var isFolder = $row.find('td.fb-i > img[alt="folder"]').length > 0;

    if (isFolder && itemName.toLowerCase().indexOf('season') !== -1) {
      var sm = itemName.match(/season\s*(\d+)/i);
      var sNum = sm ? parseInt(sm[1]) : 0;
      seasonFolderUrls.push({
        url: constructUrl(provider.mainUrl, link),
        season: sNum
      });
    } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
      episodes.push({
        name: itemName,
        season: directSeason ? parseInt(directSeason[1]) : 1,
        episode: episodes.length + 1,
        url: constructUrl(provider.mainUrl, link)
      });
    }
  });

  // If season folders exist, load them in parallel
  if (seasonFolderUrls.length > 0) {
    var promises = seasonFolderUrls.map(function(sf) {
      return extractSeason(sf.url, provider, sf.season);
    });
    return Promise.all(promises).then(function(arrs) {
      var flat = [];
      for (var i = 0; i < arrs.length; i++) {
        for (var j = 0; j < arrs[i].length; j++) flat.push(arrs[i][j]);
      }
      return { type: 'series', name: name, episodes: flat };
    });
  }

  return Promise.resolve({ type: 'series', name: name, episodes: episodes });
}

// ---------- Season Extractor (Promise chain) ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] extractSeason S' + seasonNum + ': ' + seasonUrl);

  return fetch(seasonUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var episodes = [];
      var epNum = 0;

      $('tbody > tr:gt(1)').each(function(_, row) {
        var $a = $(row).find('td.fb-n > a');
        var link = $a.attr('href');
        if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          epNum++;
          episodes.push({
            name: $a.text(),
            season: seasonNum,
            episode: epNum,
            url: constructUrl(provider.mainUrl, link)
          });
        }
      });

      return episodes;
    })
    .catch(function() { return []; });
}

// ---------- Parse Movie ----------
function parseMovie($, provider, fullUrl) {
  var videoFiles = [];

  $('tbody > tr:gt(1)').each(function(_, row) {
    var $a = $(row).find('td.fb-n > a');
    var link = $a.attr('href');
    if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
      var name = $a.text();
      videoFiles.push({
        name: name,
        url: constructUrl(provider.mainUrl, link),
        hasDualAudio: name.indexOf('Dual') !== -1,
        hasSubtitles: name.indexOf('ESub') !== -1
      });
    }
  });

  if (videoFiles.length === 0) return null;

  return {
    type: 'movie',
    name: videoFiles[0].name,
    videoFiles: videoFiles
  };
}

// ---------- Helpers ----------
function constructUrl(base, path) {
  var clean = path.replace(/([^:]\/)\/+/g, '$1');
  return base.replace(/\/$/, '') + '/' + clean.replace(/^\//, '');
}

function nameFromUrl(href) {
  var decoded = decodeURIComponent(href);
  var match = decoded.match(/.*\/([^/]+)(?:\/[^/]*)*$/);
  return match ? match[1] : '';
}

function containsAny(text, keywords) {
  if (!keywords || !keywords.length) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < keywords.length; i++) {
    if (lower.indexOf(keywords[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

function clean(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractQuality(name) {
  var m = name.match(/\b(720p|1080p|2160p|4K)\b/i);
  return m ? m[1].toUpperCase() : 'Unknown';
}

function extractMovieTitleAndYear(filename) {
  var m = filename.match(/^(.+?)\s*\((\d{4})\)/);
  if (m) return { title: m[1].trim(), year: parseInt(m[2]) };

  m = filename.match(/\b(19\d{2}|20\d{2})\b/);
  if (m) {
    var t = filename.match(/^(.+?)(?:\s*[\(\[\-\|]|\s+\d{4}|$)/);
    return { title: t ? t[1] : filename, year: parseInt(m[1]) };
  }
  return { title: filename, year: null };
}

module.exports = { getStreams };