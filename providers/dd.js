// Nuvio plugin: DhakaFlix BDIX (movies + series) - FIXED
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

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
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: '(BDIX) DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie']
  }
};

var CACHE = {};
var MAX_RESULTS = 40;

// ---------- Entry point ----------
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DhakaFlix] ENTER tmdb=' + tmdbId + ' rawType=' + mediaType +
              ' S' + (season || 0) + 'E' + (episode || 0));

  // Normalize type ONCE
  var wantType = 'movie';
  if (mediaType === 'tv' || mediaType === 'series' || mediaType === 'show') {
    wantType = 'series';
  }
  console.log('[DhakaFlix] Normalized wantType=' + wantType);

  var key = tmdbId + ':' + wantType + ':' + (season || 0) + ':' + (episode || 0);
  if (CACHE[key]) {
    console.log('[DhakaFlix] Cache hit');
    return Promise.resolve(CACHE[key]);
  }

  return resolveTmdbToImdb(tmdbId, wantType)
    .then(function(imdbId) {
      console.log('[DhakaFlix] IMDB=' + imdbId);
      if (!imdbId) throw new Error('No IMDB ID for TMDB ' + tmdbId);
      return fetchOmdb(imdbId);
    })
    .then(function(media) {
      console.log('[DhakaFlix] OMDb title="' + (media ? media.title : 'null') +
                  '" year=' + (media ? media.year : 'null'));
      if (!media) throw new Error('OMDb lookup failed');
      return searchAllProviders(media.title, wantType, media.year);
    })
    .then(function(matches) {
      console.log('[DhakaFlix] matches=' + matches.length);
      return processMatches(matches, wantType, season, episode);
    })
    .then(function(streams) {
      CACHE[key] = streams;
      console.log('[DhakaFlix] DONE returning ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[DhakaFlix] ERROR: ' + err.message);
      return [];
    });
}

// ---------- TMDB ID → IMDB ID ----------
function resolveTmdbToImdb(tmdbId, wantType) {
  var path = wantType === 'series' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;

  console.log('[DhakaFlix] TMDB GET ' + url);

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      console.log('[DhakaFlix] TMDB response imdb_id=' +
                  (data ? data.imdb_id : 'null') +
                  ' name=' + (data ? (data.name || data.title) : ''));
      if (!data) throw new Error('TMDB empty response');
      if (!data.imdb_id) {
        // Fallback: try /find by TMDB id
        throw new Error('TMDB returned no imdb_id for ' + path + '/' + tmdbId);
      }
      return data.imdb_id;
    });
}

// ---------- IMDB ID → Title via OMDb ----------
function fetchOmdb(imdbId) {
  var url = 'https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_API_KEY;
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.Response !== 'True') return null;
      return {
        title: data.Title,
        year: parseInt(data.Year) || null,
        type: data.Type
      };
    });
}

