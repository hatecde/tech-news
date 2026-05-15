const express = require('express');
const { getDb } = require('../db/database');
const { getArticlePreview } = require('../services/articlePreview');
const { generateArticleImage } = require('../services/imageGenerator');
const { streamArticleImage } = require('../services/articleImageProxy');

const router = express.Router();

// GET /api/articles
// Query params: source (slug), limit (default 50, max 200), offset (default 0)
router.get('/', (req, res) => {
  const db     = getDb();
  const source = req.query.source || null;
  const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  let whereClause  = '';
  let queryParams  = [];
  let countParams  = [];

  if (source) {
    whereClause = 'WHERE s.slug = ?';
    queryParams = [source, limit, offset];
    countParams = [source];
  } else {
    queryParams = [limit, offset];
    countParams = [];
  }

  const articles = db.prepare(`
    SELECT
      a.id,
      a.source_id,
      a.title,
      a.url,
      a.description,
      a.image_url,
      a.generated_image_url,
      a.generated_image_status,
      a.published_at,
      a.fetched_at,
      s.name AS source_name,
      s.slug AS source_slug
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    ${whereClause}
    ORDER BY a.published_at DESC
    LIMIT ? OFFSET ?
  `).all(...queryParams);

  const normalizedArticles = articles.map((article) => ({
    ...article,
    image_url: article.image_url ? `/api/articles/${article.id}/image` : article.image_url,
  }));

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total
    FROM articles a
    JOIN sources s ON a.source_id = s.id
    ${whereClause}
  `).get(...countParams);

  res.json({ articles: normalizedArticles, total, limit, offset });
});

router.get('/:id/image', async (req, res) => {
  const articleId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid article id' });
  }

  try {
    const { body, contentType } = await streamArticleImage(articleId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(body);
  } catch (err) {
    const status = err.message === 'Article not found' ? 404 : 502;
    res.status(status).json({ ok: false, error: err.message });
  }
});

router.post('/:id/generate-image', async (req, res) => {
  const articleId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid article id' });
  }

  try {
    const result = await generateArticleImage(articleId, {
      force: req.body?.force === true,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message === 'Article not found'
      ? 404
      : err.message === 'OPENAI_API_KEY is not set'
        ? 503
        : 500;

    res.status(status).json({ ok: false, error: err.message });
  }
});

router.get('/:id/preview', async (req, res) => {
  const articleId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return res.status(400).json({ ok: false, error: 'Invalid article id' });
  }

  try {
    const result = await getArticlePreview(articleId, {
      force: req.query.force === 'true',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    const status = err.message === 'Article not found' ? 404 : 500;
    res.status(status).json({ ok: false, error: err.message });
  }
});

module.exports = router;
