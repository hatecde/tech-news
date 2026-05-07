const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

// GET /api/sources
// Returns all sources with article count and last fetch time
router.get('/', (req, res) => {
  const db = getDb();

  const sources = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.slug,
      s.url,
      s.last_fetched_at,
      COUNT(a.id) AS article_count
    FROM sources s
    LEFT JOIN articles a ON a.source_id = s.id
    GROUP BY s.id
    ORDER BY s.name ASC
  `).all();

  res.json({ sources });
});

module.exports = router;
