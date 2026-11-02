/**
 * movielinkbd — Nuvio-style plugin
 *
 * Contract:
 *   const { getStreams } = require('./movielinkbd-nuvio.js');
 *   const streams = await getStreams(tmdbId, mediaType, season, episode);
 *
 * Works for both movies and series. Iterates every plausible MovieLinkBD
 * candidate until one produces real streams — no more "wrong match" aborts.
 *
 * CLI:
 *   node movielinkbd-nuvio.js <tmdbId> <movie|tv> [season] [episode]
 */

// ================= constants =================
const HUB_URL      = 'https://movielinkbd.com';
const FALLBACK_URL = 'https://sefcng.movielinkbd.li';
const TMDB_API_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
const TMDB_BASE    = 'https://api.themoviedb.org/3';

// Candidate scoring thresholds
const MIN_SCORE_TO_TRY   = 200;   // below this, card is almost certainly wrong
const MIN_SCORE_TO_ACCEPT = 500;  // below this, only accept if nothing better works

const BASE_HEADERS = {
  'sec-ch-ua':          '"Brave";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
  'sec-ch-ua-mobile':   '?1',
  'sec-ch-ua-platform': '"Android"',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent':         'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  'Accept':             'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Sec-GPC':            '1',
  'Sec-Fetch-Site':     'same-origin',
  'Sec-Fetch-Mode':     'navigate',
  'Sec-Fetch-User':     '?1',
  'Sec-Fetch-Dest':     'document',
  'Accept-Encoding':    'gzip, deflate, br',
  'Accept-Language':    'en-GB,en-US;q=0.9,en;q=0.8',
};

// ================= state =================
let resolvedBase = null;
let hpToken      = null;
const mgCache    = new Map();

// ================= utils =================
const log = (...a) => console.error('[mlbd]', ...a);
const trimOrNull = s => { if (s == null) return null; const t = String(s).trim(); return t || null; };
const urlEncode  = s => encodeURIComponent(s);
const CDN_STREAM_RE = /^(https?:\/\/([a-z0-9.-]+)\/p\/[A-Za-z0-9._%-]+)(\?.*)?$/i;
const ASIAN_LANGS = new Set(['ko','ja','zh','cn','th','tl','id','ms','hi','ta','te','bn','ml','kn','mr','pa','ur','vi']);
const ASIAN_COUNTRIES = new Set(['KR','JP','CN','TW','HK','TH','PH','ID','MY','IN','BD','PK','VN']);
const STOPWORDS = new Set(['the','a','an','of','and','or','in','on','at','to','for']);

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
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
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
  for (const t of ta) if (tb.has(t)) common++;
  return { common, ta: ta.size, tb: tb.size };
}

function yearOf(item) {
  return Number((item.release_date || item.first_air_date || '').slice(0, 4)) || 0;
}
function titleOf(item) {
  return item.title || item.name || item.original_title || item.original_name || '';
}
function isAsian(item) {
  return ASIAN_LANGS.has(item.original_language) ||
         (item.origin_country || []).some(c => ASIAN_COUNTRIES.has(c));
}
function qualityName(q) {
  if (q >= 2160) return '4K';
  if (q > 0)     return `${q}p`;
  return 'Stream';
}

// ================= TMDB =================
async function tmdbDetailById(tmdbId, mediaType) {
  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}&append_to_response=external_ids`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${mediaType}/${tmdbId}`);
  const data = await res.json();
  return {
    ...data,
    media_type: mediaType,
    imdb_id: data.external_ids?.imdb_id,
    _title:  titleOf(data),
    _year:   yearOf(data),
  };
}

// ================= HTTP =================
async function httpGet(url, extraHeaders = {}) {
  const headers = { ...BASE_HEADERS, ...extraHeaders };
  if (hpToken) headers['Cookie'] = `mlbd_hp=${hpToken}`;
  log('GET', url);
  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  log('→', res.status, text.length + 'B');

  const setCookies = res.headers.getSetCookie?.() ?? [];
  let token = null;
  for (const c of setCookies) {
    const mm = c.match(/mlbd_hp=(?:"\s*\+\s*")?([0-9]+\.[0-9a-fA-F]+)/);
    if (mm) { token = mm[1]; break; }
  }
  if (token && token !== hpToken) { hpToken = token; return httpGet(url, extraHeaders); }
  return { status: res.status, url: res.url, text };
}

