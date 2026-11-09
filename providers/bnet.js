var TMDB_API_KEY = '68e094699525b18a70bab2f86b1fa706';
var OMDB_API_KEY = '81693a7c';

var PROVIDERS = {
  dhakaflix14: {
    mainUrl: 'http://172.16.50.14',
    serverName: 'DHAKA-FLIX-14',
    name: 'DhakaFlix 14',
    kind: 'filebrowser',
    tvSeriesKeyword: ['KOREAN%20TV%20%26%20WEB%20Series'],
    supportedTypes: ['movie', 'series'],
    movieRoots: [
      'English Movies (1080p)/', 'English Movies/', 'Hindi Movies/',
      'Animation Movies (1080p)/', 'IMDb Top-250 Movies/', 'SOUTH INDIAN MOVIES/'
    ],
    seriesRoots: ['KOREAN TV %26 WEB Series/']
  },
  dhakaflix12: {
    mainUrl: 'https://server5.ftpbd.net',
    serverName: 'FTP-5',
    name: 'FTP-5',
    kind: 'ftp-html',
    tvSeriesKeyword: ['TV-WEB-Series'],
    supportedTypes: ['series'],
    movieRoots: [],
    seriesRoots: ['FTP-5/Anime--Cartoon-TV-Series/']
  },
  dhakaflix7: {
    mainUrl: 'http://172.16.50.7',
    serverName: 'DHAKA-FLIX-7',
    name: 'DhakaFlix 7',
    kind: 'filebrowser',
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

var SEASON_FOLDER_RE = /^(?:s|season|series)[\s._-]*(\d{1,2})$/i;

var NOISE_TOKENS = [
  'hindi', 'dubbed', 'dub', 'dual', 'audio', 'english', 'eng', 'sub', 'subs',
  'subtitles', 'multi', 'reencoded', 'reencode', 'x264', 'x265', 'h264', 'h265',
  'hevc', 'avc', 'aac', 'ac3', 'dts', 'ddp', 'webdl', 'web', 'dl', 'bluray',
  'brrip', 'hdtv', 'hdrip', 'webrip', 'proper', 'repack', 'extended',
  'uncut', 'remastered', '10bit', '8bit', 'hdrip', 'hq', 'sd', 'hd'
];

function fetchWithHeaders(url, options) {
  options = options || {};
  var hostMatch = url.match(/^https?:\/\/([^\/]+)/);
  var host = hostMatch ? hostMatch[1] : '';
  var headers = options.headers || {};
  headers['User-Agent'] = USER_AGENT;
  headers['Accept'] = '*/*';
  headers['Accept-Language'] = 'en-GB,en;q=0.6';
  // Only set Origin/Referer for FileBrowser — Apache autoindex doesn't need them
  if (url.indexOf('http://') === 0 || /^https?:\/\/(?!server5\.ftpbd)/.test(url)) {
    headers['Origin'] = 'http://' + host;
    headers['Referer'] = url;
  }
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

// ---------- Dispatcher ----------
function searchAllProviders(query, wantType, year) {
  var queries = buildSearchQueries(query, year);
  var ids = Object.keys(PROVIDERS).filter(function(id) {
    return PROVIDERS[id].supportedTypes.indexOf(wantType) !== -1;
  });
  console.log('[DhakaFlix] Queries: ' + JSON.stringify(queries) +
              ' providers: ' + ids.join(','));

  var promises = ids.map(function(id) {
    var provider = PROVIDERS[id];

    var runner;
    if (provider.kind === 'ftp-html') {
      runner = searchProviderFTP(queries, provider, id, wantType);
    } else {
      runner = searchProviderParallel(queries, provider, id, wantType)
        .then(function(results) {
          // Series: alphabet bucket fallback when search returns 0
          if (wantType === 'series' && results.length === 0 &&
              provider.seriesRoots && provider.seriesRoots.length > 0 &&
              provider.kind !== 'ftp-html') {
            console.log('[DhakaFlix] ' + id + ' empty, alphabet bucket fallback');
            return searchSeriesAlphabetBuckets(query, provider, id);
          }
          return results;
        });
    }

    return runner
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

// ══════════════════════════════════════════════════════════
//  FILEBROWSER path (DhakaFlix — JSON API)
// ══════════════════════════════════════════════════════════

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

      var decoded = decodeURIComponent(href);
      var isSeries = containsAny(href, provider.tvSeriesKeyword) ||
                     /\(TV\s+(Mini\s+)?Series\b/i.test(decoded) ||
                     /\bTV-WEB-Series\b/i.test(decoded) ||
                     parseSeasonFolder(nameFromUrl(href)) !== null;

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

function searchSeriesAlphabetBuckets(title, provider, providerId) {
  if (!provider.seriesRoots || provider.seriesRoots.length === 0) {
    return Promise.resolve([]);
  }
  // If only one root is configured, always use it.
  var bucket = provider.seriesRoots[0];
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

// ══════════════════════════════════════════════════════════
//  FTP-HTML path (server5.ftpbd.net — Apache autoindex)
// ══════════════════════════════════════════════════════════

function searchProviderFTP(queries, provider, providerId, wantType) {
  var rootPath = provider.seriesRoots[0];
  var rootUrl = joinUrl(provider.mainUrl, rootPath);
  console.log('[DhakaFlix] FTP root → ' + rootUrl);

  return listApacheDir(rootUrl, provider).then(function(items) {
    console.log('[DhakaFlix] FTP root items: ' + items.length);
    var results = [], seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.isFolder) continue;
      for (var q = 0; q < queries.length; q++) {
        if (titleMatches(it.name, queries[q])) {
          if (seen[it.fullUrl]) break;
          seen[it.fullUrl] = true;
          results.push({
            name: it.name,
            type: 'series',
            url: it.fullUrl,
            providerId: providerId,
            isFile: false,
            absolute: true
          });
          break;
        }
      }
    }
    console.log('[DhakaFlix] FTP matched folders: ' + results.length);
    return results;
  });
}

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

  // Direct substring (most reliable for "Naruto-Shippuden-2007-2017" vs "Naruto: Shippuden")
  if (a.indexOf(b) !== -1) return true;

  // Prefix token match
  var qTokens = b.split(' ').filter(function(t) { return t.length > 1; });
  var fTokens = a.split(' ').filter(function(t) { return t.length > 1; });
  if (qTokens.length === 0 || fTokens.length === 0) return false;

  var prefix = true;
  for (var i = 0; i < qTokens.length; i++) {
    if (fTokens[i] !== qTokens[i]) { prefix = false; break; }
  }
  if (prefix) return true;

  // 60% token coverage fallback
  var hits = 0;
  for (var j = 0; j < qTokens.length; j++) {
    if (fTokens.indexOf(qTokens[j]) !== -1) hits++;
  }
  return hits / qTokens.length >= 0.6;
}

function listApacheDir(url, provider) {
  return fetchWithHeaders(url)
    .then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      return res.text();
    })
    .then(function(html) {
      console.log('[DhakaFlix] h5ai HTML length:', html.length);
      var items = [];
      // h5ai v0.30 rows:
      // <tr><td class="fb-i"><img ... alt="folder|file|folder-parent"/></td>
      //     <td class="fb-n"><a href="/FTP-5/...">Name</a></td>...
      var rowRe = /<td class="fb-i">\s*<img[^>]+alt="([^"]+)"[^>]*\/>\s*<\/td>\s*<td class="fb-n">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      var m;
      while ((m = rowRe.exec(html)) !== null) {
        var alt = m[1].toLowerCase();
        var href = m[2];
        var rawName = m[3].replace(/<[^>]+>/g, '').trim();

        if (alt === 'folder-parent') continue;
        if (!href || href === '..' || href === './') continue;

        var isFolder = alt === 'folder';
        var isFile = alt === 'file';
        if (!isFolder && !isFile) continue;

        var decodedHref = decodeURIComponent(href);
        var isVideo = isFile && /\.(mkv|mp4|avi|webm|m4v|mov)$/i.test(decodedHref);
        var name = decodeURIComponent(rawName).replace(/\/$/, '');

        items.push({
          name: name,
          href: href,
          isFolder: isFolder,
          isVideo: isVideo,
          fullUrl: /^https?:\/\//.test(href)
            ? href
            : (url.replace(/\/+$/, '') + '/' + href.replace(/^\/+/, ''))
        });
      }
      var lastSeg = url.split('/').filter(Boolean).pop() || '';
      console.log('[DhakaFlix] h5ai items in ' + decodeURIComponent(lastSeg) + ': ' + items.length);
      return items;
    });
}

function loadFtpSeries(url, provider, season, episode, label) {
  console.log('[DhakaFlix] FTP SERIES GET ' + url);
  return listApacheDir(url, provider).then(function(items) {
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
    console.log('[DhakaFlix] FTP v=' + videoFiles.length +
                ' sf=' + seasonFolders.length + ' of=' + otherFolders.length);

    // ── Path 1: direct season folders ──
    if (seasonFolders.length > 0) {
      return Promise.all(seasonFolders.map(function(sf) {
        return extractFtpSeason(sf.url, provider, sf.season);
      })).then(function(arrs) {
        var eps = [];
        arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
        return finalizeEpisodes(eps, season, episode, label);
      });
    }

    // ── Path 2: flat video files at root ──
    if (videoFiles.length > 0) {
      var eps2 = [], counter = 0;
      videoFiles.forEach(function(v) {
        counter++;
        var se = parseEpisodeNumbers(v.name);
        eps2.push({
          name: v.name,
          season: se.season || 1,
          episode: se.episode || counter,
          url: v.url
        });
      });
      return finalizeEpisodes(eps2, season, episode, label);
    }

    // ── Path 3: descend into non-season folders (one level) ──
    if (otherFolders.length > 0) {
      return Promise.all(otherFolders.map(function(fu) {
        return listApacheDir(fu.url, provider).then(function(sub) {
          var nestedSeasons = [], nestedFiles = [];
          sub.forEach(function(it) {
            if (it.isFolder) {
              var sNum = parseSeasonFolder(it.name);
              if (sNum !== null) nestedSeasons.push({ url: it.fullUrl, season: sNum });
            } else if (it.isVideo) {
              nestedFiles.push(it);
            }
          });
          if (nestedSeasons.length > 0) {
            return Promise.all(nestedSeasons.map(function(sf) {
              return extractFtpSeason(sf.url, provider, sf.season);
            })).then(function(arrs) {
              var eps = [];
              arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
              return eps;
            });
          }
          var eps = [], counter = 0;
          nestedFiles.forEach(function(it) {
            counter++;
            var se = parseEpisodeNumbers(it.name);
            eps.push({
              name: it.name,
              season: se.season || 1,
              episode: se.episode || counter,
              url: it.fullUrl
            });
          });
          return eps;
        }).catch(function() { return []; });
      })).then(function(arrs) {
        var eps = [];
        arrs.forEach(function(a) { a.forEach(function(e) { eps.push(e); }); });
        return finalizeEpisodes(eps, season, episode, label);
      });
    }

    return [];
  }).catch(function(err) {
    console.log('[DhakaFlix] FTP load failed: ' + err.message);
    return [];
  });
}

function extractFtpSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] FTP S' + seasonNum + ' GET ' + seasonUrl);
  return listApacheDir(seasonUrl, provider).then(function(items) {
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
    console.log('[DhakaFlix] FTP S' + seasonNum + ' → ' + eps.length);
    return eps;
  }).catch(function() { return []; });
}

