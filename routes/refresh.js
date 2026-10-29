const express = require('express');
const { fetchAll, fetchOne } = require('../services/feedFetcher');

const router = express.Router();
const REFRESH_COOLDOWN_MS = 60 * 1000;
const MAX_TRACKED_CLIENTS = 1000;
const lastRefreshAtByIp = new Map();

router.post('/', async (req, res) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const lastRefreshAt = lastRefreshAtByIp.get(ip);

  if (lastRefreshAt && now - lastRefreshAt < REFRESH_COOLDOWN_MS) {
    return res.status(429).json({
      ok: false,
      error: 'Please wait before requesting another refresh.',
    });
  }

  for (const [clientIp, timestamp] of lastRefreshAtByIp) {
    if (now - timestamp >= REFRESH_COOLDOWN_MS) lastRefreshAtByIp.delete(clientIp);
  }
  if (lastRefreshAtByIp.size >= MAX_TRACKED_CLIENTS) {
    const oldestIp = lastRefreshAtByIp.keys().next().value;
    if (oldestIp) lastRefreshAtByIp.delete(oldestIp);
  }

  const slug = req.body?.source || null;
  lastRefreshAtByIp.set(ip, now);

  try {
    const result = slug ? await fetchOne(slug) : await fetchAll();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
