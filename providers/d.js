// Nuvio plugin: DhakaFlix BDIX
// Option A: Nuvio passes TMDB ID → we resolve → search BDIX
// Hermes-compatible: Promise chains only, no async/await

var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

// ---------- Provider config ----------
var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: '(BDIX) DhakaFlix 14',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'tv']
  },
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: '(BDIX) DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie']
  }
  // dhakaflix9 removed (times out)
  // dhakaflix12 series only - add back if you want TV
};

var CACHE = {};

// ---------- Entry point ----------
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DhakaFlix] tmdb=' + tmdbId + ' type=' + mediaType +
              ' S' + (season || 0) + 'E' + (episode || 0));

  var key = tmdbId + ':' + mediaType + ':' + (season || 0) + ':' + (episode || 0);
  if (CACHE[key]) return Promise.resolve(CACHE[key]);

  // Nuvio uses "tv"; normalize to "series" internally
  var wantType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';

  return resolveTmdbToImdb(tmdbId, mediaType)
    .then(function(imdbId) {
      if (!imdbId) throw new Error('No IMDB ID for TMDB ' + tmdbId);
      return fetchOmdb(imdbId);
    })
    .then(function(media) {
      if (!media) throw new Error('OMDb lookup failed');
      return searchAllProviders(media.title, wantType, media.year);
    })
    .then(function(matches) {
      return processMatches(matches, wantType, season, episode);
    })
    .then(function(streams) {
      CACHE[key] = streams;
      console.log('[DhakaFlix] Returning ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[DhakaFlix] Error: ' + err.message);
      return [];
    });
}

// ---------- Step 1: TMDB ID → IMDB ID ----------
function resolveTmdbToImdb(tmdbId, mediaType) {
  var path = (mediaType === 'tv' || mediaType === 'series') ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data || !data.imdb_id) throw new Error('No imdb_id in TMDB response');
      return data.imdb_id;
    });
}

// ---------- Step 2: IMDB ID → Title via OMDb ----------
function fetchOmdb(imdbId) {
  var url = 'https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.Response !== 'True') return null;
      return {
        title: data.Title,
        year: parseInt(data.Year) || null,
        type: data.Type // 'movie' or 'series'
      };
    });
}

// ---------- Step 3: Parallel search ----------
function searchAllProviders(query, wantType, year) {
  var ids = Object.keys(PROVIDERS);
  var promises = [];

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var provider = PROVIDERS[id];
    if (provider.supportedTypes.indexOf(wantType) === -1) continue;

    promises.push(
      searchProvider(query, provider, id)
        .then(function(results) {
          return pickBest(results, query, year, wantType);
        })
        .then(function(best) { return best ? [best] : []; })
        .catch(function(err) {
          console.log('[DhakaFlix] ' + id + ' search failed: ' + err.message);
          return [];
        })
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
  console.log('[DhakaFlix] Searching ' + providerId + ': "' + query + '"');

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

    // For series, do not truncate (season folders may be later in list)
    if (providerId !== 'dhakaflix14') list = list.slice(0, 20);

    var results = list.map(function(post) {
      var name = nameFromUrl(post.href);
      var isSeries = containsAny(post.href, provider.tvSeriesKeyword);
      return {
        name: name,
        type: isSeries ? 'series' : 'movie',
        url: post.href,
        providerId: providerId
      };
    });

    console.log('[DhakaFlix] ' + providerId + ' → ' + results.length + ' results');
    return results;
  });
}

