// Nuvio plugin: DhakaFlix BDIX (movies + series) — FINAL
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
      return searchAllProviders(media.title, wantType, media.year);
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

// ---------- TMDB ID → IMDB ID (with external_ids fallback) ----------
function resolveTmdbToImdb(tmdbId, wantType) {
  var path = wantType === 'series' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      console.log('[DhakaFlix] TMDB primary imdb_id=' +
                  (data ? data.imdb_id : 'null'));
      if (data && data.imdb_id) return data.imdb_id;

      console.log('[DhakaFlix] Trying /external_ids');
      var extUrl = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
                   '/external_ids?api_key=' + TMDB_API_KEY;
      return fetch(extUrl)
        .then(function(r) { return r.json(); })
        .then(function(ext) {
          console.log('[DhakaFlix] external_ids imdb_id=' +
                      (ext ? ext.imdb_id : 'null'));
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
        type: data.Type
      };
    });
}

// ---------- Parallel search ----------
function searchAllProviders(query, wantType, year) {
  var ids = Object.keys(PROVIDERS);
  var promises = [];

  for (var i = 0; i < ids.length; i++) {
    (function(id) {
      var provider = PROVIDERS[id];
      if (provider.supportedTypes.indexOf(wantType) === -1) {
        console.log('[DhakaFlix] Skip ' + id + ' (no ' + wantType + ')');
        return;
      }
      console.log('[DhakaFlix] Search ' + id);

      promises.push(
        searchProvider(query, provider, id)
          .then(function(results) {
            // Series: if API search returned 0, try alphabet bucket scrape
            if (wantType === 'series' && results.length === 0) {
              console.log('[DhakaFlix] ' + id +
                          ' empty, trying alphabet bucket');
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
    console.log('[DhakaFlix] ' + providerId + ' → ' + results.length);
    return results;
  });
}

// ---------- Series alphabet-bucket fallback (dhakaflix12 only) ----------
function searchSeriesAlphabetBuckets(title, provider, providerId) {
  // Only dhakaflix12 uses TV-WEB-Series alphabet buckets
  if (providerId !== 'dhakaflix12') return Promise.resolve([]);

  var buckets = {
    '0-9': 'TV-WEB-Series/TV Series ★%20 0%20 —%20 9/',
    'A-L': 'TV-WEB-Series/TV Series ♥%20 A%20 —%20 L/',
    'M-R': 'TV-WEB-Series/TV Series ♦%20 M%20 —%20 R/',
    'S-Z': 'TV-WEB-Series/TV Series ♦%20 S%20 —%20 Z/'
  };

  var firstChar = title.trim().charAt(0).toUpperCase();
  var bucket;
  if (/[0-9]/.test(firstChar)) bucket = buckets['0-9'];
  else if (firstChar >= 'A' && firstChar <= 'L') bucket = buckets['A-L'];
  else if (firstChar >= 'M' && firstChar <= 'R') bucket = buckets['M-R'];
  else bucket = buckets['S-Z'];

  var url = provider.mainUrl + '/' + provider.serverName + '/' + bucket;
  console.log('[DhakaFlix] Alphabet bucket ' + bucket);

  return fetch(url)
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
        var matched = false;
        if (cn.indexOf(cleanTarget) !== -1) matched = true;
        else if (firstTwo.length > 4 && cn.indexOf(firstTwo) !== -1) matched = true;

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

// ---------- Pick best match ----------
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
  return best;
}

// ---------- Load content + extract streams ----------
function processMatches(matches, wantType, season, episode) {
  if (!matches.length) return Promise.resolve([]);

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
            name: provider.name,
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

// ---------- Load series or movie content ----------
function loadContent(url, provider, wantType) {
  var fullUrl = constructUrl(provider.mainUrl, url);
  console.log('[DhakaFlix] GET ' + fullUrl);

  return fetch(fullUrl)
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

      console.log('[DhakaFlix] videos=' + videoFiles.length +
                  ' seasonFolders=' + seasonFolders.length +
                  ' otherFolders=' + otherFolders.length);

      // Movie branch
      if (!isSeries) {
        if (videoFiles.length > 0) {
          return {
            type: 'movie',
            videoFiles: videoFiles,
            episodes: videoFiles.map(function(v, i) {
              return {
                name: v.name, season: 0, episode: i + 1, url: v.url
              };
            })
          };
        }
        // Movie folder with sub-folders
        if (otherFolders.length > 0) {
          var movieSubPromises = otherFolders.map(function(folderUrl) {
            return loadContent(folderUrl, provider, 'movie');
          });
          return Promise.all(movieSubPromises).then(function(results) {
            var allVideos = [];
            results.forEach(function(r) {
              if (r && r.videoFiles) allVideos = allVideos.concat(r.videoFiles);
            });
            return {
              type: 'movie',
              videoFiles: allVideos,
              episodes: allVideos.map(function(v, i) {
                return {
                  name: v.name, season: 0, episode: i + 1, url: v.url
                };
              })
            };
          });
        }
        return { type: 'movie', videoFiles: [], episodes: [] };
      }

      // Series branch — season folders
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

      // Series — flat episodes at root
      if (videoFiles.length > 0) {
        var eps = videoFiles.map(function(v, i) {
          return { name: v.name, season: 1, episode: i + 1, url: v.url };
        });
        return { type: 'series', episodes: eps };
      }

      // Series — sub-folders as seasons
      if (otherFolders.length > 0) {
        var subPromises = otherFolders.map(function(folderUrl) {
          return fetch(folderUrl)
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
        return Promise.all(subPromises).then(function(arrs) {
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

// ---------- Season folder extractor ----------
function extractSeason(seasonUrl, provider, seasonNum) {
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
    .catch(function(err) {
      console.log('[DhakaFlix] extractSeason failed: ' + err.message);
      return [];
    });
}

// ---------- HTML parser (Hermes-compatible) ----------
var load = (function() {
  try {
    return require('cheerio-without-node-native').load;
  } catch (e) {
    console.log('[DhakaFlix] Regex fallback parser active');
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
  var clean = path.replace(/([^:]\/)\/+/g, '$1');
  return base.replace(/\/$/, '') + '/' + clean.replace(/^\//, '');
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