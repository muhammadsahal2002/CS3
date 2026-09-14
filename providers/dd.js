// Nuvio plugin: DhakaFlix BDIX — Final (no anime)
// Promise chains only (Hermes-safe). No async/await.
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

// ---------- Providers ----------
var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: '(BDIX) DhakaFlix 14',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'series'],
    searchMode: 'bdix',
    movieRoots: [
      'English Movies (1080p)/', 'English Movies/', 'Hindi Movies/',
      'Animation Movies (1080p)/', 'IMDb Top-250 Movies/', 'SOUTH INDIAN MOVIES/'
    ],
    seriesRoots: ['KOREAN TV %26 WEB Series/']
  },
  dhakaflix12: {
    mainUrl: 'http://172.16.50.12',
    serverName: 'DHAKA-FLIX-12',
    name: '(BDIX) DhakaFlix 12',
    tvSeriesKeyword: ['TV-WEB-Series'],
    supportedTypes: ['series'],
    searchMode: 'bdix',
    movieRoots: [],
    seriesRoots: [
      'TV-WEB-Series/TV Series ★%20 0%20 —%20 9/',
      'TV-WEB-Series/TV Series ♥%20 A%20 —%20 L/',
      'TV-WEB-Series/TV Series ♦%20 M%20 —%20 R/',
      'TV-WEB-Series/TV Series ♦%20 S%20 —%20 Z/'
    ]
  },
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: '(BDIX) DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie'],
    searchMode: 'bdix',
    movieRoots: [
      'English Movies/', 'English Movies (1080p)/', '3D Movies/',
      'Foreign Language Movies/', 'Kolkata Bangla Movies/'
    ],
    seriesRoots: []
  }
};

var CACHE = {};
var MAX_RESULTS = 40;

var USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

// ---------- HTTP helper (UA + minimal headers only, no cookies) ----------
function fetchWithHeaders(url, options) {
  options = options || {};
  var hostMatch = url.match(/^https?:\/\/([^\/]+)/);
  var host = hostMatch ? hostMatch[1] : '';

  var headers = options.headers || {};
  headers['User-Agent'] = USER_AGENT;
  headers['Accept'] = '*/*';
  headers['Accept-Language'] = 'en-GB,en;q=0.6';
  headers['Origin'] = 'http://' + host;
  headers['Referer'] = url;

  options.headers = headers;
  return fetch(url, options);
}

// ---------- Entry point ----------
function getStreams(tmdbId, mediaType, season, episode) {
  console.log('[DhakaFlix] ENTER tmdb=' + tmdbId + ' type=' + mediaType +
              ' S' + (season || 0) + 'E' + (episode || 0));

  var wantType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';
  var key = tmdbId + ':' + wantType + ':' + (season || 0) + ':' + (episode || 0);
  if (CACHE[key]) return Promise.resolve(CACHE[key]);

  return resolveTmdbToImdb(tmdbId, wantType)
    .then(function(imdbId) {
      console.log('[DhakaFlix] IMDB=' + imdbId);
      return fetchOmdb(imdbId);
    })
    .then(function(media) {
      console.log('[DhakaFlix] OMDb "' + media.title + '" type=' + media.type +
                  ' year=' + media.year);
      var effectiveType = media.type === 'movie' ? 'movie' :
                          media.type === 'series' ? 'series' : wantType;
      return searchAllProviders(media.title, effectiveType, media.year);
    })
    .then(function(matches) {
      console.log('[DhakaFlix] matches=' + matches.length);
      return processMatches(matches, wantType, season, episode);
    })
    .then(function(streams) {
      CACHE[key] = streams;
      console.log('[DhakaFlix] DONE ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[DhakaFlix] ERROR: ' + err.message);
      return [];
    });
}

// ---------- TMDB → IMDB (with external_ids fallback) ----------
function resolveTmdbToImdb(tmdbId, wantType) {
  var path = wantType === 'series' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.imdb_id) return data.imdb_id;
      var extUrl = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
                   '/external_ids?api_key=' + TMDB_API_KEY;
      return fetch(extUrl)
        .then(function(r) { return r.json(); })
        .then(function(ext) {
          if (ext && ext.imdb_id) return ext.imdb_id;
          throw new Error('No imdb_id from TMDB');
        });
    });
}

