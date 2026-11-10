var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

var FTP_BASE = 'https://server5.ftpbd.net';
var FTP_ROOT = '/FTP-5/Anime--Cartoon-TV-Series/';

var CACHE = {};
var INFLIGHT = {};
var META_CACHE = {};

var USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                 '(KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36';

var SEASON_FOLDER_RE = /^(?:s|season|series)[\s._-]*(\d{1,2})$/i;

var NOISE_TOKENS = [
  'hindi', 'dubbed', 'dub', 'dual', 'audio', 'english', 'eng', 'sub', 'subs',
  'subtitles', 'multi', 'reencoded', 'reencode', 'x264', 'x265', 'h264', 'h265',
  'hevc', 'avc', 'aac', 'ac3', 'dts', 'ddp', 'webdl', 'web', 'dl', 'bluray',
  'brrip', 'hdtv', 'hdrip', 'webrip', 'proper', 'repack', 'extended',
  'uncut', 'remastered', '10bit', '8bit', 'hq', 'sd', 'hd'
];

// ---------- Helpers ----------
function safeDecode(s) {
  try { return decodeURIComponent(s); }
  catch (e) { return s; }
}

function fetchWithHeaders(url, options) {
  options = options || {};
  var headers = options.headers || {};
  headers['User-Agent'] = USER_AGENT;
  headers['Accept'] = 'text/html,application/xhtml+xml,*/*';
  headers['Accept-Language'] = 'en-GB,en;q=0.6';
  options.headers = headers;
  return fetch(url, options);
}

function clean(s) {
  return s.toLowerCase()
    .replace(/[-_\.]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function dfQuality(name) {
  var m = name.match(/\b(720p|1080p|2160p|4K|480p|360p)\b/i);
  return m ? 'DF ' + m[1].toUpperCase() : 'Unknown';
}

function cleanEpisodeTitle(name) {
  var base = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  base = base.replace(/[_\.]/g, ' ');
  base = base.replace(/\b(720p|1080p|2160p|4k|480p|360p)\b/gi, '');
  var words = base.split(/\s+/).filter(function(w) {
    if (!w) return false;
    var lw = w.toLowerCase();
    if (NOISE_TOKENS.indexOf(lw) !== -1) return false;
    if (/^\d{3,4}p$/.test(lw)) return false;
    if (/^[\[\(\{].*[\]\)\}]$/.test(w)) return false;
    return true;
  });
  return words.join(' ').replace(/\s+/g, ' ').trim();
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
      console.log('[FTP-5] Search "' + media.title + '" (' + media.year + ')');
      return searchFTP(media.title, media.year);
    })
    .then(function(folder) {
      if (!folder) return [];
      return loadFtpSeries(folder.fullUrl, season, episode);
    })
    .then(function(streams) {
      CACHE[key] = streams;
      delete INFLIGHT[key];
      console.log('[FTP-5] DONE ' + streams.length + ' streams');
      return streams;
    })
    .catch(function(err) {
      console.error('[FTP-5] ERROR: ' + err.message);
      delete INFLIGHT[key];
      return [];
    });

  INFLIGHT[key] = p;
  return p;
}

// ---------- Metadata ----------
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

// ---------- h5ai list ----------
function listApacheDir(url) {
  return fetchWithHeaders(url)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return res.text();
    })
    .then(function(html) {
      var items = [];
      var re = /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      var m;
      while ((m = re.exec(html)) !== null) {
        var href = m[1];
        var name = m[2].trim();
        if (href === '..' || href.indexOf('_h5ai') !== -1) continue;

        var isAbsolutePath = href.charAt(0) === '/';
        var isFullUrl = /^https?:\/\//.test(href);
        var isRelativePath = !isFullUrl && !isAbsolutePath;
        if (!isAbsolutePath && !isRelativePath && !isFullUrl) continue;

        var decodedHref = safeDecode(href);
        var isFolder = /\/$/.test(decodedHref) || /\/$/.test(name);
        var isVideo = /\.(mkv|mp4|avi|webm|m4v|mov)$/i.test(decodedHref);
        if (!isFolder && !isVideo) continue;

        var display = safeDecode(name).replace(/\/$/, '');
        var fullUrl;
        if (isFullUrl) {
          fullUrl = href;
        } else if (isAbsolutePath) {
          fullUrl = FTP_BASE + href;
        } else {
          fullUrl = url.replace(/\/+$/, '') + '/' + href;
        }

        items.push({
          name: display,
          href: href,
          isFolder: isFolder,
          isVideo: isVideo,
          fullUrl: fullUrl
        });
      }
      return items;
    });
}

