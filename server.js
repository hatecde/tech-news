const express = require('express');
const morgan  = require('morgan');
const cors    = require('cors');
const path    = require('path');

const { initializeDb } = require('./db/database');
const { startScheduler } = require('./services/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/generated-images', express.static(path.join(__dirname, 'data', 'generated-images')));

// API routes
app.use('/api/articles', require('./routes/articles'));
app.use('/api/sources',  require('./routes/sources'));
app.use('/api/refresh',  require('./routes/refresh'));

// Unknown API endpoints should return JSON instead of the SPA HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'API endpoint not found' });
});

// SPA fallback — serve index.html for any non-API, non-static route
// Express 5 requires named wildcard parameters (path-to-regexp v8+)
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TechFeed running at http://localhost:${PORT}`);
  initializeDb();
  startScheduler();
});