async function httpGetHtml(url, extraHeaders = {}) {
  const r = await httpGet(url, extraHeaders);
  if (r.status === 403 && r.text.includes('This bucket cannot be viewed'))
    throw new Error(`R2 bucket 403 from ${url}`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status} from ${url}`);
  if (r.text.includes('cf-turnstile')) throw new Error(`Turnstile at ${url}`);
  return { html: r.text, base: r.url };
}

async function resolveBase() {
  if (resolvedBase) return resolvedBase;
  try {
    const r = await httpGet(HUB_URL);
    if (r.status === 200) {
      const m = r.text.match(/href="(https?:\/\/[^"]*movielinkbd\.li[^"]*)"/i);
      if (m) {
        const u = new URL(m[1]);
        resolvedBase = `${u.protocol}//${u.host}`;
        log('resolved base:', resolvedBase);
        return resolvedBase;
      }
    }
  } catch (e) { log('hub resolve failed:', e.message); }
  resolvedBase = FALLBACK_URL;
  log('fallback base:', resolvedBase);
  return resolvedBase;
}

// ================= search =================
function typeFromUrl(url) {
  if (url.includes('/series/') || url.includes('/anime/')) return 'TvSeries';
  if (url.includes('/drama/')) return 'AsianDrama';
  return 'Movie';
}

function parseMovieCards(html, pageBase) {
  const cards = findByClass(html, 'div', 'movie-card');
  log('cards found:', cards.length);
  const out = [], seen = new Set();
  for (const card of cards) {
    const inner = card.inner;
    const titleA = findAnchorByClass(inner, 'title');
    if (!titleA) continue;
    const rawHref = attrOf(`<a ${titleA.attrs}>`, 'href');
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
  const url  = `${base}/search?q=${urlEncode(query.trim())}`;
  const { html } = await httpGetHtml(url, { 'Referer': `${base}/` });
  return parseMovieCards(html, base);
}

// ================= rank =================
function rankCandidates(results, tmdbItem, opts = {}) {
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

    const { common, ta, tb } = titleOverlap(r.title, tTitle);
    if (common === 0)                            score -= 500;
    else if (common === ta && common === tb)     score += 500;
    else if (common >= 2)                        score += 200;
    else if (common === 1 && (ta === 1 || tb === 1)) score += 100;
    else                                         score += 50;

    if (tType === 'movie' && r.type === 'Movie')                     score += 200;
    if (tType === 'tv'    && r.type === 'TvSeries')                  score += 200;
    if (tType === 'tv'    && preferDrama && r.type === 'AsianDrama') score += 300;
    if (tType === 'movie' && r.type !== 'Movie')                     score -= 200;
    if (tType === 'tv'    && r.type === 'Movie')                     score -= 150;

    return { ...r, _score: score };
  }).sort((a, b) => b._score - a._score);
}

// ================= decode manifest =================
function decodeManifest(scriptInner, seedAttr, repeatAttr) {
  if (!seedAttr) return scriptInner;
  let x = BigInt(`0x${seedAttr}`) & 0xFFFFFFFFn;
  const repeat = parseInt(repeatAttr || '0', 10) || 0;
  const MUL = 0x41C64E6Dn, INC = 0x3039n, MASK = 0xFFFFFFFFn;
  for (let i = 0; i < repeat; i++) x = (MUL * x + INC) & MASK;
  const bytes = Buffer.from(scriptInner.trim(), 'base64');
  for (let i = 0; i < bytes.length; i++) {
    x = (MUL * x + INC) & MASK;
    bytes[i] ^= Number((x >> 16n) & 0xFFn);
  }
  return bytes.toString('utf8');
}

// ================= mg token =================
async function mgToken(host, base) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = mgCache.get(host);
  if (cached && cached.expiresAtSec > nowSec) return cached.value;
  try {
    const r = await httpGet(`https://${host}/g`, {
      'Origin': base, 'Referer': `${base}/`, 'Accept': 'application/json',
    });
    if (r.status !== 200) { log(`mgToken(${host}) ${r.status}`); return null; }
    const json = JSON.parse(r.text);
    if (!json.ok || !json.g) return null;
    const prefix = json.g.includes('.') ? json.g.split('.')[0] : json.g;
    const expiresAtSec = Number(prefix) - 600 || (nowSec + 1800);
    mgCache.set(host, { value: json.g, expiresAtSec });
    return json.g;
  } catch (e) { log(`mgToken(${host}) failed:`, e.message); return null; }
}

async function withMgToken(link, base) {
  const m = link.match(CDN_STREAM_RE);
  if (!m) return link;
  if (link.includes('mg=')) return link;
  const [, prefix, host, qs] = m;
  const token = await mgToken(host, base);
  if (!token) return link;
  const mg = `mg=${urlEncode(token)}`;
  const query = (qs || '').replace(/^\?/, '');
  return `${prefix}?${query ? `${mg}&${query}` : mg}`;
}

