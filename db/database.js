const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { cleanArticleText, cleanArticleTitle } = require('../services/textCleanup');

const DATA_DIR      = path.join(__dirname, '..', 'data');
const DB_PATH       = path.join(DATA_DIR, 'news.db');

let db;

const SOURCES = [
  { name: 'The Verge',        slug: 'the-verge',        url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'TechCrunch',       slug: 'techcrunch',       url: 'https://techcrunch.com/feed/' },
  { name: 'Engadget',         slug: 'engadget',         url: 'https://www.engadget.com/rss.xml' },
  { name: 'PC Gamer',         slug: 'pc-gamer',         url: 'https://www.pcgamer.com/rss/' },
  { name: 'dev.ua',            slug: 'dev-ua-en',       url: 'https://dev.ua/en/rss' },
  { name: 'AIN',               slug: 'ain-en',          url: 'https://en.ain.ua/feed/' },
];

function initializeDb() {
  // Ensure the data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // Remove files left by the retired AI image-generation feature.
  fs.rmSync(path.join(DATA_DIR, 'generated-images'), { recursive: true, force: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');  // Better concurrent read performance
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL UNIQUE,
      url             TEXT    NOT NULL,
      slug            TEXT    NOT NULL UNIQUE,
      last_fetched_at TEXT    DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS articles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id    INTEGER NOT NULL REFERENCES sources(id),
      title        TEXT    NOT NULL,
      url          TEXT    NOT NULL UNIQUE,
      description  TEXT,
      content_html TEXT,
      content_text TEXT,
      image_url    TEXT,
      published_at TEXT,
      fetched_at   TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_source_id
      ON articles(source_id);
    CREATE INDEX IF NOT EXISTS idx_articles_published_at
      ON articles(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_url
      ON articles(url);
  `);

  ensureColumn('articles', 'preview_text', 'TEXT');
  ensureColumn('articles', 'preview_fetched_at', 'TEXT');
  ensureColumn('articles', 'content_html', 'TEXT');
  ensureColumn('articles', 'content_text', 'TEXT');

  removeLegacyGeneratedImageColumns();
  syncSources();
  cleanupStoredArticleText();
  console.log('[db] Initialized:', DB_PATH);
}

function removeLegacyGeneratedImageColumns() {
  const legacyColumns = [
    'generated_image_url',
    'generated_image_status',
    'generated_image_generated_at',
  ];

  for (const columnName of legacyColumns) {
    const exists = db.prepare('PRAGMA table_info(articles)').all()
      .some((column) => column.name === columnName);
    if (exists) {
      db.exec(`ALTER TABLE articles DROP COLUMN ${columnName}`);
    }
  }
}

function ensureColumn(tableName, columnName, sqlType) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}`);
  }
}

function syncSources() {
  const configuredSlugs = new Set(SOURCES.map((source) => source.slug));
  const existingSources = db.prepare(`
    SELECT id, slug
    FROM sources
  `).all();

  const obsoleteSources = existingSources.filter((source) => !configuredSlugs.has(source.slug));

  const sync = db.transaction(() => {
    if (obsoleteSources.length > 0) {
      const deleteArticlesBySource = db.prepare(`
        DELETE FROM articles
        WHERE source_id = ?
      `);
      const deleteSource = db.prepare(`
        DELETE FROM sources
        WHERE id = ?
      `);

      for (const source of obsoleteSources) {
        deleteArticlesBySource.run(source.id);
        deleteSource.run(source.id);
      }
    }

    const upsertSource = db.prepare(`
      INSERT INTO sources (name, url, slug)
      VALUES (@name, @url, @slug)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        url = excluded.url
    `);

    for (const source of SOURCES) {
      upsertSource.run(source);
    }
  });

  sync();
}

function cleanupStoredArticleText() {
  const rows = db.prepare(`
    SELECT
      id,
      title,
      description,
      content_text,
      preview_text,
      preview_fetched_at
    FROM articles
    WHERE title IS NOT NULL
      OR description IS NOT NULL
      OR content_text IS NOT NULL
      OR preview_text IS NOT NULL
  `).all();

  if (rows.length === 0) return;

  const update = db.prepare(`
    UPDATE articles
    SET
      title = @title,
      description = @description,
      content_text = @content_text,
      preview_text = @preview_text,
      preview_fetched_at = @preview_fetched_at
    WHERE id = @id
  `);

  const cleanup = db.transaction((articles) => {
    let changed = 0;

    for (const article of articles) {
      const title = cleanArticleTitle(article.title);
      const description = cleanArticleText(article.description, { maxLen: 240 });
      const contentText = cleanArticleText(article.content_text);
      const previewText = cleanArticleText(article.preview_text);
      const previewFetchedAt = previewText ? article.preview_fetched_at : null;

      if (
        title === article.title &&
        description === article.description &&
        contentText === article.content_text &&
        previewText === article.preview_text &&
        previewFetchedAt === article.preview_fetched_at
      ) {
        continue;
      }

      update.run({
        id: article.id,
        title,
        description,
        content_text: contentText,
        preview_text: previewText,
        preview_fetched_at: previewFetchedAt,
      });
      changed += 1;
    }

    return changed;
  });

  const changed = cleanup(rows);
  if (changed > 0) {
    console.log(`[db] Cleaned cached article text for ${changed} rows`);
  }
}

// Bulk-insert articles, ignoring duplicates (idempotent on re-fetch)
function upsertArticles(articles) {
  const insert = db.prepare(`
    INSERT INTO articles
      (source_id, title, url, description, content_html, content_text, image_url, published_at, fetched_at)
    VALUES
      (@source_id, @title, @url, @description, @content_html, @content_text, @image_url, @published_at, @fetched_at)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      description = COALESCE(excluded.description, articles.description),
      content_html = COALESCE(excluded.content_html, articles.content_html),
      content_text = COALESCE(excluded.content_text, articles.content_text),
      image_url = COALESCE(articles.image_url, excluded.image_url),
      published_at = COALESCE(excluded.published_at, articles.published_at)
  `);
  const insertMany = db.transaction((rows) => {
    let count = 0;
    for (const row of rows) {
      const result = insert.run(row);
      if (result.changes > 0) count += 1;
    }
    return count;
  });
  return insertMany(articles);
}

function getDb() {
  return db;
}

module.exports = { initializeDb, upsertArticles, getDb, SOURCES };
