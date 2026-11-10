/**
 * movielinkbd — Nuvio plugin (QuickJS-safe, optimized)
 *
 * getStreams(tmdbId, mediaType, season, episode) → stream array
 */

// ================= constants =================
const HUB_URL      = 'https://movielinkbd.com';
const FALLBACK_URL = 'https://sefcng.movielinkbd.li';
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const TMDB_BASE    = 'https://api.themoviedb.org/3';

// ⚡ FIX 6: raise threshold, don't pad with weak candidates
const MIN_SCORE_TO_TRY    = 400;
// ⚡ FIX 5: fewer attempts (4th-6th rarely succeed)
const MAX_ATTEMPTS        = 3;
// ⚡ FIX 1: how many to race in parallel when first fails
const PARALLEL_FALLBACK   = 3;
const FETCH_TIMEOUT_MS    = 15000;

const BASE_HEADERS = {
  'sec-ch-ua':          '"Brave";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
  'sec-ch-ua-mobile':   '?1',
  'sec-ch-ua-platform': '"Android"',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent':         'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Sec-GPC':            '1',
  'Sec-Fetch-Site':     'same-origin',
  'Sec-Fetch-Mode':     'navigate',
  'Sec-Fetch-User':     '?1',
  'Sec-Fetch-Dest':     'document',
  'Accept-Language':    'en-GB,en-US;q=0.9,en;q=0.8',
};

// ================= state =================
// ⚡ FIX 2: hardcoded base — skip hub resolution
let resolvedBase = FALLBACK_URL;
let hpToken      = null;
const mgCache    = {};

// ================= utils =================
const log = (...a) => console.error('[mlbd]', ...a);
const trimOrNull = s => { if (s == null) return null; const t = String(s).trim(); return t || null; };
const urlEncode  = s => encodeURIComponent(s);
const CDN_STREAM_RE = /^(https?:\/\/([a-z0-9.-]+)\/p\/[A-Za-z0-9._%-]+)(\?.*)?$/i;
const ASIAN_LANGS = new Set(['ko','ja','zh','cn','th','tl','id','ms','hi','ta','te','bn','ml','kn','mr','pa','ur','vi']);
const ASIAN_COUNTRIES = new Set(['KR','JP','CN','TW','HK','TH','PH','ID','MY','IN','BD','PK','VN']);
const STOPWORDS = new Set(['the','a','an','of','and','or','in','on','at','to','for']);

// --- pure-JS base64 decoder ---
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(str) {
  const clean = String(str).replace(/[^A-Za-z0-9+/=]/g, '');
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '=') break;
    const v = B64_CHARS.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function bytesToUtf8(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const off = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (off >> 10), 0xdc00 + (off & 0x3ff));
    }
  }
  return out;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;
  if (controller) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    opts.signal = controller.signal;
  }
  try {
    const res = await fetch(url, opts);
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim();
}

function attrOf(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m ? (m[1] || m[2] || m[3]) : null;
}

function findByClass(html, tagName, className) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*class\\s*=\\s*"[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'gi');
  const tagRe  = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = openRe.exec(html)) !== null) {
    const openTag = m[0], bodyStart = m.index + openTag.length;
    let depth = 1, close = null, t;
    tagRe.lastIndex = bodyStart;
    while ((t = tagRe.exec(html)) !== null) {
      if (t[0].startsWith('</')) depth--;
      else if (!t[0].endsWith('/>')) depth++;
      if (depth === 0) { close = t; break; }
    }
    if (!close) continue;
    out.push({ open: openTag, inner: html.slice(bodyStart, close.index) });
    openRe.lastIndex = close.index + close[0].length;
  }
  return out;
}

function findAnchorByClass(inner, className) {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(inner)) !== null) {
    if (new RegExp(`\\bclass\\s*=\\s*"[^"]*\\b${className}\\b`, 'i').test(m[1])) {
      return { attrs: m[1], inner: m[2] };
    }
  }
  return null;
}

function absoluteUrl(base, raw) {
  if (!raw) return null;
  try { return new URL(raw, base).toString(); } catch { return null; }
}

function tokenize(title) {
  return title
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t) && !/^s\d+$/i.test(t) && !/^ep\d*/i.test(t));
}

function titleOverlap(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  let common = 0;
  ta.forEach(t => { if (tb.has(t)) common++; });
  return { common, ta: ta.size, tb: tb.size };
}