// ================= detail =================
async function loadDetail(url) {
  const base = await resolveBase();
  let fixedUrl = url;
  try {
    const u = new URL(url);
    if (u.host.includes('movielinkbd')) {
      const bu = new URL(base);
      fixedUrl = `${bu.protocol}//${bu.host}${u.pathname}${u.search}`;
    }
  } catch {}

  log('loading detail:', fixedUrl);
  const { html } = await httpGetHtml(fixedUrl, { 'Referer': `${base}/` });

  let player = null;
  const scriptM = html.match(/<script\b[^>]*id="mlbdInlinePlayerData"[^>]*>([\s\S]*?)<\/script>/i);
  if (scriptM) {
    const openTag = scriptM[0].slice(0, scriptM[0].indexOf('>') + 1);
    try {
      player = JSON.parse(decodeManifest(scriptM[1],
        attrOf(openTag, 'data-s'), attrOf(openTag, 'data-r')));
    } catch (e) { log('manifest decode failed:', e.message); }
  }

  let title = null;
  const h1m = html.match(/<div[^>]*class="movie-info-view"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1m) title = trimOrNull(stripTags(h1m[1]));
  if (!title && player) title = trimOrNull(player.title);

  const episodes = [];
  const epArr = player?.episodes ?? [];
  epArr.forEach((ep, i) => {
    const links = [];
    for (const src of (ep.sources ?? [])) {
      const su = trimOrNull(src.url);
      if (!su || !su.startsWith('http')) continue;
      const q   = Number(src.quality) || 0;
      const ql  = trimOrNull(src.quality_label) || qualityName(q);
      const aud = trimOrNull(src.audio);
      const label = [ql, aud].filter(Boolean).join(' • ');
      links.push(`${q}|${label}|${su}`);
    }
    if (!links.length) return;
    episodes.push({
      name:   trimOrNull(ep.label) || `Episode ${i + 1}`,
      season: Number.isFinite(ep.season) ? ep.season : 1,
      number: Number.isFinite(ep.number) ? ep.number : i + 1,
      data:   links.join('\n'),
    });
  });
  episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));

  return {
    title, url: fixedUrl,
    type: typeFromUrl(fixedUrl),
    episodes,
  };
}

// ================= link generation =================
async function generateLinks(blob) {
  const base = await resolveBase();
  const out = [];
  for (const line of blob.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 3) continue;
    const q = parts[0], label = parts[1], rawLink = parts.slice(2).join('|');
    const link = await withMgToken(rawLink, base);
    const type = link.includes('.m3u8') ? 'HLS' : 'VIDEO';
    out.push({ quality: q, label, url: link, type, referer: `${base}/` });
  }
  return out;
}

// ================= pick target episode =================
/**
 * Robust episode resolver:
 *  - Movie: returns the single episode (0-index of episodes).
 *  - Series: tries exact S/E, then S/E as strings, then closest episode.
 */
function pickEpisode(episodes, mediaType, seasonNum, episodeNum) {
  if (!episodes || !episodes.length) return null;
  if (mediaType === 'movie') return episodes[0];

  const s = Number(seasonNum);
  const e = Number(episodeNum);

  // Exact match
  let hit = episodes.find(x => Number(x.season) === s && Number(x.number) === e);
  if (hit) return hit;

  // Same season, closest episode
  const seasonEps = episodes.filter(x => Number(x.season) === s);
  if (seasonEps.length) {
    seasonEps.sort((a, b) =>
      Math.abs(Number(a.number) - e) - Math.abs(Number(b.number) - e));
    return seasonEps[0];
  }

  // Whole-series closest (S then E)
  episodes.sort((a, b) =>
    Math.abs(Number(a.season) - s) - Math.abs(Number(b.season) - s) ||
    Math.abs(Number(a.number) - e) - Math.abs(Number(b.number) - e));
  return episodes[0];
}

// ================= attempt one candidate =================
async function tryOneCandidate(card, tmdbDetails, mediaType, seasonNum, episodeNum) {
  log(`\n── try candidate: "${card.title}" (score ${card._score}) ──`);

  let detail;
  try {
    detail = await loadDetail(card.url);
  } catch (e) {
    log(`  ✗ detail fetch failed: ${e.message}`);
    return null;
  }

  if (!detail.episodes.length) {
    log(`  ✗ no episodes in manifest`);
    return null;
  }
  log(`  ✓ ${detail.episodes.length} episode(s) in manifest`);

  const target = pickEpisode(detail.episodes, mediaType, seasonNum, episodeNum);
  if (!target) {
    log(`  ✗ no usable episode`);
    return null;
  }
  log(`  → picking S${target.season}E${target.number} — "${target.name}"`);

  let links;
  try {
    links = await generateLinks(target.data);
  } catch (e) {
    log(`  ✗ link generation failed: ${e.message}`);
    return null;
  }
  if (!links.length) {
    log(`  ✗ no playable links generated`);
    return null;
  }
  log(`  ✓ ${links.length} stream(s) generated`);

  return {
    detail,
    target,
    links,
    card,
  };
}

