const express = require('express');
const morgan  = require('morgan');
const path    = require('path');

const { initializeDb } = require('./db/database');
const { startScheduler } = require('./services/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('dev'));
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/articles', require('./routes/articles'));
app.use('/api/sources',  require('./routes/sources'));
app.use('/api/refresh',  require('./routes/refresh'));

// Unknown API endpoints should return JSON 404s, not the frontend HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'API endpoint not found' });
});

// The frontend is served by express.static at /. Unknown paths are not SPA
// routes, so return a JSON 404 for every unmatched method/path.
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`TechFeed running at http://localhost:${PORT}`);
  initializeDb();
  startScheduler();
});
