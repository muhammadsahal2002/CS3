// Nuvio plugin: DhakaFlix BDIX — Best of Both
// Movies: improved pickBest + MAX_RESULTS=400
// Series: loadContent + alphabet bucket + extractSeason
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: 'DhakaFlix 14',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'series'],
    movieRoots: [
      'English Movies (1080p)/', 'English Movies/', 'Hindi Movies/',
      'Animation Movies (1080p)/', 'IMDb Top-250 Movies/', 'SOUTH INDIAN MOVIES/'
    ],
    seriesRoots: ['KOREAN TV %26 WEB Series/']
  },
  dhakaflix12: {
    mainUrl: 'http://172.16.50.12',
    serverName: 'DHAKA-FLIX-12',
    name: 'DhakaFlix 12',
    tvSeriesKeyword: ['TV-WEB-Series'],
    supportedTypes: ['series'],
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
    name: 'DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie'],
    movieRoots: [
      'English Movies/', 'English Movies (1080p)/', '3D Movies/',
      'Foreign Language Movies/', 'Kolkata Bangla Movies/'
    ],
    seriesRoots: []
  }
};

var CACHE = {};
var INFLIGHT = {};
var META_CACHE = {};
var MAX_RESULTS = 400;

var USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

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

// ---------- Entry ----------
function getStreams(tmdbId, mediaType, season, episode) {
  var wantType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';
  var key = tmdbId + ':' + wantType + ':' + (season || 0) + ':' + (episode || 0);
  if (CACHE[key]) return Promise.resolve(CACHE[key]);
  if (INFLIGHT[key]) return INFLIGHT[key];

  var p = resolveTmdbToImdb(tmdbId, wantType)
    .then(function(imdbId) { return fetchOmdb(imdbId); })
    .then(function(media) {
      var effectiveType = media.type === 'movie' ? 'movie' :
                          media.type === 'series' ? 'series' : wantType;
      console.log('[DhakaFlix] Search "' + media.title + '" as ' + effectiveType);
      return searchAllProviders(media.title, effectiveType, media.year);
    })
    .then(function(matches) {
      return processMatches(matches, wantType, season, episode);
    })
    .then(function(streams) {
      CACHE[key] = streams;
      delete INFLIGHT[key];
      console.log('[DhakaFlix] DONE ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[DhakaFlix] ERROR: ' + err.message);
      delete INFLIGHT[key];
      return [];
    });

  INFLIGHT[key] = p;
  return p;
}

function resolveTmdbToImdb(tmdbId, wantType) {
  var ck = 'tmdb|' + wantType + '|' + tmdbId;
  if (META_CACHE[ck]) return Promise.resolve(META_CACHE[ck]);
  var path = wantType === 'series' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;
  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.imdb_id) { META_CACHE[ck] = data.imdb_id; return data.imdb_id; }
      var extUrl = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
                   '/external_ids?api_key=' + TMDB_API_KEY;
      return fetch(extUrl).then(function(r) { return r.json(); })
        .then(function(ext) {
          if (ext && ext.imdb_id) { META_CACHE[ck] = ext.imdb_id; return ext.imdb_id; }
          throw new Error('No imdb_id from TMDB');
        });
    });
}

function fetchOmdb(imdbId) {
  var ck = 'omdb|' + imdbId;
  if (META_CACHE[ck]) return Promise.resolve(META_CACHE[ck]);
  var url = 'https://www.omdbapi.com/?i=' + imdbId + '&apikey=' + OMDB_API_KEY;
  return fetch(url).then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.Response !== 'True') throw new Error('OMDb: ' + data.Error);
      var media = { title: data.Title, year: parseInt(data.Year) || null, type: data.Type };
      META_CACHE[ck] = media;
      return media;
    });
}

// ---------- Search queries ----------
function buildSearchQueries(title, year) {
  var queries = [], seen = {};
  function add(q) {
    if (!q) return;
    q = q.trim();
    if (q.length < 2 || seen[q.toLowerCase()]) return;
    seen[q.toLowerCase()] = true;
    queries.push(q);
  }
  add(title);
  if (title.indexOf(':') !== -1) add(title.split(':')[0]);
  else if (title.indexOf(' - ') !== -1) add(title.split(' - ')[0]);
  var words = title.split(/\s+/);
  if (words.length > 2) add(words.slice(0, 2).join(' '));
  var stripped = title.replace(/^(The|A|An)\s+/i, '');
  if (stripped !== title) add(stripped);
  return queries;
}