// ================= controller — public API =================
async function getStreams(tmdbId, mediaType, seasonNum = 1, episodeNum = 1) {
  seasonNum  = Number(seasonNum)  || 1;
  episodeNum = Number(episodeNum) || 1;

  console.log(`\n[MovieLinkBD] ═══ TMDB ${tmdbId} (${mediaType}) S${seasonNum}E${episodeNum} ═══`);

  // 1. TMDB identity
  let details;
  try {
    details = await tmdbDetailById(tmdbId, mediaType);
  } catch (e) {
    console.log(`[MovieLinkBD] TMDB lookup failed: ${e.message}`);
    return [];
  }
  console.log(`[MovieLinkBD] TMDB: "${details._title}" (${details._year}) | ${details.original_language || '?'}`);

  // 2. MovieLinkBD search — try canonical title, then original title
  const queries = [details._title];
  if (details.original_title && details.original_title !== details._title) {
    queries.push(details.original_title);
  }

  let cards = [];
  for (const q of queries) {
    const found = await mlinkSearch(q).catch(() => []);
    console.log(`[MovieLinkBD] Search "${q}" → ${found.length} card(s)`);
    if (found.length) {
      cards = found;
      break;
    }
  }

  if (!cards.length) {
    console.log('[MovieLinkBD] ✗ nothing found on MovieLinkBD');
    return [];
  }

  // 3. Rank candidates
  const ranked = rankCandidates(cards, details, {});
  console.log('\n[MovieLinkBD] Candidate ranking:');
  ranked.slice(0, 8).forEach((r, i) => {
    console.log(`  ${i === 0 ? '→' : ' '} [${i}] ${r.title} | ${r.type} | score ${r._score}`);
  });

  // 4. Build attempt list:
  //    - always include candidates with score >= MIN_SCORE_TO_TRY
  //    - always try at least top-3 even if they score below threshold
  //      (MovieLinkBD sometimes has no year on the title)
  const attemptList = ranked.filter(r => r._score >= MIN_SCORE_TO_TRY);
  if (attemptList.length < 3) {
    for (const r of ranked.slice(0, 3)) {
      if (!attemptList.includes(r)) attemptList.push(r);
    }
  }
  // Cap attempts so we don't hammer the CDN forever
  const MAX_ATTEMPTS = 6;
  const toTry = attemptList.slice(0, MAX_ATTEMPTS);
  console.log(`[MovieLinkBD] Will try ${toTry.length} candidate(s)\n`);

  // 5. Try each candidate — stop at first success
  let result = null;
  for (const card of toTry) {
    result = await tryOneCandidate(card, details, mediaType, seasonNum, episodeNum);
    if (result) break;
  }

  if (!result) {
    console.log('[MovieLinkBD] ✗ no candidate produced streams');
    return [];
  }

  // 6. Build Nuvio-shaped output
  const { detail, target, links, card } = result;
  console.log(`\n[MovieLinkBD] ✓ using "${card.title}" — S${target.season}E${target.number}`);

  const showLabel = mediaType === 'tv'
    ? `${details._title} S${target.season}E${target.number}`
    : details._title;

  return links.map(l => ({
    name:     'MovieLinkBD',
    title:    `${showLabel} — ${l.label}`,
    url:      l.url,
    quality:  `${l.quality}p`,
    headers: {
      'Referer':    l.referer,
      'User-Agent': BASE_HEADERS['User-Agent'],
    },
    subtitles: [],
    provider:  'movielinkbd',
  }));
}

// ================= exports =================
module.exports = { getStreams };

// ================= CLI =================
if (require.main === module) {
  (async () => {
    const [,, tmdbId, mediaType = 'movie', season = '1', episode = '1'] = process.argv;
    if (!tmdbId) {
      console.error('Usage: node movielinkbd-nuvio.js <tmdbId> <movie|tv> [season] [episode]');
      console.error('Examples:');
      console.error('  node movielinkbd-nuvio.js 597 movie');
      console.error('  node movielinkbd-nuvio.js 2316 tv 2 5');
      process.exit(1);
    }
    const streams = await getStreams(Number(tmdbId), mediaType, Number(season), Number(episode));
    console.log('\n=== Result ===');
    console.log(JSON.stringify(streams, null, 2));
  })();
}