// ══════════════════════════════════════════════════════════
//  pickBest — token matching + year hard filter
// ══════════════════════════════════════════════════════════
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

    if (wantType === 'movie' && targetYear && fileYear) {
      var d = Math.abs(fileYear - targetYear);
      if (d === 0) score += 10;
      else if (d === 1) score += 3;
    }

    if (wantType === 'series' && targetYear && fileYear) {
      var dS = Math.abs(fileYear - targetYear);
      if (dS <= 2) score += 8;
      else if (dS <= 5) score += 3;
      else if (dS > 15) score -= 5;
    }

    if (r.isFile) score += 3;

    if (/\b(dubbed|dub|hindi|tamil|telugu|dual[\s.-]?audio)\b/i.test(r.name)) {
      score -= 2;
    }

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
      var q = dfQuality(match.name);
      var u = match.absolute ? match.url : constructUrl(provider.mainUrl, match.url);
      return Promise.resolve([{
        name: label,
        title: match.name + (q !== 'Unknown' ? ' (' + q + ')' : ''),
        url: u,
        quality: q, provider: 'dhakaflix'
      }]);
    }

    // Folder path
    if (wantType === 'series') {
      if (provider.kind === 'ftp-html') {
        var seriesUrl = match.absolute ? match.url : constructUrl(provider.mainUrl, match.url);
        return loadFtpSeries(seriesUrl, provider, season, episode, label);
      }
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

// ---------- Movie loader (FileBrowser) ----------
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
          var q = dfQuality(f.name);
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

// ---------- Series loader (FileBrowser) ----------
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

        if (isFolder && link) {
          var sNum = parseSeasonFolder(name);
          if (sNum !== null) {
            seasonFolders.push({
              url: constructUrl(provider.mainUrl, link),
              season: sNum
            });
          } else {
            otherFolders.push(constructUrl(provider.mainUrl, link));
          }
        } else if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          videoFiles.push({
            name: name, url: constructUrl(provider.mainUrl, link)
          });
        }
      });

      console.log('[DhakaFlix] SERIES v=' + videoFiles.length +
                  ' sf=' + seasonFolders.length + ' of=' + otherFolders.length);

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

      if (videoFiles.length > 0) {
        var eps2 = [], counter = 0;
        videoFiles.forEach(function(v) {
          counter++;
          var se = parseEpisodeNumbers(v.name);
          eps2.push({
            name: v.name,
            season: se.season || 1,
            episode: se.episode || counter,
            url: v.url
          });
        });
        return finalizeEpisodes(eps2, season, episode, label);
      }

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
  if (season && episode) {
    var filtered = eps.filter(function(e) {
      return e.season === season && e.episode === episode;
    });
    if (filtered.length > 0) eps = filtered;
  }
  return eps.map(function(e) {
    var prefix = 'S' + pad2(e.season) + 'E' + pad2(e.episode);
    var prettyName = cleanEpisodeTitle(e.name || '');
    var q = dfQuality(e.name || '');
    return {
      name: label,
      title: '[' + prefix + '] ' + prettyName +
             (q !== 'Unknown' ? ' (' + q + ')' : ''),
      url: e.url, quality: q, provider: 'dhakaflix'
    };
  });
}