// ---------- OMDb ----------
function fetchOmdb(imdbId) {
  var url = 'https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_API_KEY;
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.Response !== 'True') throw new Error('OMDb: ' + data.Error);
      return {
        title: data.Title,
        year: parseInt(data.Year) || null,
        type: data.Type // 'movie' or 'series'
      };
    });
}

// ---------- Multi-query builder ----------
function buildSearchQueries(title, year) {
  var queries = [];
  var seen = {};

  function add(q) {
    if (!q) return;
    q = q.trim();
    if (q.length < 2 || seen[q.toLowerCase()]) return;
    seen[q.toLowerCase()] = true;
    queries.push(q);
  }

  add(title);
  if (year) add(title + ' ' + year);
  if (title.indexOf(':') !== -1) add(title.split(':')[0]);
  if (title.indexOf(' - ') !== -1) add(title.split(' - ')[0]);
  add(title.replace(/\s+/g, '.'));

  var words = title.split(/\s+/);
  if (words.length > 3) add(words.slice(0, 3).join(' '));
  if (words.length > 2) add(words.slice(0, 2).join(' '));

  var stripped = title.replace(/^(The|A|An)\s+/i, '');
  if (stripped !== title) add(stripped);

  add(title.replace(/\bPart\s+II\b/i, 'Part 2')
            .replace(/\bPart\s+III\b/i, 'Part 3'));

  return queries;
}

// ---------- Parallel search across all providers ----------
function searchAllProviders(query, wantType, year) {
  var queries = buildSearchQueries(query, year);
  var ids = Object.keys(PROVIDERS);
  var promises = [];

  console.log('[DhakaFlix] Queries: ' + JSON.stringify(queries));

  for (var i = 0; i < ids.length; i++) {
    (function(id) {
      var provider = PROVIDERS[id];
      if (provider.supportedTypes.indexOf(wantType) === -1) return;

      console.log('[DhakaFlix] Parallel search ' + id + ' as ' + wantType);

      promises.push(
        searchProviderParallel(queries, provider, id, wantType)
          .then(function(results) {
            // Series alphabet-bucket fallback
            if (wantType === 'series' && results.length === 0 &&
                provider.seriesRoots && provider.seriesRoots.length > 0) {
              console.log('[DhakaFlix] ' + id +
                          ' empty, alphabet bucket fallback');
              return searchSeriesAlphabetBuckets(query, provider, id);
            }
            return results;
          })
          .then(function(results) {
            return pickBest(results, query, year, wantType);
          })
          .then(function(best) { return best ? [best] : []; })
          .catch(function(err) {
            console.log('[DhakaFlix] ' + id + ' failed: ' + err.message);
            return [];
          })
      );
    })(ids[i]);
  }

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var j = 0; j < arrs.length; j++) {
      for (var k = 0; k < arrs[j].length; k++) flat.push(arrs[j][k]);
    }
    return flat;
  });
}

// Fire all queries in parallel, merge + dedupe
function searchProviderParallel(queries, provider, providerId, wantType) {
  var promises = queries.map(function(q) {
    return searchProvider(q, provider, providerId, wantType)
      .catch(function() { return []; });
  });
  return Promise.all(promises).then(function(arrs) {
    var seen = {}, merged = [];
    for (var i = 0; i < arrs.length; i++) {
      for (var j = 0; j < arrs[i].length; j++) {
        var r = arrs[i][j];
        var k = (r.url || '').toLowerCase();
        if (seen[k]) continue;
        seen[k] = true;
        merged.push(r);
      }
    }
    console.log('[DhakaFlix] ' + providerId + ' merged ' + merged.length);
    return merged;
  });
}

// ---------- Single query BDIX search ----------
function searchProvider(query, provider, providerId, wantType) {
  var body = JSON.stringify({
    action: 'get',
    search: {
      href: '/' + provider.serverName + '/',
      pattern: query,
      ignorecase: true
    }
  });

  return fetchWithHeaders(provider.mainUrl + '/' + provider.serverName + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var list = (data.search || []).filter(function(p) { return !p.size; });
    if (list.length > MAX_RESULTS) list = list.slice(0, MAX_RESULTS);

    var results = [];
    for (var i = 0; i < list.length; i++) {
      var post = list[i];
      var name = nameFromUrl(post.href);
      var isSeries = containsAny(post.href, provider.tvSeriesKeyword);
      var itemType = isSeries ? 'series' : 'movie';

      // Type filter — movie requests only get movies, series only get series
      if (wantType && itemType !== wantType) continue;

      results.push({
        name: name,
        type: itemType,
        url: post.href,
        providerId: providerId
      });
    }

    console.log('[DhakaFlix] ' + providerId + ' "' + query + '" → ' +
                results.length);
    return results;
  });
}

