var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';

var USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

var FTP5_BASE = 'https://server5.ftpbd.net';
var FTP5_ROOT = '/FTP-5/Anime--Cartoon-TV-Series/';

var FTP2_BASE = 'https://server2.ftpbd.net';
var FTP2_ROOT = '/FTP-2/English%20Movies/';
var FTP2_IMDB = '/FTP-2/English%20Movies/IMDB-TOP-250/';

var FTP3_BASE = 'https://server3.ftpbd.net';
var FTP3_KOLKATA = '/FTP-3/Bangla%20Collection/BANGLA/Kolkata-Bangla-Movies/';
var FTP3_WEBSERIES = '/FTP-3/Bangla%20Collection/BANGLA/Web-Series/';

var CACHE = {};
var INFLIGHT = {};
var META_CACHE = {};

var SEASON_FOLDER_RE = /^(?:s|season|series)[\s._-]*(\d{1,2})$/i;

function safeDecode(s) {
  try { return decodeURIComponent(s); }
  catch (e) { return s; }
}

function fetchWithHeaders(url, options) {
  options = options || {};
  var headers = options.headers || {};
  headers['User-Agent'] = USER_AGENT;
  headers['Accept'] = 'text/html,application/json,*/*';
  headers['Accept-Language'] = 'en-GB,en;q=0.6';
  options.headers = headers;
  return fetch(url, options);
}