// ---------- Title matching ----------
function titleMatches(folderName, query) {
  function norm(s) {
    return s.toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/[-_\.:]/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  var a = norm(folderName);
  var b = norm(query);
  if (!a || !b) return false;

  var qt = b.split(' ').filter(function(t) { return t.length > 1; });
  var ft = a.split(' ').filter(function(t) { return t.length > 1; });
  if (!qt.length || !ft.length) return false;

  if (a.indexOf(b) === 0) return true;

  if (ft[0] !== qt[0]) {
    if (a.indexOf(b) === 0) return true;
    return false;
  }

  var hits = 0;
  for (var j = 0; j < qt.length; j++) if (ft.indexOf(qt[j]) !== -1) hits++;
  return hits / qt.length >= 0.8;
}

function pickBest(results, targetTitle, targetYear) {
  var targetTokens = clean(targetTitle).split(' ').filter(function(t) {
    return t.length > 1;
  });
  var best = null, bestScore = 0;

  for (var i = 0; i < results.length; i++) {
    var r = results[i];

    var ym = r.name.match(/\((\d{4})\)/) || r.name.match(/\b(19\d{2}|20\d{2})\b/);
    var fileYear = ym ? parseInt(ym[1]) : null;

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

    var firstToken = targetTokens[0];
    if (firstToken) {
      var firstPos = nameTokens.indexOf(firstToken);
      if (firstPos === 0) score += 15;
      else if (firstPos === 1) score += 5;
      else if (firstPos >= 3) score -= 10;
    }

    var consecutive = 0;
    for (var k = 0; k < targetTokens.length; k++) {
      var pos = nameTokens.indexOf(targetTokens[k]);
      if (pos === k) consecutive++;
      else break;
    }
    if (consecutive === targetTokens.length) score += 10;

    if (targetYear && fileYear) {
      var dS = Math.abs(fileYear - targetYear);
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

  if (best) {
    console.log('[FTP-5] Best "' + best.name + '" score=' + bestScore +
                ' tokens=[' + targetTokens.join(',') + '] year=' + targetYear);
  } else {
    console.log('[FTP-5] NO MATCH tokens=[' + targetTokens.join(',') +
                '] year=' + targetYear);
  }
  return best;
}

// ---------- Search root ----------
function searchFTP(title, year) {
  var rootUrl = FTP_BASE + FTP_ROOT;
  console.log('[FTP-5] Listing root...');
  return listApacheDir(rootUrl).then(function(items) {
    console.log('[FTP-5] Root items: ' + items.length);
    var folders = items.filter(function(it) { return it.isFolder; });
    var matched = folders.filter(function(f) { return titleMatches(f.name, title); });
    console.log('[FTP-5] Matched: ' + matched.length);
    return pickBest(matched, title, year);
  });
}

// ---------- Season / episode parsing ----------
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

// ---------- Loader ----------
function loadFtpSeries(url, season, episode) {
  console.log('[FTP-5] SERIES GET ' + url);
  return listApacheDir(url).then(function(items) {
    var videoFiles = [], seasonFolders = [], otherFolders = [];
    items.forEach(function(it) {
      if (it.isFolder) {
        var sNum = parseSeasonFolder(it.name);
        if (sNum !== null) seasonFolders.push({ url: it.fullUrl, season: sNum });
        else otherFolders.push({ url: it.fullUrl, name: it.name });
      } else if (it.isVideo) {
        videoFiles.push({ name: it.name, url: it.fullUrl });
      }
    });
    console.log('[FTP-5] v=' + videoFiles.length +
                ' sf=' + seasonFolders.length + ' of=' + otherFolders.length);

    if (seasonFolders.length > 0) {
      var target = season
        ? seasonFolders.filter(function(sf) { return sf.season === season; })
        : seasonFolders;
      if (target.length === 0) target = seasonFolders;
      return Promise.all(target.map(function(sf) {
        return extractFtpSeason(sf.url, sf.season);
      })).then(function(arrs) {
        var eps = [];
        arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
        return finalizeEpisodes(eps, season, episode);
      });
    }

    if (videoFiles.length > 0) {
      var eps = [], counter = 0;
      videoFiles.forEach(function(v) {
        counter++;
        var se = parseEpisodeNumbers(v.name);
        eps.push({
          name: v.name,
          season: se.season || 1,
          episode: se.episode || counter,
          url: v.url
        });
      });
      return finalizeEpisodes(eps, season, episode);
    }

    if (otherFolders.length > 0) {
      return Promise.all(otherFolders.map(function(fu) {
        return listApacheDir(fu.url).then(function(sub) {
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
              return extractFtpSeason(sf.url, sf.season);
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
        return finalizeEpisodes(eps, season, episode);
      });
    }

    return [];
  }).catch(function(err) {
    console.log('[FTP-5] load failed: ' + err.message);
    return [];
  });
}

function extractFtpSeason(seasonUrl, seasonNum) {
  console.log('[FTP-5] S' + seasonNum + ' GET ' + seasonUrl);
  return listApacheDir(seasonUrl).then(function(items) {
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
    console.log('[FTP-5] S' + seasonNum + ' → ' + eps.length);
    return eps;
  }).catch(function() { return []; });
}

function finalizeEpisodes(eps, season, episode) {
  if (season && episode) {
    var filtered = eps.filter(function(e) {
      return e.season === season && e.episode === episode;
    });
    if (filtered.length > 0) eps = filtered;
  }
  return eps.map(function(e) {
    var prefix = 'S' + pad2(e.season) + 'E' + pad2(e.episode);
    var pretty = cleanEpisodeTitle(e.name || '');
    var q = dfQuality(e.name || '');
    return {
      name: 'FTP-5',
      title: '[' + prefix + '] ' + pretty + (q !== 'Unknown' ? ' (' + q + ')' : ''),
      url: e.url,
      quality: q,
      provider: 'ftp5'
    };
  });
}

module.exports = { getStreams: getStreams };