function yearOf(item) {
  return Number((item.release_date || item.first_air_date || '').slice(0, 4)) || 0;
}
function titleOf(item) {
  return item.title || item.name || item.original_title || item.original_name || '';
}
function isAsian(item) {
  if (ASIAN_LANGS.has(item.original_language)) return true;
  const countries = item.origin_country || [];
  for (let i = 0; i < countries.length; i++) {
    if (ASIAN_COUNTRIES.has(countries[i])) return true;
  }
  return false;
}
function qualityName(q) {
  if (q >= 2160) return '4K';
  if (q > 0)     return `${q}p`;
  return 'Stream';
}

// ================= TMDB =================
async function tmdbDetailById(tmdbId, mediaType) {
  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const res = await fetchWithTimeout(url, { headers: { 'Accept': 'application/json' } }, 12000);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = await res.json();
  return {
    ...data,
    media_type: mediaType,
    imdb_id: data.external_ids && data.external_ids.imdb_id,
    _title:  titleOf(data),
    _year:   yearOf(data),
  };
}

// ================= HTTP =================
async function httpGet(url, extraHeaders = {}) {
  const headers = { ...BASE_HEADERS, ...extraHeaders };
  if (hpToken) headers['Cookie'] = 'mlbd_hp=' + hpToken;

  log('GET', url);
  let res;
  try {
    res = await fetchWithTimeout(url, { headers, redirect: 'follow' });
  } catch (e) {
    log('FETCH ERR', e.message || e);
    return { status: 0, url, text: '' };
  }

  let text = '';
  try {
    text = await res.text();
  } catch (e) {
    log('READ ERR', e.message || e);
    return { status: res.status, url: res.url || url, text: '' };
  }
  log('→', res.status, text.length + 'B');

  const setCookie = res.headers.get('set-cookie') || res.headers.get('Set-Cookie');
  if (setCookie) {
    const mm = String(setCookie).match(/mlbd_hp=(?:"\s*\+\s*")?([0-9]+\.[0-9a-fA-F]+)/);
    if (mm && mm[1] !== hpToken) {
      hpToken = mm[1];
      return httpGet(url, extraHeaders);
    }
  }
  return { status: res.status, url: res.url || url, text };
}