// ---------- Pick best match ----------
function pickBest(results, targetTitle, targetYear, wantType) {
  var cleanTarget = clean(targetTitle);
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.type !== wantType) continue;

    var cn = clean(r.name);
    if (cn.indexOf(cleanTarget) === -1 && cleanTarget.indexOf(cn) === -1) continue;

    var score = 10;
    if (cn === cleanTarget) score += 5;

    var ym = r.name.match(/\((\d{4})\)/) || r.name.match(/\b(19\d{2}|20\d{2})\b/);
    var fileYear = ym ? parseInt(ym[1]) : null;
    if (fileYear && targetYear) {
      var diff = Math.abs(fileYear - targetYear);
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

// ---------- Step 4: Load content + extract streams ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);

  var promises = matches.map(function(match) {
    var provider = PROVIDERS[match.providerId];
    return loadContent(match.url, provider)
      .then(function(content) {
        if (!content) return [];

        if (wantType === 'series' && content.episodes) {
          // Filter to requested episode if Nuvio provided S/E
          var list = content.episodes;
          if (season && episode) {
            list = list.filter(function(ep) {
              return ep.season === season && ep.episode === episode;
            });
          }
          return list.map(function(ep) {
            return toStream(ep, provider, 'S' + ep.season + 'E' + ep.episode);
          });
        }

        if (content.videoFiles) {
          return content.videoFiles.map(function(v) {
            return toStream(v, provider, null);
          });
        }
        return [];
      })
      .catch(function(err) {
        console.log('[DhakaFlix] load failed: ' + err.message);
        return [];
      });
  });

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var i = 0; i < arrs.length; i++) {
      for (var j = 0; j < arrs[i].length; j++) flat.push(arrs[i][j]);
    }
    return flat;
  });
}

function toStream(item, provider, prefix) {
  var quality = extractQuality(item.name || '');
  var title = (prefix ? '[' + prefix + '] ' : '') +
              (item.name || 'Stream') +
              (quality !== 'Unknown' ? ' (' + quality + ')' : '');

  return {
    name: provider.name,
    title: title,
    url: item.url,
    quality: quality,
    provider: 'dhakaflix'
  };
}

// ---------- Load content (movie/series) ----------
function loadContent(url, provider) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] GET ' + fullUrl);

  return fetch(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var isSeries = containsAny(url, provider.tvSeriesKeyword);

      var videoFiles = [];
      var seasonFolders = [];

      $('tbody > tr:gt(1)').each(function(_, row) {
        var $row = $(row);
        var $a = $row.find('td.fb-n > a');
        var link = $a.attr('href');
        var name = $a.text();
        var isFolder = $row.find('td.fb-i > img[alt="folder"]').length > 0;

        if (isFolder && name.toLowerCase().indexOf('season') !== -1) {
          var sm = name.match(/season\s*(\d+)/i);
          seasonFolders.push({
            url: constructUrl(provider.mainUrl, link),
            season: sm ? parseInt(sm[1]) : 0
          });
        } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          videoFiles.push({
            name: name,
            url: constructUrl(provider.mainUrl, link)
          });
        }
      });

      if (!isSeries && seasonFolders.length === 0) {
        return { type: 'movie', videoFiles: videoFiles };
      }

      if (seasonFolders.length > 0) {
        var sfPromises = seasonFolders.map(function(sf) {
          return extractSeason(sf.url, provider, sf.season);
        });
        return Promise.all(sfPromises).then(function(arrs) {
          var eps = [];
          for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) eps.push(arrs[i][j]);
          }
          return { type: 'series', episodes: eps };
        });
      }

      // Series with flat episode list
      var episodes = videoFiles.map(function(v, i) {
        return { name: v.name, season: 1, episode: i + 1, url: v.url };
      });
      return { type: 'series', episodes: episodes };
    });
}

// ---------- Season folder extractor ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] Season ' + seasonNum + ': ' + seasonUrl);

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

      console.log('[DhakaFlix] S' + seasonNum + ' → ' + episodes.length + ' eps');
      return episodes;
    })
    .catch(function() { return []; });
}

// ---------- HTML parser (Hermes-compatible) ----------
// Replace with require('cheerio-without-node-native').load if available
var load = (function() {
  try {
    return require('cheerio-without-node-native').load;
  } catch (e) {
    // Minimal fallback: regex-based parser
    return function(html) {
      return {
        _html: html,
        'tbody > tr:gt(1)': {
          each: function(fn) {
            var rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
            // Skip header rows (first 2)
            for (var i = 2; i < rows.length; i++) {
              fn(i, { _html: rows[i] });
            }
          }
        }
      };
    };
  }
})();

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

module.exports = { getStreams: getStreams };