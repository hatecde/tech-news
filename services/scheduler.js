const cron = require('node-cron');
const { fetchAll } = require('./feedFetcher');

function startScheduler() {
  // Initial fetch immediately on startup
  fetchAll()
    .then(r => console.log(`[startup] Initial fetch done — fetched=${r.fetched} inserted=${r.inserted} errors=${r.errors.length}`))
    .catch(err => console.error('[startup] Initial fetch failed:', err));

  // Subsequent fetches every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    console.log('[scheduler] Starting scheduled fetch...');
    fetchAll()
      .then(r => console.log(`[scheduler] Done — fetched=${r.fetched} inserted=${r.inserted} errors=${r.errors.length}`))
      .catch(err => console.error('[scheduler] Fetch failed:', err));
  });

  console.log('[scheduler] Scheduled — feeds refresh every 15 minutes');
}

module.exports = { startScheduler };