// ---------- Multi-query parallel search + alphabet bucket fallback ----------
function searchAllProviders(query, wantType, year) {
  var queries = buildSearchQueries(query, year);
  var ids = Object.keys(PROVIDERS).filter(function(id) {
    return PROVIDERS[id].supportedTypes.indexOf(wantType) !== -1;
  });
  console.log('[DhakaFlix] Queries: ' + JSON.stringify(queries) +
              ' providers: ' + ids.join(','));

  var promises = ids.map(function(id) {
    var provider = PROVIDERS[id];
    return searchProviderParallel(queries, provider, id, wantType)
      .then(function(results) {
        // Series: alphabet bucket fallback when search returns 0
        if (wantType === 'series' && results.length === 0 &&
            provider.seriesRoots && provider.seriesRoots.length > 0) {
          console.log('[DhakaFlix] ' + id + ' empty, alphabet bucket fallback');
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
      });
  });

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var i = 0; i < arrs.length; i++) {
      for (var j = 0; j < arrs[i].length; j++) flat.push(arrs[i][j]);
    }
    console.log('[DhakaFlix] Picks: ' + flat.length);
    return flat;
  });
}

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

// ---------- Single query — with multi-signal series detection ----------
function searchProvider(query, provider, providerId, wantType) {
  var body = JSON.stringify({
    action: 'get',
    search: { href: '/' + provider.serverName + '/', pattern: query, ignorecase: true }
  });
  return fetchWithHeaders(provider.mainUrl + '/' + provider.serverName + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body
  }).then(function(res) { return res.json(); })
  .then(function(data) {
    var list = (data.search || []).filter(function(p) {
      return p.href && p.href !== '/' + provider.serverName + '/';
    });
    if (list.length > MAX_RESULTS) list = list.slice(0, MAX_RESULTS);

    var results = [];
    for (var i = 0; i < list.length; i++) {
      var post = list[i], href = post.href;
      var isFile = /\.(mkv|mp4|avi|webm)$/i.test(href);
      var name = nameFromUrl(href);

      // Multi-signal series detection
      var decoded = decodeURIComponent(href);
      var isSeries = containsAny(href, provider.tvSeriesKeyword) ||
                     /\(TV\s+(Mini\s+)?Series\b/i.test(decoded) ||
                     /\bTV-WEB-Series\b/i.test(decoded) ||
                     /\bSeason\s+\d+\b/i.test(decoded);

      var itemType = isSeries ? 'series' : 'movie';
      if (wantType && itemType !== wantType) continue;

      results.push({
        name: name, type: itemType, url: href,
        providerId: providerId, isFile: isFile
      });
    }
    console.log('[DhakaFlix] ' + providerId + ' "' + query + '" → ' + results.length);
    return results;
  });
}

// ---------- Alphabet bucket fallback (dhakaflix12 series) ----------
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
            name: name, type: 'series',
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

