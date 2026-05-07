const Parser   = require('rss-parser');
const { getDb, upsertArticles } = require('../db/database');

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

// Strip HTML tags and optionally truncate to maxLen characters
function stripHtml(str, maxLen = null) {
  if (!str) return null;
  const text = str
    .replace(/<[^>]+>/g, ' ')   // remove tags
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (!maxLen || text.length <= maxLen) return text;

  const sliced = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(
    sliced.lastIndexOf('.'),
    sliced.lastIndexOf('!'),
    sliced.lastIndexOf('?')
  );

  if (lastSentenceEnd >= Math.max(80, Math.floor(maxLen * 0.45))) {
    return sliced.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim() + '…';
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeImageUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const decoded = decodeHtmlEntities(url).trim();
  if (!/^https?:\/\//i.test(decoded)) return null;
  return decoded;
}

// Extract the first valid HTTPS image URL from HTML content
function extractImageFromHtml(html) {
  if (!html) return null;

  const decoded = decodeHtmlEntities(html);
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<(?:img|source)[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    const imageUrl = normalizeImageUrl(match?.[1]);
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
    return extractImageFromHtml(html);
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
  return stripHtml(summarySource, 240);
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
    normalizeImageUrl(item.enclosure?.url) ||
    normalizeImageUrl(mc?.$?.url) ||
    normalizeImageUrl(mc?.url) ||
    normalizeImageUrl(typeof mc === 'string' ? mc : null) ||
    normalizeImageUrl(mt?.$?.url) ||
    normalizeImageUrl(mt?.url) ||
    normalizeImageUrl(typeof mt === 'string' ? mt : null) ||
    extractImageFromHtml(item.content) ||
    extractImageFromHtml(item['content:encoded']) ||
    null;

  const preferredContent = getPreferredContent(item);

  return {
    source_id:    sourceId,
    title:        (item.title || 'Untitled').trim(),
    url,
    description:  buildCardDescription(item),
    content_html: typeof preferredContent === 'string' && /<[^>]+>/.test(preferredContent) ? preferredContent : null,
    content_text: stripHtml(preferredContent),
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

module.exports = { fetchAll, fetchOne };
