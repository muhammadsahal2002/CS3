// Nuvio plugin: DhakaFlix BDIX — final lean build
var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: 'DhakaFlix 14',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'series']
  },
  dhakaflix12: {
    mainUrl: 'http://172.16.50.12',
    serverName: 'DHAKA-FLIX-12',
    name: 'DhakaFlix 12',
    tvSeriesKeyword: ['TV-WEB-Series'],
    supportedTypes: ['series']
  },
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: 'DhakaFlix 7',
    tvSeriesKeyword: [],
    supportedTypes: ['movie']
  }
};

var CACHE = {};
var INFLIGHT = {};
var META_CACHE = {};
var MAX_RESULTS = 40;

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

// ---------- Search — primary query only, then fallbacks ----------
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

function searchAllProviders(query, wantType, year) {
  var ids = Object.keys(PROVIDERS).filter(function(id) {
    return PROVIDERS[id].supportedTypes.indexOf(wantType) !== -1;
  });
  var queries = buildSearchQueries(query, year);
  console.log('[DhakaFlix] Queries: ' + JSON.stringify(queries) +
              ' providers: ' + ids.join(','));

  // Primary query on all providers in parallel
  return Promise.all(ids.map(function(id) {
    return searchProvider(queries[0], PROVIDERS[id], id, wantType)
      .catch(function() { return []; });
  })).then(function(batches) {
    var flat = [];
    for (var i = 0; i < batches.length; i++) {
      for (var j = 0; j < batches[i].length; j++) flat.push(batches[i][j]);
    }
    if (flat.length > 0) {
      console.log('[DhakaFlix] Primary hit ' + flat.length);
      return flat;
    }
    if (queries.length <= 1) return [];

    // Fallback queries in parallel
    console.log('[DhakaFlix] Fallback queries: ' + (queries.length - 1));
    var fbP = [];
    for (var q = 1; q < queries.length; q++) {
      for (var k = 0; k < ids.length; k++) {
        (function(qq, id) {
          fbP.push(searchProvider(qq, PROVIDERS[id], id, wantType)
            .catch(function() { return []; }));
        })(queries[q], ids[k]);
      }
    }
    return Promise.all(fbP).then(function(arrs) {
      var seen = {}, fb = [];
      for (var i = 0; i < arrs.length; i++) {
        for (var j = 0; j < arrs[i].length; j++) {
          var r = arrs[i][j];
          var u = (r.url || '').toLowerCase();
          if (seen[u]) continue;
          seen[u] = true;
          fb.push(r);
        }
      }
      return fb;
    });
  }).then(function(results) {
    // Best per provider
    var per = {};
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!per[r.providerId]) per[r.providerId] = [];
      per[r.providerId].push(r);
    }
    var picks = [];
    for (var pid in per) {
      var best = pickBest(per[pid], query, year, wantType);
      if (best) picks.push(best);
    }
    console.log('[DhakaFlix] Picks: ' + picks.length);
    return picks;
  });
}

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
      var isSeries = containsAny(href, provider.tvSeriesKeyword);
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

function pickBest(results, targetTitle, targetYear, wantType) {
  var cleanTarget = clean(targetTitle);
  var best = null, bestScore = 0;
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
      var fy = ym ? parseInt(ym[1]) : null;
      if (fy && targetYear) {
        var d = Math.abs(fy - targetYear);
        if (d === 0) score += 10;
        else if (d === 1) score += 3;
      }
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  if (best) console.log('[DhakaFlix] Best "' + best.name + '" score=' + bestScore);
  return best;
}

// ---------- Process (folder → files, one level) ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);
  var label = (wantType === 'series') ? 'Series' : 'Movies';

  var promises = matches.map(function(match) {
    var provider = PROVIDERS[match.providerId];

    // Already a file — emit directly
    if (match.isFile) {
      var q = extractQuality(match.name);
      return Promise.resolve([{
        name: label,
        title: match.name + (q !== 'Unknown' ? ' (' + q + ')' : ''),
        url: constructUrl(provider.mainUrl, match.url),
        quality: q, provider: 'dhakaflix'
      }]);
    }

    // Folder — GET once, list files or season folders
    var fullUrl = constructUrl(provider.mainUrl, match.url);
    console.log('[DhakaFlix] GET ' + fullUrl);

    return fetchWithHeaders(fullUrl)
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var $ = load(html);
        var files = [], seasons = [];

        $('tbody > tr:gt(1)').each(function(_, row) {
          var $row = $(row);
          var $a = $row.find('td.fb-n > a');
          var link = $a.attr('href');
          var name = $a.text();
          var isFolder = $row.find('td.fb-i > img[alt="folder"]').length > 0;

          if (isFolder && /season/i.test(name)) {
            var sm = name.match(/season[\s]*(\d+)/i);
            seasons.push({
              url: constructUrl(provider.mainUrl, link),
              season: sm ? parseInt(sm[1]) : 0
            });
          } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
            files.push({ name: name, url: constructUrl(provider.mainUrl, link) });
          }
        });

        // Movie folder with direct files
        if (wantType === 'movie' && files.length > 0) {
          return files.map(function(f) {
            var q = extractQuality(f.name);
            return {
              name: label, title: f.name + (q !== 'Unknown' ? ' (' + q + ')' : ''),
              url: f.url, quality: q, provider: 'dhakaflix'
            };
          });
        }

        // Series with season folders — GET each in parallel
        if (wantType === 'series' && seasons.length > 0) {
          var sp = seasons.map(function(s) {
            return fetchWithHeaders(s.url)
              .then(function(r) { return r.text(); })
              .then(function(sub) {
                var $$ = load(sub);
                var eps = [];
                $$('tbody > tr:gt(1)').each(function(_, row) {
                  var $a = $$(row).find('td.fb-n > a');
                  var link = $a.attr('href');
                  if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
                    var se = parseEpisodeNumbers($a.text());
                    eps.push({
                      name: $a.text(),
                      season: se.season || s.season,
                      episode: se.episode || (eps.length + 1),
                      url: constructUrl(provider.mainUrl, link)
                    });
                  }
                });
                return eps;
              })
              .catch(function() { return []; });
          });
          return Promise.all(sp).then(function(arrs) {
            var all = [];
            for (var i = 0; i < arrs.length; i++) {
              for (var j = 0; j < arrs[i].length; j++) all.push(arrs[i][j]);
            }
            // Filter to requested episode if given
            if (season && episode) {
              var f = all.filter(function(e) {
                return e.season === season && e.episode === episode;
              });
              if (f.length > 0) all = f;
            }
            return all.map(function(e) {
              var prefix = 'S' + pad2(e.season) + 'E' + pad2(e.episode);
              var q = extractQuality(e.name);
              return {
                name: label,
                title: '[' + prefix + '] ' + e.name +
                       (q !== 'Unknown' ? ' (' + q + ')' : ''),
                url: e.url, quality: q, provider: 'dhakaflix'
              };
            });
          });
        }

        // Series with flat files
        if (wantType === 'series' && files.length > 0) {
          return files.map(function(f, i) {
            var se = parseEpisodeNumbers(f.name);
            var prefix = 'S' + pad2(se.season || 1) + 'E' + pad2(se.episode || (i + 1));
            var q = extractQuality(f.name);
            return {
              name: label,
              title: '[' + prefix + '] ' + f.name +
                     (q !== 'Unknown' ? ' (' + q + ')' : ''),
              url: f.url, quality: q, provider: 'dhakaflix'
            };
          });
        }

        return [];
      })
      .catch(function(err) {
        console.log('[DhakaFlix] folder failed: ' + err.message);
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