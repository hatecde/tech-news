const { getDb } = require('../db/database');
const { fetchLimited } = require('./safeFetch');

const IMAGE_REQUEST_HEADERS = {
  'User-Agent': 'TechFeedAggregator/1.0 (+https://github.com/techfeed)',
  Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
};

async function streamArticleImage(articleId) {
  const db = getDb();
  const article = db.prepare(`
    SELECT
      a.id,
      a.url,
      a.image_url,
      s.slug AS source_slug
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.id = ?
  `).get(articleId);

  if (!article || !article.image_url) throw new Error('Article not found');

  const result = await fetchLimited(article.image_url, {
    headers: { ...IMAGE_REQUEST_HEADERS, Referer: article.url },
    timeoutMs: 8000,
    maxBytes: 8_000_000,
    acceptContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  });

  if (!result.ok) throw new Error(`Image fetch failed (${result.status})`);
  return { body: result.body, contentType: result.contentType };
}

module.exports = { streamArticleImage };
