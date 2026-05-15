const { getDb } = require('../db/database');

const IMAGE_REQUEST_HEADERS = {
  'User-Agent': 'TechFeedAggregator/1.0 (+https://github.com/techfeed)',
  'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
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

  if (!article || !article.image_url) {
    throw new Error('Article not found');
  }

  const response = await fetch(article.image_url, {
    headers: {
      ...IMAGE_REQUEST_HEADERS,
      Referer: article.url,
    },
  });

  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const body = Buffer.from(await response.arrayBuffer());

  return { body, contentType };
}

module.exports = { streamArticleImage };
