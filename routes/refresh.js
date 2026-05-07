const express = require('express');
const { fetchAll, fetchOne } = require('../services/feedFetcher');

const router = express.Router();

// POST /api/refresh
// Optional body: { "source": "hacker-news" } to refresh a single source
// Omit body to refresh all sources
router.post('/', async (req, res) => {
  const slug = req.body?.source || null;
  try {
    const result = slug ? await fetchOne(slug) : await fetchAll();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