function clean(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_\.]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^\d{2,4}[-\s]+/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[-_\.:]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dfQuality(name) {
  var m = name.match(/\b(720p|1080p|2160p|4K|480p|360p)\b/i);
  return m ? 'Bnet ' + m[1].toUpperCase() : 'Unknown';
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// ---------- TMDB ----------
function fetchTmdb(tmdbId, wantType) {
  var ck = 'tmdb|' + wantType + '|' + tmdbId;
  if (META_CACHE[ck]) return Promise.resolve(META_CACHE[ck]);
  var path = wantType === 'series' ? 'tv' : 'movie';
  var url = 'https://api.themoviedb.org/3/' + path + '/' + tmdbId +
            '?api_key=' + TMDB_API_KEY;
  return fetch(url).then(function(res) { return res.json(); })
    .then(function(data) {
      var title = data.title || data.name;
      var originalTitle = data.original_title || data.original_name;
      var dateStr = data.release_date || data.first_air_date || '';
      var year = dateStr ? parseInt(dateStr.slice(0, 4)) : null;
      if (!title) throw new Error('No title from TMDB');

      var titles = [title];
      if (originalTitle && originalTitle !== title) titles.push(originalTitle);
      var media = { titles: titles, year: year };
      META_CACHE[ck] = media;
      return media;
    });
}

// ---------- h5ai listing ----------
function listDir(url) {
  return fetchWithHeaders(url).then(function(res) {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return res.text();
  }).then(function(html) {
    var items = [];
    var re = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    var m;
    var baseUrl = url.match(/^https?:\/\/[^\/]+/)[0];
    while ((m = re.exec(html)) !== null) {
      var href = m[1];
      var name = m[2].trim();
      if (href === '..' || href.indexOf('_h5ai') !== -1) continue;

      var isAbsolutePath = href.charAt(0) === '/';
      var isFullUrl = /^https?:\/\//.test(href);
      if (!isAbsolutePath && !isFullUrl) continue;

      var decodedHref = safeDecode(href);
      var isFolder = /\/$/.test(decodedHref) || /\/$/.test(name);
      var isVideo = /\.(mkv|mp4|avi|webm|m4v|mov)$/i.test(decodedHref);
      if (!isFolder && !isVideo) continue;

      var display = safeDecode(name).replace(/\/$/, '');
      var fullUrl = isFullUrl ? href : baseUrl + href;

      items.push({
        name: display,
        isFolder: isFolder,
        isVideo: isVideo,
        fullUrl: fullUrl
      });
    }
    return items;
  });
}

// ---------- matching ----------
function titleMatches(folderName, query) {
  var a = norm(folderName);
  var b = norm(query);
  if (!a || !b) return false;

  var qt = b.split(' ').filter(function(t) { return t.length > 1; });
  var ft = a.split(' ').filter(function(t) { return t.length > 1; });
  if (!qt.length || !ft.length) return false;

  if (a.indexOf(b) === 0) return true;
  if (ft[0] !== qt[0]) return false;

  var hits = 0;
  for (var j = 0; j < qt.length; j++) if (ft.indexOf(qt[j]) !== -1) hits++;
  return hits / qt.length >= 0.8;
}

function pickBest(results, title, year) {
  var targetTokens = clean(title).split(' ').filter(function(t) { return t.length > 1; });
  var best = null, bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var ym = r.name.match(/\((\d{4})\)/) || r.name.match(/\b(19\d{2}|20\d{2})\b/);
    var fileYear = ym ? parseInt(ym[1]) : null;

    var nameTokens = clean(r.name).split(' ').filter(function(t) { return t.length > 1; });
    var matched = 0;
    for (var t = 0; t < targetTokens.length; t++) {
      if (nameTokens.indexOf(targetTokens[t]) !== -1) matched++;
    }
    if (matched === 0) continue;

    var coverage = matched / targetTokens.length;
    var cn = clean(r.name);
    var ct = clean(title);
    var score = 0;

    if (cn === ct) score = 25;
    else if (coverage === 1) score = 20;
    else if (coverage >= 0.6) score = 15;
    else if (coverage >= 0.4) score = 10;
    else score = 5;

    var firstToken = targetTokens[0];
    if (firstToken) {
      var firstPos = nameTokens.indexOf(firstToken);
      if (firstPos === 0) score += 15;
      else if (firstPos === 1) score += 5;
      else if (firstPos >= 3) score -= 10;
    }

    var consecutive = 0;
    for (var k = 0; k < targetTokens.length; k++) {
      if (nameTokens.indexOf(targetTokens[k]) === k) consecutive++;
      else break;
    }
    if (consecutive === targetTokens.length) score += 10;

    if (year && fileYear) {
      var dS = Math.abs(fileYear - year);
      if (dS === 0) score += 25;
      else if (dS === 1) score += 15;
      else if (dS <= 2) score += 8;
      else if (dS <= 5) score += 3;
      else if (dS > 15) score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function titleVariants(titles) {
  var variants = [];
  titles.forEach(function(t) {
    variants.push(t);
    if (/^(The|A|An)\s+/i.test(t)) {
      variants.push(t.replace(/^(The|A|An)\s+/i, ''));
    }
  });
  var seen = {};
  return variants.filter(function(v) {
    var k = v.toLowerCase();
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function parseSeasonFolder(name) {
  var n = name.replace(/[\/\s]+$/, '').trim();
  var m = n.match(SEASON_FOLDER_RE);
  if (m) return parseInt(m[1]);
  m = n.match(/season[\s._-]*(\d{1,2})/i);
  if (m) return parseInt(m[1]);
  return null;
}

function parseEpisodeNumbers(name) {
  var n = safeDecode(name || '');
  var m;
  m = n.match(/S(\d{1,2})[\s._-]*E(?:P)?[\s._-]*(\d{1,4})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = n.match(/\b(\d{1,2})x(\d{1,4})\b/);
  if (m) return { season: +m[1], episode: +m[2] };
  m = n.match(/Season[\s._-]*(\d{1,2})[\s._-]*(?:Episode|Ep|E)[\s._-]*(\d{1,4})/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = n.match(/(?:^|[\s._\-(])(?:Episode|Ep|E)[\s._-]*(\d{1,4})(?:[\s._\-)\]]|$)/i);
  if (m) return { season: 1, episode: +m[1] };
  m = n.match(/(?:^|[\s._\-[])(\d{1,4})(?:[\s._\-\]]|$)/);
  if (m && +m[1] < 1000) return { season: 1, episode: +m[1] };
  return { season: 1, episode: 0 };
}

// ---------- movie search ----------
function buildMovieBucketUrls(year) {
  var urls = [];
  urls.push({ url: FTP2_BASE + FTP2_IMDB, label: 'IMDB' });
  var enBucket = year <= 1995 ? '1995--Before' : String(year);
  urls.push({ url: FTP2_BASE + FTP2_ROOT + enBucket + '/', label: 'EN-' + enBucket });
  var bnBucket = year <= 1999 ? '(1999)-&-Before' : '(' + year + ')';
  urls.push({ url: FTP3_BASE + FTP3_KOLKATA + bnBucket + '/', label: 'BN-' + bnBucket });
  return urls;
}

function searchMovie(titles, year) {
  if (!year) return Promise.resolve(null);
  var variants = titleVariants(titles);
  var sources = buildMovieBucketUrls(year);

  return Promise.all(sources.map(function(src) {
    return listDir(src.url).then(function(items) {
      var folders = items.filter(function(it) { return it.isFolder; });
      return folders.filter(function(f) {
        return variants.some(function(v) { return titleMatches(f.name, v); });
      });
    }).catch(function() { return []; });
  })).then(function(arrs) {
    var all = [];
    arrs.forEach(function(a) { a.forEach(function(f) { all.push(f); }); });
    console.log('[FTP] Movie candidates: ' + all.length);
    if (all.length === 0) return null;
    return pickBest(all, titles[0], year);
  });
}

function loadMovieFolder(url) {
  return listDir(url).then(function(items) {
    var videos = items.filter(function(it) { return it.isVideo; });
    if (videos.length > 0) {
      return videos.map(function(v) {
        var q = dfQuality(v.name);
        return {
          name: 'FTP',
          title: v.name.replace(/\.[a-z0-9]{2,5}$/i, '') + (q !== 'Unknown' ? ' (' + q + ')' : ''),
          url: v.fullUrl,
          quality: q,
          provider: 'ftp'
        };
      });
    }
    var folders = items.filter(function(it) { return it.isFolder; });
    if (folders.length > 0) {
      return Promise.all(folders.map(function(f) {
        return listDir(f.fullUrl).then(function(sub) {
          return sub.filter(function(it) { return it.isVideo; }).map(function(v) {
            var q = dfQuality(v.name);
            return {
              name: 'FTP',
              title: v.name.replace(/\.[a-z0-9]{2,5}$/i, '') + (q !== 'Unknown' ? ' (' + q + ')' : ''),
              url: v.fullUrl,
              quality: q,
              provider: 'ftp'
            };
          });
        }).catch(function() { return []; });
      })).then(function(arrs) {
        var all = [];
        arrs.forEach(function(a) { a.forEach(function(s) { all.push(s); }); });
        return all;
      });
    }
    return [];
  }).catch(function(e) {
    console.log('[FTP] Movie load failed: ' + e.message);
    return [];
  });
}

// ---------- series search ----------
var SERIES_ROOTS = [
  { url: FTP5_BASE + FTP5_ROOT, label: 'Anime' },
  { url: FTP3_BASE + FTP3_WEBSERIES, label: 'Bangla-Web' }
];

function searchSeries(titles, year) {
  var variants = titleVariants(titles);
  return Promise.all(SERIES_ROOTS.map(function(root) {
    return listDir(root.url).then(function(items) {
      var folders = items.filter(function(it) { return it.isFolder; });
      return folders.filter(function(f) {
        return variants.some(function(v) { return titleMatches(f.name, v); });
      });
    }).catch(function() { return []; });
  })).then(function(arrs) {
    var all = [];
    arrs.forEach(function(a) { a.forEach(function(f) { all.push(f); }); });
    console.log('[FTP] Series candidates: ' + all.length);
    if (all.length === 0) return null;
    return pickBest(all, titles[0], year);
  });
}

function extractSeason(url, seasonNum) {
  return listDir(url).then(function(items) {
    var eps = [], counter = 0;
    items.forEach(function(it) {
      if (!it.isVideo) return;
      counter++;
      var se = parseEpisodeNumbers(it.name);
      eps.push({
        name: it.name,
        season: seasonNum,
        episode: se.episode || counter,
        url: it.fullUrl
      });
    });
    return eps;
  }).catch(function() { return []; });
}

function loadSeries(url, season, episode) {
  return listDir(url).then(function(items) {
    var videos = [], seasonFolders = [], otherFolders = [];
    items.forEach(function(it) {
      if (it.isFolder) {
        var sNum = parseSeasonFolder(it.name);
        if (sNum !== null) seasonFolders.push({ url: it.fullUrl, season: sNum });
        else otherFolders.push({ url: it.fullUrl, name: it.name });
      } else if (it.isVideo) {
        videos.push({ name: it.name, url: it.fullUrl });
      }
    });
    console.log('[FTP] Series: v=' + videos.length +
                ' sf=' + seasonFolders.length + ' of=' + otherFolders.length);

    if (seasonFolders.length > 0) {
      var target = season
        ? seasonFolders.filter(function(sf) { return sf.season === season; })
        : seasonFolders;
      if (target.length === 0) target = seasonFolders;
      return Promise.all(target.map(function(sf) {
        return extractSeason(sf.url, sf.season);
      })).then(function(arrs) {
        var eps = [];
        arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
        return finalizeSeries(eps, season, episode);
      });
    }

    if (videos.length > 0) {
      var eps = [], counter = 0;
      videos.forEach(function(v) {
        counter++;
        var se = parseEpisodeNumbers(v.name);
        eps.push({
          name: v.name,
          season: se.season || 1,
          episode: se.episode || counter,
          url: v.url
        });
      });
      return finalizeSeries(eps, season, episode);
    }

    if (otherFolders.length > 0) {
      return Promise.all(otherFolders.map(function(fu) {
        return listDir(fu.url).then(function(sub) {
          var nested = [], nestedVideos = [];
          sub.forEach(function(it) {
            if (it.isFolder) {
              var sNum = parseSeasonFolder(it.name);
              if (sNum !== null) nested.push({ url: it.fullUrl, season: sNum });
            } else if (it.isVideo) {
              nestedVideos.push(it);
            }
          });
          if (nested.length > 0) {
            var target = season
              ? nested.filter(function(sf) { return sf.season === season; })
              : nested;
            if (target.length === 0) target = nested;
            return Promise.all(target.map(function(sf) {
              return extractSeason(sf.url, sf.season);
            })).then(function(arrs) {
              var eps = [];
              arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
              return eps;
            });
          }
          var eps = [], counter = 0;
          nestedVideos.forEach(function(v) {
            counter++;
            var se = parseEpisodeNumbers(v.name);
            eps.push({
              name: v.name,
              season: se.season || 1,
              episode: se.episode || counter,
              url: v.fullUrl
            });
          });
          return eps;
        }).catch(function() { return []; });
      })).then(function(arrs) {
        var eps = [];
        arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
        return finalizeSeries(eps, season, episode);
      });
    }

    return [];
  }).catch(function(e) {
    console.log('[FTP] Series load failed: ' + e.message);
    return [];
  });
}

function finalizeSeries(eps, season, episode) {
  if (season && episode) {
    var filtered = eps.filter(function(e) {
      return e.season === season && e.episode === episode;
    });
    if (filtered.length > 0) eps = filtered;
  }
  return eps.map(function(e) {
    var prefix = 'S' + pad2(e.season) + 'E' + pad2(e.episode);
    var q = dfQuality(e.name || '');
    var pretty = (e.name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    return {
      name: 'FTP',
      title: '[' + prefix + '] ' + pretty + (q !== 'Unknown' ? ' (' + q + ')' : ''),
      url: e.url,
      quality: q,
      provider: 'ftp'
    };
  });
}

// ---------- Entry ----------
function getStreams(tmdbId, mediaType, season, episode) {
  var wantType = (mediaType === 'tv' || mediaType === 'series') ? 'series' : 'movie';
  var key = tmdbId + ':' + wantType + ':' + (season || 0) + ':' + (episode || 0);
  if (CACHE[key]) return Promise.resolve(CACHE[key]);
  if (INFLIGHT[key]) return INFLIGHT[key];

  var p = fetchTmdb(tmdbId, wantType)
    .then(function(media) {
      console.log('[FTP] "' + media.titles[0] + '" (' + media.year + ')');
      if (wantType === 'movie') {
        return searchMovie(media.titles, media.year).then(function(folder) {
          if (!folder) return [];
          return loadMovieFolder(folder.fullUrl);
        });
      }
      return searchSeries(media.titles, media.year).then(function(folder) {
        if (!folder) return [];
        return loadSeries(folder.fullUrl, season, episode);
      });
    })
    .then(function(streams) {
      CACHE[key] = streams;
      delete INFLIGHT[key];
      console.log('[FTP] DONE ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[FTP] ERROR: ' + err.message);
      delete INFLIGHT[key];
      return [];
    });

  INFLIGHT[key] = p;
  return p;
}

module.exports = { getStreams: getStreams };