// ---------- pickBest — token matching + year hard filter (fixed for MAD) ----------
function pickBest(results, targetTitle, targetYear, wantType) {
  var targetTokens = clean(targetTitle).split(' ').filter(function(t) {
    return t.length > 1;
  });
  var best = null, bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.type !== wantType) continue;

    var ym = r.name.match(/\((\d{4})\)/) || r.name.match(/\b(19\d{2}|20\d{2})\b/);
    var fileYear = ym ? parseInt(ym[1]) : null;

    // Hard year filter for movies
    if (wantType === 'movie' && targetYear && fileYear) {
      if (Math.abs(fileYear - targetYear) > 1) continue;
    }

    var nameTokens = clean(r.name).split(' ').filter(function(t) {
      return t.length > 1;
    });
    var matched = 0;
    for (var t = 0; t < targetTokens.length; t++) {
      if (nameTokens.indexOf(targetTokens[t]) !== -1) matched++;
    }
    if (matched === 0) continue;

    var coverage = matched / targetTokens.length;
    var cn = clean(r.name);
    var ct = clean(targetTitle);
    var score = 0;

    if (cn === ct) score = 25;
    else if (coverage === 1) score = 20;
    else if (coverage >= 0.6) score = 15;
    else if (coverage >= 0.4) score = 10;
    else score = 5;

    // ═══ POSITION BONUS ═══
    // If the query's FIRST token appears at the START of the folder name,
    // it's very likely the actual show title, not an episode name
    var firstToken = targetTokens[0];
    if (firstToken) {
      var firstPos = nameTokens.indexOf(firstToken);
      if (firstPos === 0) score += 15;         // starts with target — strong signal
      else if (firstPos === 1) score += 5;     // second position — decent
      else if (firstPos >= 3) score -= 10;     // buried — likely episode name
    }

    // ═══ CONSECUTIVE TOKEN BONUS ═══
    // Real titles have all tokens in order at the start:
    // "two and a half men" (consecutive) vs "supernatural s06e02 two and a half men" (not from start)
    var consecutive = 0;
    for (var k = 0; k < targetTokens.length; k++) {
      var pos = nameTokens.indexOf(targetTokens[k]);
      if (pos === k) consecutive++;   // token at expected position
      else break;
    }
    if (consecutive === targetTokens.length) score += 10;  // perfect prefix

    // Year alignment for movies
    if (wantType === 'movie' && targetYear && fileYear) {
      var d = Math.abs(fileYear - targetYear);
      if (d === 0) score += 10;
      else if (d === 1) score += 3;
    }

    // Year alignment for series — the show year range should include or be near target
    if (wantType === 'series' && targetYear && fileYear) {
      var dS = Math.abs(fileYear - targetYear);
      if (dS <= 2) score += 8;   // series often has year range close to start
      else if (dS <= 5) score += 3;
      else if (dS > 15) score -= 5;  // 2020 for 2003 show — likely wrong
    }

    if (r.isFile) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  if (best) {
    console.log('[DhakaFlix] Best "' + best.name + '" score=' + bestScore +
                ' tokens=[' + targetTokens.join(',') + '] year=' + targetYear);
  } else {
    console.log('[DhakaFlix] NO MATCH tokens=[' + targetTokens.join(',') +
                '] year=' + targetYear);
  }
  return best;
}
// ---------- processMatches — dispatches movie vs series ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);
  var label = (wantType === 'series') ? 'Series' : 'Movies';

  var promises = matches.map(function(match) {
    var provider = PROVIDERS[match.providerId];

    // Fast path — search already returned a file
    if (match.isFile) {
      var q = extractQuality(match.name);
      return Promise.resolve([{
        name: label,
        title: match.name + (q !== 'Unknown' ? ' (' + q + ')' : ''),
        url: constructUrl(provider.mainUrl, match.url),
        quality: q, provider: 'dhakaflix'
      }]);
    }

    // Folder path
    if (wantType === 'series') {
      return loadSeriesContent(match.url, provider, season, episode, label);
    }
    return loadMovieContent(match.url, provider, label);
  });

  return Promise.all(promises).then(function(arrs) {
    var flat = [];
    for (var i = 0; i < arrs.length; i++) {
      for (var j = 0; j < arrs[i].length; j++) flat.push(arrs[i][j]);
    }
    return flat;
  });
}

// ---------- Movie loader (simple, one level, with sub-folder fallback) ----------
function loadMovieContent(url, provider, label) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] MOVIE GET ' + fullUrl);

  return fetchWithHeaders(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var files = [], folders = [];

      $('tbody > tr:gt(1)').each(function(_, row) {
        var $row = $(row);
        var $a = $row.find('td.fb-n > a');
        var link = $a.attr('href');
        var name = $a.text();
        var isFolder = $row.find('td.fb-i > img[alt="folder"]').length > 0;

        if (isFolder && link) {
          folders.push(constructUrl(provider.mainUrl, link));
        } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          files.push({ name: name, url: constructUrl(provider.mainUrl, link) });
        }
      });

      if (files.length > 0) {
        return files.map(function(f) {
          var q = extractQuality(f.name);
          return {
            name: label,
            title: f.name + (q !== 'Unknown' ? ' (' + q + ')' : ''),
            url: f.url, quality: q, provider: 'dhakaflix'
          };
        });
      }

      if (folders.length > 0) {
        var sp = folders.map(function(fu) {
          return loadMovieContent(fu, provider, label).catch(function() { return []; });
        });
        return Promise.all(sp).then(function(arrs) {
          var all = [];
          for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) all.push(arrs[i][j]);
          }
          return all;
        });
      }

      return [];
    })
    .catch(function(err) {
      console.log('[DhakaFlix] MOVIE load failed: ' + err.message);
      return [];
    });
}