// ---------- Parallel search ----------
function searchAllProviders(query, wantType, year) {
  var ids = Object.keys(PROVIDERS);
  var promises = [];

  console.log('[DhakaFlix] searchAllProviders type=' + wantType +
              ' providers=' + ids.join(','));

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var provider = PROVIDERS[id];

    if (provider.supportedTypes.indexOf(wantType) === -1) {
      console.log('[DhakaFlix] Skip ' + id + ' (supports ' +
                  provider.supportedTypes.join('/') + ', want ' + wantType + ')');
      continue;
    }

    console.log('[DhakaFlix] Will search ' + id);

    (function(providerId, prov) {
      promises.push(
        searchProvider(query, prov, providerId)
          .then(function(results) {
            console.log('[DhakaFlix] ' + providerId + ' raw=' + results.length);
            return pickBest(results, query, year, wantType);
          })
          .then(function(best) {
            console.log('[DhakaFlix] ' + providerId + ' best=' +
                        (best ? best.name : 'null'));
            return best ? [best] : [];
          })
          .catch(function(err) {
            console.log('[DhakaFlix] ' + providerId + ' FAILED: ' + err.message);
            return [];
          })
      );
    })(id, provider);
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
    if (list.length > MAX_RESULTS) list = list.slice(0, MAX_RESULTS);

    return list.map(function(post) {
      var name = nameFromUrl(post.href);
      var isSeries = containsAny(post.href, provider.tvSeriesKeyword);
      return {
        name: name,
        type: isSeries ? 'series' : 'movie',
        url: post.href,
        providerId: providerId
      };
    });
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
    // Looser match: allow partial word overlap
    if (cn.indexOf(cleanTarget) === -1 && cleanTarget.indexOf(cn) === -1) {
      // Also try first-word match
      var firstWord = cleanTarget.split(' ')[0];
      if (firstWord.length > 3 && cn.indexOf(firstWord) !== -1) {
        // weak match, allow with lower score
        var weakScore = 3;
        if (weakScore > bestScore) {
          bestScore = weakScore;
          best = r;
        }
      }
      continue;
    }

    var score = 10;
    if (cn === cleanTarget) score += 5;

    if (wantType === 'movie') {
      var ym = r.name.match(/\((\d{4})\)/) || r.name.match(/\b(19\d{2}|20\d{2})\b/);
      var fileYear = ym ? parseInt(ym[1]) : null;
      if (fileYear && targetYear) {
        var diff = Math.abs(fileYear - targetYear);
        if (diff === 0) score += 10;
        else if (diff === 1) score += 3;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// ---------- Load + extract ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);

  var promises = matches.map(function(match) {
    var provider = PROVIDERS[match.providerId];
    console.log('[DhakaFlix] LOADING ' + match.providerId + ' url=' + match.url);

    return loadContent(match.url, provider)
      .then(function(content) {
        if (!content) {
          console.log('[DhakaFlix] ' + match.providerId + ' content=null');
          return [];
        }

        if (wantType === 'series' && content.episodes) {
          console.log('[DhakaFlix] ' + match.providerId +
                      ' episodes=' + content.episodes.length);

          var list = content.episodes;
          if (season && episode) {
            var filtered = list.filter(function(ep) {
              return ep.season === season && ep.episode === episode;
            });
            if (filtered.length > 0) {
              list = filtered;
            } else {
              console.log('[DhakaFlix] S' + season + 'E' + episode +
                          ' not found, showing all');
            }
          }

          return list.map(function(ep) {
            var prefix = ep.season > 0
              ? 'S' + pad2(ep.season) + 'E' + pad2(ep.episode)
              : null;
            return toStream(ep, provider, prefix);
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
        console.log('[DhakaFlix] load ' + match.providerId +
                    ' error: ' + err.message);
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

// ---------- Load content ----------
function loadContent(url, provider) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] GET ' + fullUrl);

  return fetch(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      console.log('[DhakaFlix] HTML len=' + html.length);
      var $ = load(html);
      var isSeries = containsAny(url, provider.tvSeriesKeyword);
      console.log('[DhakaFlix] isSeries=' + isSeries);

      var videoFiles = [];
      var seasonFolders = [];

      var directSeasonMatch = url.match(/season[\s%20]*(\d+)/i);
      var directSeasonNum = directSeasonMatch ? parseInt(directSeasonMatch[1]) : 0;

      $('tbody > tr:gt(1)').each(function(_, row) {
        var $row = $(row);
        var $a = $row.find('td.fb-n > a');
        var link = $a.attr('href');
        var name = $a.text();
        var isFolder = $row.find('td.fb-i > img[alt="folder"]').length > 0;

        if (isFolder && /season/i.test(name)) {
          var sm = name.match(/season[\s]*(\d+)/i);
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

      console.log('[DhakaFlix] videoFiles=' + videoFiles.length +
                  ' seasonFolders=' + seasonFolders.length);

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

      var flatSeason = directSeasonNum > 0 ? directSeasonNum : 1;
      var episodes = videoFiles.map(function(v, i) {
        return {
          name: v.name,
          season: flatSeason,
          episode: i + 1,
          url: v.url
        };
      });
      return { type: 'series', episodes: episodes };
    });
}

// ---------- Season extractor ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] extractSeason S' + seasonNum + ' ' + seasonUrl);

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

      console.log('[DhakaFlix] S' + seasonNum + ' → ' + episodes.length);
      return episodes;
    })
    .catch(function() { return []; });
}

// ---------- HTML parser ----------
var load = (function() {
  try {
    return require('cheerio-without-node-native').load;
  } catch (e) {
    console.log('[DhakaFlix] cheerio fallback to regex parser');
    return function(html) {
      return {
        'tbody > tr:gt(1)': {
          each: function(fn) {
            var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            var m, idx = 0, skip = 0;
            while ((m = rowRe.exec(html)) !== null) {
              skip++;
              if (skip <= 2) continue;
              fn(idx++, makeRow(m[0]));
            }
          }
        }
      };
    };
  }
})();

function makeRow(rowHtml) {
  return {
    find: function(selector) {
      var results = [];
      if (selector.indexOf('td.fb-n > a') !== -1) {
        var aRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        var am;
        while ((am = aRe.exec(rowHtml)) !== null) {
          results.push({ href: am[1], text: am[2].replace(/<[^>]+>/g, '') });
        }
      } else if (selector.indexOf('img[alt="folder"]') !== -1) {
        if (/alt="folder"/.test(rowHtml)) results.push({});
      }
      return {
        length: results.length,
        each: function(f) {
          for (var i = 0; i < results.length; i++) {
            f(i, {
              attr: function(n) { return results[i][n]; },
              text: function() { return results[i].text || ''; }
            });
          }
        },
        attr: function(n) { return results.length ? results[0][n] : undefined; },
        text: function() { return results.length ? results[0].text : ''; }
      };
    }
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

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = { getStreams: getStreams };