// ---------- Alphabet bucket fallback (series only) ----------
function searchSeriesAlphabetBuckets(title, provider, providerId) {
  if (!provider.seriesRoots || provider.seriesRoots.length === 0) {
    return Promise.resolve([]);
  }

  var firstChar = title.trim().charAt(0).toUpperCase();
  var bucket;
  if (/[0-9]/.test(firstChar)) bucket = provider.seriesRoots[0];
  else if (firstChar >= 'A' && firstChar <= 'L') bucket = provider.seriesRoots[1];
  else if (firstChar >= 'M' && firstChar <= 'R') bucket = provider.seriesRoots[2];
  else bucket = provider.seriesRoots[3];

  var url = provider.mainUrl + '/' + provider.serverName + '/' + bucket;
  console.log('[DhakaFlix] Alphabet bucket → ' + bucket);

  return fetchWithHeaders(url)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var results = [];
      var cleanTarget = clean(title);
      var firstTwo = cleanTarget.split(' ').slice(0, 2).join(' ');

      $('tbody > tr:gt(1)').each(function(_, row) {
        var $a = $(row).find('td.fb-n > a');
        var link = $a.attr('href');
        var name = $a.text();
        if (!link) return;

        var cn = clean(name);
        var matched = cn.indexOf(cleanTarget) !== -1 ||
                      (firstTwo.length > 4 && cn.indexOf(firstTwo) !== -1);

        if (matched) {
          results.push({
            name: name,
            type: 'series',
            url: constructUrl(provider.mainUrl, link),
            providerId: providerId
          });
        }
      });

      console.log('[DhakaFlix] Bucket matched ' + results.length);
      return results;
    })
    .catch(function(err) {
      console.log('[DhakaFlix] Bucket failed: ' + err.message);
      return [];
    });
}

// ---------- Best match picker ----------
function pickBest(results, targetTitle, targetYear, wantType) {
  var cleanTarget = clean(targetTitle);
  var best = null;
  var bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.type !== wantType) continue;

    var cn = clean(r.name);
    var score = 0;

    if (cn === cleanTarget) score = 20;
    else if (cn.indexOf(cleanTarget) !== -1) score = 15;
    else if (cleanTarget.indexOf(cn) !== -1) score = 12;
    else {
      var fw = cleanTarget.split(' ')[0];
      if (fw.length > 3 && cn.indexOf(fw) !== -1) score = 5;
    }

    if (score === 0) continue;

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

  if (best) {
    console.log('[DhakaFlix] Best "' + best.name + '" score=' + bestScore);
  }
  return best;
}