async function httpGetHtml(url, extraHeaders = {}) {
  const r = await httpGet(url, extraHeaders);
  if (r.status === 0) throw new Error(`fetch failed: ${url}`);
  if (r.status === 403 && r.text.indexOf('This bucket cannot be viewed') >= 0)
    throw new Error(`R2 403: ${url}`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${url}`);
  if (r.text.indexOf('cf-turnstile') >= 0) throw new Error(`Turnstile: ${url}`);
  return { html: r.text, base: r.url };
}

// ⚡ FIX 2: resolveBase now returns the constant immediately
async function resolveBase() {
  return resolvedBase;
}

// ================= search =================
function typeFromUrl(url) {
  if (url.indexOf('/series/') >= 0 || url.indexOf('/anime/') >= 0) return 'TvSeries';
  if (url.indexOf('/drama/') >= 0) return 'AsianDrama';
  return 'Movie';
}

function parseMovieCards(html, pageBase) {
  const cards = findByClass(html, 'div', 'movie-card');
  log('cards found:', cards.length);
  const out = [], seen = new Set();
  for (let i = 0; i < cards.length; i++) {
    const inner = cards[i].inner;
    const titleA = findAnchorByClass(inner, 'title');
    if (!titleA) continue;
    const rawHref = attrOf('<a ' + titleA.attrs + '>', 'href');
    const title   = trimOrNull(stripTags(titleA.inner));
    if (!rawHref || !title) continue;
    const href = absoluteUrl(pageBase, rawHref);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const imgM     = inner.match(/<img\b[^>]*data-src="([^"]+)"/i);
    const qualityM = inner.match(/<span class="quality"[^>]*>([\s\S]*?)<\/span>/i);
    const langM    = inner.match(/<span class="language"[^>]*>([\s\S]*?)<\/span>/i);
    const ratingM  = inner.match(/rating-badge"[^>]*>[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
    out.push({
      title, url: href,
      poster:   imgM ? absoluteUrl(pageBase, imgM[1]) : null,
      quality:  qualityM ? trimOrNull(stripTags(qualityM[1])) : null,
      language: langM    ? trimOrNull(stripTags(langM[1]))    : null,
      rating:   ratingM  ? parseFloat(ratingM[1])             : null,
      type: typeFromUrl(href),
    });
  }
  return out;
}

async function mlinkSearch(query) {
  const base = await resolveBase();
  const url  = base + '/search?q=' + urlEncode(query.trim());
  const { html } = await httpGetHtml(url, { 'Referer': base + '/' });
  return parseMovieCards(html, base);
}

// ================= rank =================
function rankCandidates(results, tmdbItem, opts) {
  opts = opts || {};
  const tYear   = yearOf(tmdbItem);
  const tType   = tmdbItem.media_type === 'tv' ? 'tv' : 'movie';
  const tAsian  = isAsian(tmdbItem);
  const tTitle  = titleOf(tmdbItem);
  const preferDrama = opts.drama === true || (opts.drama !== false && tAsian);

  return results.map(r => {
    let score = 0;
    const yMatch = r.title.match(/\((\d{4})\)/);
    const rYear  = yMatch ? Number(yMatch[1]) : 0;
    if (tYear && rYear === tYear)                    score += 1000;
    else if (tYear && Math.abs(rYear - tYear) <= 1)  score += 300;
    else if (tYear && rYear)                         score -= 150;

    const ov = titleOverlap(r.title, tTitle);
    if (ov.common === 0)                             score -= 500;
    else if (ov.common === ov.ta && ov.common === ov.tb) score += 500;
    else if (ov.common >= 2)                         score += 200;
    else if (ov.common === 1 && (ov.ta === 1 || ov.tb === 1)) score += 100;
    else                                             score += 50;

    if (tType === 'movie' && r.type === 'Movie')                     score += 200;
    if (tType === 'tv'    && r.type === 'TvSeries')                  score += 200;
    if (tType === 'tv'    && preferDrama && r.type === 'AsianDrama') score += 300;
    if (tType === 'movie' && r.type !== 'Movie')                     score -= 200;
    if (tType === 'tv'    && r.type === 'Movie')                     score -= 150;

    return Object.assign({}, r, { _score: score });
  }).sort((a, b) => b._score - a._score);
}

// ================= decode manifest =================
function decodeManifest(scriptInner, seedAttr, repeatAttr) {
  if (!seedAttr) return scriptInner;
  const MUL = 0x41C64E6D;
  const INC = 0x3039;
  const MASK = 0xFFFFFFFF;

  let x = parseInt(seedAttr, 16) >>> 0;
  const repeat = parseInt(repeatAttr || '0', 10) || 0;

  for (let i = 0; i < repeat; i++) {
    const lo = (x & 0xffff) * MUL;
    const hi = ((x >>> 16) * MUL) & 0xffff;
    x = (((hi << 16) >>> 0) + lo + INC) & MASK;
  }

  const bytes = base64ToBytes(scriptInner.trim());
  for (let i = 0; i < bytes.length; i++) {
    const lo = (x & 0xffff) * MUL;
    const hi = ((x >>> 16) * MUL) & 0xffff;
    x = (((hi << 16) >>> 0) + lo + INC) & MASK;
    const key = (x >>> 16) & 0xFF;
    bytes[i] = (bytes[i] ^ key) & 0xff;
  }
  return bytesToUtf8(bytes);
}

// ================= mg token =================
async function mgToken(host, base) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = mgCache[host];
  if (cached && cached.expiresAtSec > nowSec) return cached.value;
  try {
    const r = await httpGet('https://' + host + '/g', {
      'Origin': base, 'Referer': base + '/', 'Accept': 'application/json',
    });
    if (r.status !== 200) { log('mgToken(' + host + ') ' + r.status); return null; }
    const json = JSON.parse(r.text);
    if (!json.ok || !json.g) return null;
    const prefix = json.g.indexOf('.') >= 0 ? json.g.split('.')[0] : json.g;
    const expiresAtSec = Number(prefix) - 600 || (nowSec + 1800);
    mgCache[host] = { value: json.g, expiresAtSec };
    return json.g;
  } catch (e) { log('mgToken(' + host + ') failed: ' + (e.message || e)); return null; }
}

async function withMgToken(link, base) {
  const m = link.match(CDN_STREAM_RE);
  if (!m) return link;
  if (link.indexOf('mg=') >= 0) return link;
  const prefix = m[1], host = m[2], qs = m[3];
  const token = await mgToken(host, base);
  if (!token) return link;
  const mg = 'mg=' + urlEncode(token);
  const query = (qs || '').replace(/^\?/, '');
  return prefix + '?' + (query ? mg + '&' + query : mg);
}

// ================= detail =================
async function loadDetail(url) {
  const base = await resolveBase();
  let fixedUrl = url;
  try {
    const u = new URL(url);
    if (u.host.indexOf('movielinkbd') >= 0) {
      const bu = new URL(base);
      fixedUrl = bu.protocol + '//' + bu.host + u.pathname + u.search;
    }
  } catch {}

  log('loading detail:', fixedUrl);
  const { html } = await httpGetHtml(fixedUrl, { 'Referer': base + '/' });
  log('  detail page:', html.length + 'B');

  let player = null;
  const scriptM = html.match(/<script\b[^>]*id="mlbdInlinePlayerData"[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptM) {
    const openTag = scriptM[0].slice(0, scriptM[0].indexOf('>') + 1);
    const seed = attrOf(openTag, 'data-s');
    const rep  = attrOf(openTag, 'data-r');
    try {
      const decoded = decodeManifest(scriptM[1], seed, rep);
      player = JSON.parse(decoded);
    } catch (e) { log('  manifest decode FAILED:', e.message || e); }
  }

  let title = null;
  const h1m = html.match(/<div[^>]*class="movie-info-view"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1m) title = trimOrNull(stripTags(h1m[1]));
  if (!title && player) title = trimOrNull(player.title);

  const episodes = [];
  const epArr = (player && player.episodes) || [];
  for (let i = 0; i < epArr.length; i++) {
    const ep = epArr[i];
    const links = [];
    const sources = ep.sources || [];
    for (let j = 0; j < sources.length; j++) {
      const src = sources[j];
      const su = trimOrNull(src.url);
      if (!su || su.indexOf('http') !== 0) continue;
      const q   = Number(src.quality) || 0;
      const ql  = trimOrNull(src.quality_label) || qualityName(q);
      const aud = trimOrNull(src.audio);
      const label = [ql, aud].filter(Boolean).join(' • ');
      links.push(q + '|' + label + '|' + su);
    }
    if (!links.length) continue;
    episodes.push({
      name:   trimOrNull(ep.label) || ('Episode ' + (i + 1)),
      season: (typeof ep.season === 'number') ? ep.season : 1,
      number: (typeof ep.number === 'number') ? ep.number : (i + 1),
      data:   links.join('\n'),
    });
  }
  episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));

  return { title, url: fixedUrl, type: typeFromUrl(fixedUrl), episodes };
}

// ================= link generation =================
async function generateLinks(blob) {
  const base = await resolveBase();
  const out = [];
  const lines = blob.split('\n');
  // ⚡ parallelize mgToken fetches for multiple qualities of the same CDN
  const parsed = lines.map(line => {
    const parts = line.split('|');
    if (parts.length < 3) return null;
    return { q: parts[0], label: parts[1], rawLink: parts.slice(2).join('|') };
  }).filter(Boolean);

  const withTokens = await Promise.all(parsed.map(async p => {
    const link = await withMgToken(p.rawLink, base);
    const type = link.indexOf('.m3u8') >= 0 ? 'HLS' : 'VIDEO';
    return { quality: p.q, label: p.label, url: link, type, referer: base + '/' };
  }));
  return withTokens;
}

// ================= pick episode =================
function pickEpisode(episodes, mediaType, seasonNum, episodeNum) {
  if (!episodes || !episodes.length) return null;
  if (mediaType === 'movie') return episodes[0];

  const s = Number(seasonNum);
  const e = Number(episodeNum);

  let hit = null;
  for (let i = 0; i < episodes.length; i++) {
    if (Number(episodes[i].season) === s && Number(episodes[i].number) === e) {
      hit = episodes[i]; break;
    }
  }
  if (hit) return hit;

  const seasonEps = episodes.filter(x => Number(x.season) === s);
  if (seasonEps.length) {
    seasonEps.sort((a, b) =>
      Math.abs(Number(a.number) - e) - Math.abs(Number(b.number) - e));
    return seasonEps[0];
  }
  episodes.sort((a, b) =>
    Math.abs(Number(a.season) - s) - Math.abs(Number(b.season) - s) ||
    Math.abs(Number(a.number) - e) - Math.abs(Number(b.number) - e));
  return episodes[0];
}

// ================= try one =================
async function tryOneCandidate(card, tmdbDetails, mediaType, seasonNum, episodeNum) {
  log('── try: "' + card.title + '" (score ' + card._score + ') ──');
  let detail;
  try {
    detail = await loadDetail(card.url);
  } catch (e) {
    log('  ✗ detail failed: ' + (e.message || e));
    return null;
  }
  if (!detail.episodes.length) {
    log('  ✗ no episodes');
    return null;
  }
  const target = pickEpisode(detail.episodes, mediaType, seasonNum, episodeNum);
  if (!target) { log('  ✗ no episode'); return null; }
  log('  → S' + target.season + 'E' + target.number + ' "' + target.name + '"');

  let links;
  try {
    links = await generateLinks(target.data);
  } catch (e) {
    log('  ✗ link gen: ' + (e.message || e));
    return null;
  }
  if (!links.length) { log('  ✗ no links'); return null; }
  log('  ✓ ' + links.length + ' stream(s)');
  return { detail, target, links, card };
}

// ⚡ FIX 1: hybrid parallel race
function raceFirstSuccess(promises) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (pending === 0) return resolve(null);
    promises.forEach(p => {
      p.then(r => {
        if (r) resolve(r);
        else if (--pending === 0) resolve(null);
      }).catch(() => {
        if (--pending === 0) resolve(null);
      });
    });
  });
}

// ================= controller =================
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  mediaType  = mediaType || 'movie';
  seasonNum  = Number(seasonNum)  || 1;
  episodeNum = Number(episodeNum) || 1;
  const t0 = Date.now();

  console.log('\n[MovieLinkBD] ═══ TMDB ' + tmdbId + ' (' + mediaType + ') S' + seasonNum + 'E' + episodeNum + ' ═══');

  // 1. TMDB
  let details;
  try {
    details = await tmdbDetailById(tmdbId, mediaType);
  } catch (e) {
    console.log('[MovieLinkBD] TMDB failed: ' + (e.message || e));
    return [];
  }
  console.log('[MovieLinkBD] TMDB: "' + details._title + '" (' + details._year + ')');

  // ⚡ FIX 3: parallel search queries
  const queries = [details._title];
  if (details.original_title && details.original_title !== details._title) {
    queries.push(details.original_title);
  }

  const searchResults = await Promise.all(
    queries.map(q => mlinkSearch(q).catch(() => []))
  );
  let cards = [];
  for (let i = 0; i < searchResults.length; i++) {
    console.log('[MovieLinkBD] Search "' + queries[i] + '" → ' + searchResults[i].length + ' card(s)');
    if (searchResults[i].length > cards.length) cards = searchResults[i];
  }
  if (!cards.length) {
    console.log('[MovieLinkBD] ✗ no cards (' + (Date.now() - t0) + 'ms)');
    return [];
  }

  // 3. Rank
  const ranked = rankCandidates(cards, details, {});
  console.log('[MovieLinkBD] Ranking:');
  for (let i = 0; i < Math.min(5, ranked.length); i++) {
    const r = ranked[i];
    console.log('  ' + (i === 0 ? '→' : ' ') + ' [' + i + '] ' + r.title + ' | ' + r.type + ' | ' + r._score);
  }

  // 4. Attempt list
  const attemptList = ranked.filter(r => r._score >= MIN_SCORE_TO_TRY);
  const toTry = attemptList.slice(0, MAX_ATTEMPTS);
  if (!toTry.length) {
    console.log('[MovieLinkBD] ✗ no candidates above ' + MIN_SCORE_TO_TRY + ' (' + (Date.now() - t0) + 'ms)');
    return [];
  }
  console.log('[MovieLinkBD] Trying top ' + toTry.length + ' sequentially, racing fallbacks');

  // ⚡ FIX 1: try first sequentially, then race remaining in parallel
  let result = await tryOneCandidate(toTry[0], details, mediaType, seasonNum, episodeNum);

  if (!result && toTry.length > 1) {
    const remaining = toTry.slice(1, 1 + PARALLEL_FALLBACK);
    console.log('[MovieLinkBD] First failed, racing ' + remaining.length + ' in parallel');
    const promises = remaining.map(c =>
      tryOneCandidate(c, details, mediaType, seasonNum, episodeNum).catch(() => null)
    );
    result = await raceFirstSuccess(promises);
  }

  if (!result) {
    console.log('[MovieLinkBD] ✗ all candidates failed (' + (Date.now() - t0) + 'ms)');
    return [];
  }

  // 6. Output
  const { target, links, card } = result;
  console.log('[MovieLinkBD] ✓ "' + card.title + '" S' + target.season + 'E' + target.number +
              ' in ' + (Date.now() - t0) + 'ms');

  const showLabel = mediaType === 'tv'
    ? details._title + ' S' + target.season + 'E' + target.number
    : details._title;

  return links.map(l => ({
    name:     'MovieLinkBD',
    title:    showLabel + ' — ' + l.label,
    url:      l.url,
    quality:  l.quality + 'p',
    headers: {
      'Referer':    l.referer,
      'User-Agent': BASE_HEADERS['User-Agent'],
    },
    subtitles: [],
    provider:  'movielinkbd',
  }));
}

// ================= exports =================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
}
if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
}