// ---------- Series loader (season folders + extractSeason) ----------
function loadSeriesContent(url, provider, season, episode, label) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] SERIES GET ' + fullUrl);

  return fetchWithHeaders(fullUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
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
            name: name, url: constructUrl(provider.mainUrl, link)
          });
        }
      });

      console.log('[DhakaFlix] SERIES v=' + videoFiles.length +
                  ' sf=' + seasonFolders.length + ' of=' + otherFolders.length);

      // Season folders — load in parallel
      if (seasonFolders.length > 0) {
        var sfPromises = seasonFolders.map(function(sf) {
          return extractSeason(sf.url, provider, sf.season);
        });
        return Promise.all(sfPromises).then(function(arrs) {
          var eps = [];
          for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) eps.push(arrs[i][j]);
          }
          return finalizeEpisodes(eps, season, episode, label);
        });
      }

      // Flat episodes at root
      if (videoFiles.length > 0) {
        var eps2 = videoFiles.map(function(v, i) {
          var se = parseEpisodeNumbers(v.name);
          return {
            name: v.name,
            season: se.season || 1,
            episode: se.episode || (i + 1),
            url: v.url
          };
        });
        return finalizeEpisodes(eps2, season, episode, label);
      }

      // Sub-folders (non-season named) — try each, one level
      if (otherFolders.length > 0) {
        var subPromises = otherFolders.map(function(fu) {
          return fetchWithHeaders(fu)
            .then(function(r) { return r.text(); })
            .then(function(subHtml) {
              var $$ = load(subHtml);
              var subEps = [];
              $$('tbody > tr:gt(1)').each(function(_, row) {
                var $a = $$(row).find('td.fb-n > a');
                var link = $a.attr('href');
                if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
                  var se = parseEpisodeNumbers($a.text());
                  subEps.push({
                    name: $a.text(),
                    season: se.season || 1,
                    episode: se.episode || (subEps.length + 1),
                    url: constructUrl(provider.mainUrl, link)
                  });
                }
              });
              return subEps;
            })
            .catch(function() { return []; });
        });
        return Promise.all(subPromises).then(function(arrs) {
          var eps = [];
          for (var i = 0; i < arrs.length; i++) {
            for (var j = 0; j < arrs[i].length; j++) eps.push(arrs[i][j]);
          }
          return finalizeEpisodes(eps, season, episode, label);
        });
      }

      return [];
    })
    .catch(function(err) {
      console.log('[DhakaFlix] SERIES load failed: ' + err.message);
      return [];
    });
}

function finalizeEpisodes(eps, season, episode, label) {
  // Filter to requested episode if given
  if (season && episode) {
    var filtered = eps.filter(function(e) {
      return e.season === season && e.episode === episode;
    });
    if (filtered.length > 0) eps = filtered;
  }
  return eps.map(function(e) {
    var prefix = 'S' + pad2(e.season) + 'E' + pad2(e.episode);
    var q = extractQuality(e.name || '');
    return {
      name: label,
      title: '[' + prefix + '] ' + e.name +
             (q !== 'Unknown' ? ' (' + q + ')' : ''),
      url: e.url, quality: q, provider: 'dhakaflix'
    };
  });
}

// ---------- Season folder extractor ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] S' + seasonNum + ' GET ' + seasonUrl);
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

function parseEpisodeNumbers(name) {
  var m = name.match(/S(\d{1,2})E(\d{1,3})/i);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  m = name.match(/(\d{1,2})x(\d{1,3})/);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  m = name.match(/(?:Episode|Ep|E)\s*[-._ ]?\s*(\d{1,3})/i);
  if (m) return { season: 1, episode: parseInt(m[1]) };
  return { season: 1, episode: 0 };
}

// ---------- HTML parser ----------
var load = (function() {
  try { return require('cheerio-without-node-native').load; }
  catch (e) {
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