// ---------- Process matches → streams ----------
// ---------- Process matches → streams ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);

  var label = (wantType === 'series') ? 'Series' : 'Movies';

  var promises = matches.map(function(match) {
    var provider = PROVIDERS[match.providerId];
    console.log('[DhakaFlix] LOAD ' + match.providerId + ' ' + match.url);

    return loadContent(match.url, provider, wantType)
      .then(function(content) {
        if (!content || !content.episodes || content.episodes.length === 0) {
          console.log('[DhakaFlix] ' + match.providerId + ' no episodes');
          return [];
        }

        var list = content.episodes;
        console.log('[DhakaFlix] ' + match.providerId + ' eps=' + list.length);

        if (season && episode) {
          var filtered = list.filter(function(ep) {
            return ep.season === season && ep.episode === episode;
          });
          if (filtered.length > 0) list = filtered;
          else console.log('[DhakaFlix] S' + season + 'E' + episode +
                           ' not found, using all');
        }

        return list.map(function(ep) {
          var prefix = 'S' + pad2(ep.season) + 'E' + pad2(ep.episode);
          var quality = extractQuality(ep.name || '');
          return {
            name: label,
            title: '[' + prefix + '] ' + ep.name +
                   (quality !== 'Unknown' ? ' (' + quality + ')' : ''),
            url: ep.url,
            quality: quality,
            provider: 'dhakaflix'
          };
        });
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

// ---------- Load content ----------
function loadContent(url, provider, wantType) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] GET ' + fullUrl);

  return fetchWithHeaders(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var isSeries = containsAny(url, provider.tvSeriesKeyword) ||
                     wantType === 'series';

      var videoFiles = [];
      var seasonFolders = [];
      var otherFolders = [];

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
        } else if (isFolder && link) {
          otherFolders.push(constructUrl(provider.mainUrl, link));
        } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          videoFiles.push({
            name: name,
            url: constructUrl(provider.mainUrl, link)
          });
        }
      });

      console.log('[DhakaFlix] v=' + videoFiles.length +
                  ' sf=' + seasonFolders.length +
                  ' of=' + otherFolders.length);

      // Movie branch
      if (!isSeries) {
        if (videoFiles.length > 0) {
          return {
            type: 'movie',
            videoFiles: videoFiles,
            episodes: videoFiles.map(function(v, i) {
              return { name: v.name, season: 0, episode: i + 1, url: v.url };
            })
          };
        }
        if (otherFolders.length > 0) {
          var subPromises = otherFolders.map(function(fu) {
            return loadContent(fu, provider, 'movie');
          });
          return Promise.all(subPromises).then(function(results) {
            var all = [];
            for (var i = 0; i < results.length; i++) {
              if (results[i] && results[i].videoFiles) {
                all = all.concat(results[i].videoFiles);
              }
            }
            return {
              type: 'movie',
              videoFiles: all,
              episodes: all.map(function(v, i) {
                return { name: v.name, season: 0, episode: i + 1, url: v.url };
              })
            };
          });
        }
        return { type: 'movie', videoFiles: [], episodes: [] };
      }

      // Series with season folders
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

      // Series flat episodes
      if (videoFiles.length > 0) {
        return { type: 'series', episodes: videoFiles.map(function(v, i) {
          return { name: v.name, season: 1, episode: i + 1, url: v.url };
        })};
      }

      // Series sub-folders
      if (otherFolders.length > 0) {
        var subPromises2 = otherFolders.map(function(fu) {
          return fetchWithHeaders(fu)
            .then(function(r) { return r.text(); })
            .then(function(subHtml) {
              var $$ = load(subHtml);
              var subEps = [];
              $$('tbody > tr:gt(1)').each(function(_, row) {
                var $a = $$(row).find('td.fb-n > a');
                var link = $a.attr('href');
                if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
                  subEps.push({
                    name: $a.text(),
                    season: 1,
                    episode: subEps.length + 1,
                    url: constructUrl(provider.mainUrl, link)
                  });
                }
              });
              return subEps;
            })
            .catch(function() { return []; });
        });
        return Promise.all(subPromises2).then(function(arrs) {
          var eps = [];
          for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) eps.push(arrs[i][j]);
          }
          return { type: 'series', episodes: eps };
        });
      }

      return { type: 'series', episodes: [] };
    });
}

// ---------- Season extractor ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  return fetchWithHeaders(seasonUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var episodes = [];
      $('tbody > tr:gt(1)').each(function(_, row) {
        var $a = $(row).find('td.fb-n > a');
        var link = $a.attr('href');
        if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          episodes.push({
            name: $a.text(),
            season: seasonNum,
            episode: episodes.length + 1,
            url: constructUrl(provider.mainUrl, link)
          });
        }
      });
      console.log('[DhakaFlix] S' + seasonNum + ' → ' + episodes.length);
      return episodes;
    })
    .catch(function() { return []; });
}

// ---------- HTML parser (Hermes fallback) ----------
var load = (function() {
  try {
    return require('cheerio-without-node-native').load;
  } catch (e) {
    console.log('[DhakaFlix] Regex fallback parser');
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
          results.push({ href: am[1], text: am[2].replace(/<[^>]+>/g, '').trim() });
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
  var cleanPath = path.replace(/([^:]\/)\/+/g, '$1');
  return base.replace(/\/$/, '') + '/' + cleanPath.replace(/^\//, '');
}
function nameFromUrl(href) {
  var d = decodeURIComponent(href);
  var m = d.match(/.*\/([^/]+)(?:\/[^/]*)*$/);
  return m ? m[1] : '';
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
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

module.exports = { getStreams: getStreams };