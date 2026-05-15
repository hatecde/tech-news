const Parser   = require('rss-parser');
const { getDb, upsertArticles } = require('../db/database');
const { cleanArticleText, cleanArticleTitle, decodeHtmlEntities } = require('./textCleanup');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'TechFeedAggregator/1.0 (+https://github.com/techfeed)' },
  customFields: {
    item: [
      ['media:content',   'media:content',   { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
    ],
  },
});

function normalizeImageUrl(url, baseUrl = null) {
  if (!url || typeof url !== 'string') return null;
  const decoded = decodeHtmlEntities(url).trim();
  if (!decoded) return null;

  try {
    if (baseUrl) {
      const resolved = new URL(decoded, baseUrl).href;
      return /^https?:\/\//i.test(resolved) ? resolved : null;
    }

    if (/^https?:\/\//i.test(decoded)) return decoded;
    if (/^\/\//.test(decoded)) return `https:${decoded}`;
  } catch (_) {
    return null;
  }

  return null;
}

// Extract the first valid image URL from HTML content
function extractImageFromHtml(html, baseUrl = null) {
  if (!html) return null;

  const decoded = decodeHtmlEntities(html);
  const patterns = [
    { regex: /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, kind: 'url' },
    { regex: /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i, kind: 'url' },
    { regex: /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i, kind: 'url' },
    { regex: /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i, kind: 'url' },
    { regex: /<(?:img|source)[^>]+(?:srcset|data-srcset|imagesrcset)=["']([^"']+)["']/i, kind: 'srcset' },
    { regex: /<(?:img|source)[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/i, kind: 'url' },
  ];

  for (const { regex, kind } of patterns) {
    const match = decoded.match(regex);
    const imageUrl = kind === 'srcset'
      ? extractImageFromSrcset(match?.[1], baseUrl)
      : normalizeImageUrl(match?.[1], baseUrl);
    if (imageUrl) return imageUrl;
  }

  return null;
}

function extractImageFromSrcset(srcset, baseUrl = null) {
  if (!srcset || typeof srcset !== 'string') return null;

  const candidates = decodeHtmlEntities(srcset)
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidateUrl = candidates[i].split(/\s+/)[0];
    const imageUrl = normalizeImageUrl(candidateUrl, baseUrl);
    if (imageUrl) return imageUrl;
  }

  return null;
}

async function fetchImageFromArticlePage(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TechFeedAggregator/1.0 (+https://github.com/techfeed)' },
    });
    if (!response.ok) return null;

    const html = await response.text();
    return extractImageFromHtml(html, url);
  } catch (_) {
    return null;
  }
}

function getPreferredContent(item) {
  return (
    (typeof item['content:encoded'] === 'string' && item['content:encoded']) ||
    (typeof item.content === 'string' && item.content) ||
    (typeof item.contentSnippet === 'string' && item.contentSnippet) ||
    (typeof item.summary === 'string' && item.summary) ||
    null
  );
}

function buildCardDescription(item) {
  const summarySource = item.contentSnippet || item.summary || item['content:encoded'] || item.content;
  return cleanArticleText(summarySource, { maxLen: 240 });
}

// Normalize an rss-parser feed item into our DB row shape
function normalizeArticle(item, sourceId) {
  const url =
    (typeof item.link === 'string' ? item.link : null) ||
    (typeof item.guid === 'string' && item.guid.startsWith('http') ? item.guid : null);

  if (!url) return null;   // skip items with no usable URL

  // Image extraction: try several fields in priority order.
  // media:content can be { $: { url } } or { url } depending on the feed.
  const mc = item['media:content'];
  const mt = item['media:thumbnail'];
  const imageUrl =
    normalizeImageUrl(item.enclosure?.url, url) ||
    normalizeImageUrl(mc?.$?.url, url) ||
    normalizeImageUrl(mc?.url, url) ||
    normalizeImageUrl(typeof mc === 'string' ? mc : null, url) ||
    normalizeImageUrl(mt?.$?.url, url) ||
    normalizeImageUrl(mt?.url, url) ||
    normalizeImageUrl(typeof mt === 'string' ? mt : null, url) ||
    extractImageFromHtml(item.content, url) ||
    extractImageFromHtml(item['content:encoded'], url) ||
    null;

  const preferredContent = getPreferredContent(item);

  return {
    source_id:    sourceId,
    title:        cleanArticleTitle(item.title),
    url,
    description:  buildCardDescription(item),
    content_html: typeof preferredContent === 'string' && /<[^>]+>/.test(preferredContent) ? preferredContent : null,
    content_text: cleanArticleText(preferredContent),
    image_url:    imageUrl,
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null) || new Date().toISOString(),
    fetched_at:   new Date().toISOString(),
  };
}

async function enrichArticleImage(article, source) {
  if (article.image_url) return article;

  // TechCrunch often omits images from RSS content; fall back to the article page.
  // This also helps any other feed that keeps images in og:image only.
  const fallbackUrl = await fetchImageFromArticlePage(article.url);
  if (fallbackUrl) {
    article.image_url = fallbackUrl;
  }

  return article;
}

// Fetch a single source, insert new articles, update last_fetched_at
async function fetchSource(source) {
  const db = getDb();
  try {
    const feed  = await parser.parseURL(source.url);
    const items = feed.items.slice(0, 50);   // cap at 50 per fetch

    const articles = (await Promise.all(
      items
        .map(item => normalizeArticle(item, source.id))
        .filter(Boolean)
        .map(article => enrichArticleImage(article, source))
    ));

    const inserted = upsertArticles(articles);
    const now = new Date().toISOString();
    db.prepare('UPDATE sources SET last_fetched_at = ? WHERE id = ?').run(now, source.id);

    return { source: source.name, fetched: articles.length, inserted, error: null };
  } catch (err) {
    console.error(`[feedFetcher] Error fetching ${source.name}:`, err.message);
    return { source: source.name, fetched: 0, inserted: 0, error: err.message };
  }
}

// Fetch all sources in parallel
async function fetchAll() {
  const db      = getDb();
  const sources = db.prepare('SELECT * FROM sources').all();

  const results = await Promise.allSettled(sources.map(s => fetchSource(s)));

  let totalFetched  = 0;
  let totalInserted = 0;
  const errors = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      totalFetched  += r.value.fetched;
      totalInserted += r.value.inserted;
      if (r.value.error) errors.push({ source: r.value.source, error: r.value.error });
    } else {
      errors.push({ source: '?', error: r.reason?.message || String(r.reason) });
    }
  }

  return { fetched: totalFetched, inserted: totalInserted, errors };
}

// Fetch a single source by slug
async function fetchOne(slug) {
  const db     = getDb();
  const source = db.prepare('SELECT * FROM sources WHERE slug = ?').get(slug);
  if (!source) throw new Error(`Unknown source slug: ${slug}`);
  return fetchSource(source);
}

module.exports = {
  fetchAll,
  fetchOne,
  normalizeImageUrl,
  extractImageFromHtml,
  extractImageFromSrcset,
};