// ---------- Season folder extractor (FileBrowser) ----------
function extractSeason(seasonUrl, provider, seasonNum) {
  console.log('[DhakaFlix] S' + seasonNum + ' GET ' + seasonUrl);
  return fetchWithHeaders(seasonUrl)
    .then(function(res) { return res.text(); })
    .then(function(html) {
      var $ = load(html);
      var episodes = [], counter = 0;
      $('tbody > tr:gt(1)').each(function(_, row) {
        var $a = $(row).find('td.fb-n > a');
        var link = $a.attr('href');
        if (link && /\.(mkv|mp4|avi|webm)$/i.test(link)) {
          counter++;
          var se = parseEpisodeNumbers($a.text());
          episodes.push({
            name: $a.text(),
            season: seasonNum,
            episode: se.episode || counter,
            url: constructUrl(provider.mainUrl, link)
          });
        }
      });
      console.log('[DhakaFlix] S' + seasonNum + ' → ' + episodes.length);
      return episodes;
    })
    .catch(function() { return []; });
}

// ---------- Universal season folder detector ----------
function parseSeasonFolder(name) {
  var n = name.replace(/[\/\s]+$/, '').trim();
  var m = n.match(SEASON_FOLDER_RE);
  if (m) return parseInt(m[1]);
  m = n.match(/season[\s._-]*(\d{1,2})/i);
  if (m) return parseInt(m[1]);
  return null;
}

// ---------- Robust episode number parser ----------
function parseEpisodeNumbers(name) {
  var n = decodeURIComponent(name || '');
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

// ---------- Strip language/codec noise from filename ----------
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
  if (/^https?:\/\//.test(path)) return path;
  var cleanPath = path.replace(/([^:]\/)\/+/g, '$1');
  return base.replace(/\/$/, '') + '/' + cleanPath.replace(/^\//, '');
}

function joinUrl(base, rel) {
  if (/^https?:\/\//.test(rel)) return rel;
  base = base.replace(/\/+$/, '');
  rel = rel.replace(/^\/+/, '');
  return base + '/' + rel;
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
  var m = name.match(/\b(720p|1080p|2160p|4K|480p|360p)\b/i);
  return m ? m[1].toUpperCase() : 'Unknown';
}

function dfQuality(name) {
  var m = name.match(/\b(720p|1080p|2160p|4K|480p|360p)\b/i);
  return m ? 'DF ' + m[1].toUpperCase() : 'Unknown';
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

module.exports = { getStreams: getStreams };