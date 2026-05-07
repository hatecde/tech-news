import {
  generateArticleImage as requestGeneratedArticleImage,
  getArticlePreview as requestArticlePreview,
} from './api.js';

// UI — pure DOM manipulation helpers

// Deterministic HSL color from a string (used for source branding)
export function sourceColor(slug) {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 62%, 48%)`;
}

const articleImageRequests = new Map();
let activePreviewArticleId = null;

export function formatTimeAgo(isoString) {
  if (!isoString) return '';

  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (diff < 60_000) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(isoString) {
  if (!isoString) return '';

  return new Date(isoString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function renderSourceList(sources, activeSlug, onSourceClick) {
  const container = document.getElementById('source-list');
  container.innerHTML = '';

  const totalArticles = sources.reduce((sum, source) => sum + (source.article_count || 0), 0);

  container.appendChild(
    makeSourceItem({
      slug: null,
      name: 'All Sources',
      meta: `${sources.length} feeds in rotation`,
      count: totalArticles,
      color: 'hsl(18, 86%, 58%)',
      activeSlug,
      onClick: onSourceClick,
    })
  );

  for (const source of sources) {
    container.appendChild(
      makeSourceItem({
        slug: source.slug,
        name: source.name,
        meta: source.last_fetched_at
          ? `Updated ${formatTimeAgo(source.last_fetched_at)}`
          : 'Awaiting first sync',
        count: source.article_count,
        color: sourceColor(source.slug),
        activeSlug,
        onClick: onSourceClick,
      })
    );
  }
}

function makeSourceItem({ slug, name, meta, count, color, activeSlug, onClick }) {
  const item = document.createElement('div');
  item.className = 'source-item' + (slug === activeSlug ? ' active' : '');
  item.setAttribute('role', 'button');
  item.setAttribute('tabindex', '0');
  item.setAttribute('aria-pressed', slug === activeSlug ? 'true' : 'false');
  item.style.setProperty('--source-color', color);

  const dot = document.createElement('span');
  dot.className = 'source-dot';

  const copy = document.createElement('div');
  copy.className = 'source-copy';

  const title = document.createElement('span');
  title.className = 'source-name';
  title.textContent = name;

  const metaLine = document.createElement('span');
  metaLine.className = 'source-meta';
  metaLine.textContent = meta;

  const badge = document.createElement('span');
  badge.className = 'source-count';
  badge.textContent = formatCompactNumber(count || 0);

  copy.append(title, metaLine);
  item.append(dot, copy, badge);

  const activate = () => onClick(slug);
  item.addEventListener('click', activate);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  });

  return item;
}

export function updateSidebarStats(sources) {
  const container = document.getElementById('sidebar-stats');
  const totalArticles = sources.reduce((sum, source) => sum + (source.article_count || 0), 0);
  const freshest = sources
    .map((source) => source.last_fetched_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  container.innerHTML = `
    <article class="sidebar-stat">
      <span class="sidebar-stat-label">Coverage</span>
      <strong class="sidebar-stat-value">${formatCompactNumber(totalArticles)}</strong>
    </article>
    <article class="sidebar-stat">
      <span class="sidebar-stat-label">Feeds</span>
      <strong class="sidebar-stat-value">${sources.length}</strong>
    </article>
    <article class="sidebar-stat">
      <span class="sidebar-stat-label">Freshest sync</span>
      <strong class="sidebar-stat-value">${freshest ? formatTimeAgo(freshest) : 'Pending'}</strong>
    </article>
    <article class="sidebar-stat">
      <span class="sidebar-stat-label">Ready</span>
      <strong class="sidebar-stat-value">${sources.filter((source) => source.last_fetched_at).length}</strong>
    </article>
  `;
}

export function updateOverview({
  sources,
  activeSource,
  totalArticles,
  visibleCount,
  lastFetchedAt,
}) {
  const activeSourceName = activeSource
    ? sources.find((source) => source.slug === activeSource)?.name || 'Selected source'
    : 'All feeds';

  const heading = activeSource
    ? `${activeSourceName} coverage, cleaned up.`
    : 'Signal across the tech press.';

  const subheading = activeSource
    ? `Filtering the stream down to ${activeSourceName} while keeping the overall feed counts and sync cadence in sight.`
    : `A calmer front page for the aggregator: scan the latest reporting, compare outlets, and move through the stream without visual clutter.`;

  document.getElementById('dashboard-heading').textContent = heading;
  document.getElementById('dashboard-subheading').textContent = subheading;
  document.getElementById('metric-visible').textContent = formatCompactNumber(visibleCount || 0);
  document.getElementById('metric-total').textContent = formatCompactNumber(totalArticles || 0);
  document.getElementById('metric-sources').textContent = String(sources.length || 0);
  document.getElementById('metric-focus').textContent = activeSourceName;

  document.getElementById('results-heading').textContent = activeSource
    ? `${activeSourceName} stories`
    : 'Latest coverage';

  document.getElementById('results-meta').textContent = totalArticles
    ? `Showing ${formatCompactNumber(visibleCount || 0)} of ${formatCompactNumber(totalArticles)} stories${lastFetchedAt ? ` · synced ${formatTimeAgo(lastFetchedAt)}` : ''}`
    : 'Waiting for the first feed refresh to populate the stream.';
}

export function renderFeaturedStory(article) {
  const container = document.getElementById('featured-story');
  container.innerHTML = '';

  if (!article) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  const color = sourceColor(article.source_slug);
  container.style.setProperty('--source-color', color);

  const copy = document.createElement('div');
  copy.className = 'featured-copy';

  const label = document.createElement('p');
  label.className = 'section-label';
  label.textContent = 'Lead Story';

  const meta = document.createElement('div');
  meta.className = 'featured-meta';

  const source = document.createElement('span');
  source.className = 'source-badge';
  source.textContent = article.source_name;

  const time = document.createElement('span');
  time.className = 'featured-time';
  time.textContent = article.published_at ? formatDateTime(article.published_at) : 'Publish time unavailable';

  const title = document.createElement('h3');
  title.textContent = article.title;

  const shortDescription = buildShortDescription(article.description);

  const cta = document.createElement('a');
  cta.className = 'featured-link';
  cta.href = article.url;
  cta.target = '_blank';
  cta.rel = 'noopener noreferrer';
  cta.textContent = 'Open lead story';

  meta.append(source, time);
  copy.append(label, meta, title);

  if (shortDescription) {
    const description = document.createElement('p');
    description.textContent = shortDescription;
    copy.appendChild(description);
  }

  copy.appendChild(cta);

  const media = document.createElement('div');
  media.className = 'featured-media';
  media.appendChild(makeFeaturedMediaContent(article));
  container.append(copy, media);
}

export function renderCards(articles, { append = false, hasFeatured = false, onArticleClick = null } = {}) {
  const grid = document.getElementById('card-grid');

  if (!append) {
    grid.innerHTML = '';
  }

  if (!append && !hasFeatured && articles.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🛰</div>
        <h2>No articles yet</h2>
        <p>Stories will appear here after the first feed fetch completes.</p>
      </div>
    `;
    return;
  }

  if (articles.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const article of articles) {
    fragment.appendChild(buildCard(article, onArticleClick));
  }
  grid.appendChild(fragment);
}

function buildCard(article, onArticleClick) {
  const color = sourceColor(article.source_slug);
  const shortDescription = buildShortDescription(article.description);

  const card = document.createElement('article');
  card.className = 'card';
  card.style.setProperty('--source-color', color);

  const link = document.createElement('button');
  link.className = 'card-link card-link--button';
  link.type = 'button';
  link.setAttribute('aria-label', `Preview article: ${article.title}`);
  link.addEventListener('click', () => onArticleClick?.(article));

  link.appendChild(makeCardMedia(article));

  const body = document.createElement('div');
  body.className = 'card-body';

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const source = document.createElement('span');
  source.className = 'source-badge';
  source.textContent = article.source_name;

  const time = document.createElement('span');
  time.className = 'card-time';
  time.textContent = formatTimeAgo(article.published_at);
  time.title = article.published_at ? new Date(article.published_at).toLocaleString() : '';

  meta.append(source, time);

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = article.title;

  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const linkText = document.createElement('span');
  linkText.className = 'card-link-text';
  linkText.textContent = 'Preview story';

  const arrow = document.createElement('span');
  arrow.className = 'card-arrow';
  arrow.innerHTML = '&rarr;';

  footer.append(linkText, arrow);
  body.append(meta, title);

  if (shortDescription) {
    const description = document.createElement('p');
    description.className = 'card-description';
    description.textContent = shortDescription;
    body.appendChild(description);
  }

  body.appendChild(footer);
  link.appendChild(body);
  card.appendChild(link);

  return card;
}

function makeCardMedia(article) {
  const initialUrl = getPreferredImageUrl(article);
  if (initialUrl) {
    const wrap = document.createElement('div');
    wrap.className = 'card-image-wrap';

    const img = createMediaImage(initialUrl, 'card');

    img.onerror = () => {
      const placeholder = makeGeneratedMediaImage(article, 'card');
      wrap.replaceChildren(placeholder);
      requestArticleImageUpgrade(article, placeholder, {
        variant: 'card',
        force: initialUrl === article.generated_image_url,
      });
    };

    wrap.appendChild(img);
    return wrap;
  }

  const wrap = makeGeneratedMediaWrap(article);
  const placeholder = wrap.querySelector('img');
  if (placeholder) {
    requestArticleImageUpgrade(article, placeholder, { variant: 'card' });
  }
  return wrap;
}

function makeGeneratedMediaWrap(article) {
  const wrap = document.createElement('div');
  wrap.className = 'card-image-wrap card-image-wrap--generated';
  wrap.appendChild(makeGeneratedMediaImage(article, 'card'));
  return wrap;
}

function makeFeaturedMediaContent(article) {
  const initialUrl = getPreferredImageUrl(article);

  if (!initialUrl) {
    const placeholder = makeGeneratedMediaImage(article, 'featured');
    requestArticleImageUpgrade(article, placeholder, { variant: 'featured' });
    return placeholder;
  }

  const img = createMediaImage(initialUrl, 'featured');

  img.onerror = () => {
    const placeholder = makeGeneratedMediaImage(article, 'featured');
    img.replaceWith(placeholder);
    requestArticleImageUpgrade(article, placeholder, {
      variant: 'featured',
      force: initialUrl === article.generated_image_url,
    });
  };

  return img;
}

function makeGeneratedMediaImage(article, variant) {
  return createMediaImage(createGeneratedArtUrl(article, variant), variant);
}

function createGeneratedArtUrl(article, variant) {
  const width = variant === 'featured' ? 1600 : 1200;
  const height = variant === 'featured' ? 1000 : 750;
  const seed = getHeadlineSeed(`${article.source_slug}:${article.title}`, 10_000);
  const accentHue = getHeadlineSeed(article.source_slug, 360);
  const signalHue = (accentHue + 38 + (seed % 44)) % 360;
  const accent = `hsl(${accentHue}, 72%, 66%)`;
  const accentSoft = `hsla(${accentHue}, 72%, 66%, 0.18)`;
  const signal = `hsl(${signalHue}, 18%, 88%)`;
  const signalSoft = `hsla(${signalHue}, 18%, 88%, 0.12)`;
  const theme = classifyHeadlineTheme(article.title);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#050505"/>
          <stop offset="52%" stop-color="#101012"/>
          <stop offset="100%" stop-color="#020202"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stop-color="${accentSoft}"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
        </radialGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.82"/>
          <stop offset="100%" stop-color="${signal}" stop-opacity="0.15"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" rx="28" fill="url(#bg)"/>
      <rect x="${Math.round(width * 0.04)}" y="${Math.round(height * 0.06)}" width="${Math.round(width * 0.92)}" height="${Math.round(height * 0.88)}" rx="28" fill="none" stroke="rgba(255,255,255,0.08)"/>
      <rect x="${Math.round(width * 0.075)}" y="${Math.round(height * 0.11)}" width="${Math.round(width * 0.85)}" height="${Math.round(height * 0.78)}" rx="22" fill="none" stroke="rgba(255,255,255,0.05)"/>
      <circle cx="${Math.round(width * 0.68)}" cy="${Math.round(height * 0.3)}" r="${Math.round(height * 0.36)}" fill="url(#glow)"/>
      ${buildGridPattern(width, height, seed)}
      ${buildThemeMotif(theme, { width, height, seed, accent, accentSoft, signal, signalSoft })}
      ${buildSignalMarks(width, height, seed, accent, signal)}
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function classifyHeadlineTheme(title) {
  const lower = title.toLowerCase();

  if (matchesTheme(lower, ['ai', 'openai', 'chatgpt', 'llm', 'model', 'machine learning', 'neural', 'robot'])) {
    return 'ai';
  }
  if (matchesTheme(lower, ['security', 'hack', 'breach', 'cyber', 'malware', 'ransomware', 'phishing', 'privacy'])) {
    return 'security';
  }
  if (matchesTheme(lower, ['apple', 'iphone', 'android', 'pixel', 'mobile', 'phone', 'tablet', 'watch'])) {
    return 'mobile';
  }
  if (matchesTheme(lower, ['nasa', 'space', 'rocket', 'satellite', 'mars', 'moon', 'starship', 'orbit'])) {
    return 'space';
  }
  if (matchesTheme(lower, ['chip', 'gpu', 'cpu', 'nvidia', 'amd', 'intel', 'semiconductor', 'silicon'])) {
    return 'chips';
  }
  if (matchesTheme(lower, ['startup', 'funding', 'market', 'revenue', 'ipo', 'business', 'earnings', 'sales'])) {
    return 'business';
  }
  if (matchesTheme(lower, ['browser', 'social', 'meta', 'google', 'youtube', 'tiktok', 'web', 'search'])) {
    return 'web';
  }

  return 'general';
}

function matchesTheme(lowerTitle, keywords) {
  return keywords.some((keyword) => lowerTitle.includes(keyword));
}

function buildThemeMotif(theme, palette) {
  switch (theme) {
    case 'ai':
      return buildAiMotif(palette);
    case 'security':
      return buildSecurityMotif(palette);
    case 'mobile':
      return buildMobileMotif(palette);
    case 'space':
      return buildSpaceMotif(palette);
    case 'chips':
      return buildChipMotif(palette);
    case 'business':
      return buildBusinessMotif(palette);
    case 'web':
      return buildWebMotif(palette);
    default:
      return buildGeneralMotif(palette);
  }
}

function buildAiMotif({ width, height, seed, accent, signalSoft }) {
  const nodes = Array.from({ length: 7 }, (_, index) => {
    const angle = ((seed + index * 39) % 360) * (Math.PI / 180);
    const radius = width * 0.1 + index * 18;
    const x = Math.round(width * 0.52 + Math.cos(angle) * radius);
    const y = Math.round(height * 0.44 + Math.sin(angle) * radius * 0.65);
    return `<circle cx="${x}" cy="${y}" r="${10 + (index % 3) * 3}" fill="${accent}" fill-opacity="${0.55 - index * 0.05}"/>`;
  }).join('');

  return `
    <path d="M ${width * 0.3} ${height * 0.62} C ${width * 0.38} ${height * 0.28}, ${width * 0.63} ${height * 0.28}, ${width * 0.7} ${height * 0.6}" stroke="${accent}" stroke-opacity="0.55" stroke-width="5" fill="none"/>
    <path d="M ${width * 0.34} ${height * 0.68} C ${width * 0.42} ${height * 0.82}, ${width * 0.58} ${height * 0.82}, ${width * 0.66} ${height * 0.68}" stroke="${signalSoft}" stroke-width="28" fill="none"/>
    ${nodes}
  `;
}

function buildSecurityMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <path d="M ${width * 0.5} ${height * 0.18} L ${width * 0.68} ${height * 0.26} L ${width * 0.66} ${height * 0.54} C ${width * 0.64} ${height * 0.68}, ${width * 0.56} ${height * 0.78}, ${width * 0.5} ${height * 0.84} C ${width * 0.44} ${height * 0.78}, ${width * 0.36} ${height * 0.68}, ${width * 0.34} ${height * 0.54} L ${width * 0.32} ${height * 0.26} Z" fill="${signalSoft}" stroke="${accent}" stroke-width="6"/>
    <rect x="${width * 0.42}" y="${height * 0.42}" width="${width * 0.16}" height="${height * 0.18}" rx="24" fill="rgba(255,255,255,0.03)" stroke="${signal}" stroke-opacity="0.35"/>
    <path d="M ${width * 0.45} ${height * 0.42} v-${height * 0.06} a${width * 0.05} ${height * 0.08} 0 0 1 ${width * 0.1} 0 v${height * 0.06}" stroke="${accent}" stroke-width="6" fill="none"/>
    <circle cx="${width * 0.5}" cy="${height * 0.51}" r="12" fill="${accent}"/>
  `;
}

function buildMobileMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <rect x="${width * 0.37}" y="${height * 0.16}" width="${width * 0.26}" height="${height * 0.62}" rx="38" fill="${signalSoft}" stroke="${accent}" stroke-width="6"/>
    <rect x="${width * 0.405}" y="${height * 0.22}" width="${width * 0.19}" height="${height * 0.46}" rx="24" fill="rgba(255,255,255,0.03)"/>
    <circle cx="${width * 0.5}" cy="${height * 0.73}" r="11" fill="${signal}" fill-opacity="0.55"/>
    <path d="M ${width * 0.28} ${height * 0.44} q ${width * 0.07} -${height * 0.12} ${width * 0.14} 0" stroke="${accent}" stroke-opacity="0.72" stroke-width="7" fill="none"/>
    <path d="M ${width * 0.58} ${height * 0.44} q ${width * 0.07} -${height * 0.12} ${width * 0.14} 0" stroke="${accent}" stroke-opacity="0.42" stroke-width="7" fill="none"/>
  `;
}

function buildSpaceMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${height * 0.15}" fill="${signalSoft}" stroke="${accent}" stroke-width="5"/>
    <ellipse cx="${width * 0.5}" cy="${height * 0.5}" rx="${width * 0.24}" ry="${height * 0.11}" stroke="${signal}" stroke-opacity="0.35" stroke-width="5"/>
    <ellipse cx="${width * 0.5}" cy="${height * 0.5}" rx="${width * 0.18}" ry="${height * 0.26}" stroke="${accent}" stroke-opacity="0.4" stroke-width="4"/>
    <circle cx="${width * 0.69}" cy="${height * 0.39}" r="12" fill="${accent}"/>
    <path d="M ${width * 0.26} ${height * 0.68} l ${width * 0.08} -${height * 0.16} l ${width * 0.04} ${height * 0.08} l ${width * 0.05} 0 l -${width * 0.08} ${height * 0.12} z" fill="${signal}" fill-opacity="0.4"/>
  `;
}

function buildChipMotif({ width, height, accent, signal, signalSoft }) {
  const pins = Array.from({ length: 6 }, (_, index) => {
    const x = width * 0.37 + index * width * 0.045;
    return `
      <rect x="${x}" y="${height * 0.2}" width="10" height="${height * 0.06}" fill="${signal}" fill-opacity="0.5"/>
      <rect x="${x}" y="${height * 0.74}" width="10" height="${height * 0.06}" fill="${signal}" fill-opacity="0.5"/>
    `;
  }).join('');

  return `
    <rect x="${width * 0.34}" y="${height * 0.26}" width="${width * 0.32}" height="${height * 0.48}" rx="26" fill="${signalSoft}" stroke="${accent}" stroke-width="6"/>
    <rect x="${width * 0.42}" y="${height * 0.36}" width="${width * 0.16}" height="${height * 0.18}" rx="16" fill="rgba(255,255,255,0.05)" stroke="${signal}" stroke-opacity="0.32"/>
    <path d="M ${width * 0.29} ${height * 0.38} H ${width * 0.34} M ${width * 0.66} ${height * 0.38} H ${width * 0.71} M ${width * 0.29} ${height * 0.54} H ${width * 0.34} M ${width * 0.66} ${height * 0.54} H ${width * 0.71}" stroke="${accent}" stroke-width="6"/>
    ${pins}
  `;
}

function buildBusinessMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <rect x="${width * 0.28}" y="${height * 0.58}" width="${width * 0.08}" height="${height * 0.16}" rx="14" fill="${signalSoft}" stroke="${accent}" stroke-width="4"/>
    <rect x="${width * 0.41}" y="${height * 0.46}" width="${width * 0.08}" height="${height * 0.28}" rx="14" fill="${signalSoft}" stroke="${accent}" stroke-width="4"/>
    <rect x="${width * 0.54}" y="${height * 0.34}" width="${width * 0.08}" height="${height * 0.4}" rx="14" fill="${signalSoft}" stroke="${accent}" stroke-width="4"/>
    <path d="M ${width * 0.24} ${height * 0.64} C ${width * 0.36} ${height * 0.58}, ${width * 0.48} ${height * 0.44}, ${width * 0.66} ${height * 0.28}" stroke="${signal}" stroke-opacity="0.45" stroke-width="6" fill="none"/>
    <circle cx="${width * 0.66}" cy="${height * 0.28}" r="12" fill="${accent}"/>
  `;
}

function buildWebMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <rect x="${width * 0.24}" y="${height * 0.24}" width="${width * 0.52}" height="${height * 0.42}" rx="26" fill="${signalSoft}" stroke="${accent}" stroke-width="6"/>
    <rect x="${width * 0.24}" y="${height * 0.24}" width="${width * 0.52}" height="${height * 0.08}" rx="26" fill="rgba(255,255,255,0.05)"/>
    <circle cx="${width * 0.29}" cy="${height * 0.28}" r="8" fill="${signal}" fill-opacity="0.75"/>
    <circle cx="${width * 0.33}" cy="${height * 0.28}" r="8" fill="${signal}" fill-opacity="0.45"/>
    <circle cx="${width * 0.37}" cy="${height * 0.28}" r="8" fill="${signal}" fill-opacity="0.25"/>
    <path d="M ${width * 0.34} ${height * 0.46} H ${width * 0.62}" stroke="${accent}" stroke-width="6"/>
    <path d="M ${width * 0.34} ${height * 0.56} H ${width * 0.56}" stroke="${signal}" stroke-opacity="0.38" stroke-width="6"/>
  `;
}

function buildGeneralMotif({ width, height, accent, signal, signalSoft }) {
  return `
    <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${height * 0.22}" fill="${signalSoft}" stroke="${accent}" stroke-width="5"/>
    <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${height * 0.13}" fill="rgba(255,255,255,0.03)" stroke="${signal}" stroke-opacity="0.3"/>
    <path d="M ${width * 0.3} ${height * 0.7} L ${width * 0.7} ${height * 0.3}" stroke="${accent}" stroke-opacity="0.36" stroke-width="5"/>
    <path d="M ${width * 0.35} ${height * 0.25} L ${width * 0.74} ${height * 0.64}" stroke="${signal}" stroke-opacity="0.22" stroke-width="4"/>
  `;
}

function buildGridPattern(width, height, seed) {
  const step = 56 + (seed % 4) * 12;
  let lines = '';

  for (let x = step; x < width; x += step) {
    const opacity = x % (step * 2) === 0 ? 0.08 : 0.04;
    lines += `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="rgba(255,255,255,${opacity})" stroke-width="1"/>`;
  }

  for (let y = step; y < height; y += step) {
    const opacity = y % (step * 2) === 0 ? 0.08 : 0.04;
    lines += `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(255,255,255,${opacity})" stroke-width="1"/>`;
  }

  return lines;
}

function buildSignalMarks(width, height, seed, accent, signal) {
  const bars = Array.from({ length: 9 }, (_, index) => {
    const barWidth = 18;
    const gap = 14;
    const x = width * 0.12 + index * (barWidth + gap);
    const barHeight = height * (0.08 + ((seed + index * 17) % 18) / 100);
    return `<rect x="${x}" y="${height * 0.82 - barHeight}" width="${barWidth}" height="${barHeight}" rx="9" fill="${index % 2 === 0 ? accent : signal}" fill-opacity="${index % 2 === 0 ? 0.65 : 0.3}"/>`;
  }).join('');

  const orbit = `<path d="M ${width * 0.1} ${height * 0.18} C ${width * 0.24} ${height * 0.06}, ${width * 0.72} ${height * 0.1}, ${width * 0.9} ${height * 0.34}" stroke="${accent}" stroke-opacity="0.22" stroke-width="4" fill="none"/>`;
  return bars + orbit;
}

function getHeadlineSeed(title, mod) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % mod;
}

function createMediaImage(url, variant) {
  const img = document.createElement('img');
  img.className = variant === 'featured' ? 'featured-media-image' : 'card-generated-image';
  img.src = url;
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  return img;
}

function buildShortDescription(description) {
  const clean = normalizePreviewText(description);
  const sentences = splitPreviewSentences(clean)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && isCompletePreviewSentence(sentence));

  if (sentences[0]) {
    return sentences[0];
  }

  return null;
}

function trimText(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength).trimEnd() + '…';
}

function getPreferredImageUrl(article) {
  return article.generated_image_url || article.image_url || null;
}

function requestArticleImageUpgrade(article, img, { variant, force = false } = {}) {
  if (!article?.id || !img) return;

  const cacheKey = `${article.id}:${force ? 'force' : 'normal'}`;
  if (!articleImageRequests.has(cacheKey)) {
    articleImageRequests.set(
      cacheKey,
      requestGeneratedArticleImage(article.id, { force })
        .catch((error) => {
          articleImageRequests.delete(cacheKey);
          throw error;
        })
    );
  }

  articleImageRequests.get(cacheKey)
    .then((result) => {
      const generatedUrl = result?.generated_image_url;
      if (!generatedUrl || !img.isConnected) return;

      img.src = generatedUrl;
      img.onerror = () => {
        if (!force) {
          const fallback = makeGeneratedMediaImage(article, variant);
          img.replaceWith(fallback);
          requestArticleImageUpgrade(article, fallback, { variant, force: true });
        }
      };
    })
    .catch((error) => {
      console.warn('[ui] generated image unavailable:', error.message);
    });
}

export function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.hidden = false;
  setTimeout(() => {
    banner.hidden = true;
  }, 8000);
}

export function hideError() {
  document.getElementById('error-banner').hidden = true;
}

export function updateLastRefreshed(isoString) {
  const el = document.getElementById('last-updated');
  el.textContent = isoString ? `Synced ${formatTimeAgo(isoString)}` : 'Waiting for first sync';
}

export function setRefreshLoading(isLoading) {
  const btn = document.getElementById('refresh-btn');
  btn.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
  btn.querySelector('.btn-text').textContent = isLoading ? 'Refreshing…' : 'Refresh';
}

export function setLoadMoreVisible(visible) {
  document.getElementById('load-more').hidden = !visible;
}

export function initializeArticlePreview({ onDismiss } = {}) {
  const modal = document.getElementById('article-preview-modal');
  const close = document.getElementById('article-preview-close');
  const backdrop = document.getElementById('article-preview-backdrop');

  hideArticlePreview();

  const dismiss = () => {
    hideArticlePreview();
    onDismiss?.();
  };

  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', dismiss);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      dismiss();
    }
  });
}

export async function openArticlePreview(article) {
  activePreviewArticleId = article.id;

  const modal = document.getElementById('article-preview-modal');
  const source = document.getElementById('article-preview-source');
  const title = document.getElementById('article-preview-title');
  const meta = document.getElementById('article-preview-meta');
  const body = document.getElementById('article-preview-body');
  const openLink = document.getElementById('article-preview-open');

  source.textContent = article.source_name;
  title.textContent = article.title;
  meta.textContent = `${formatTimeAgo(article.published_at)} · loading detailed preview`;
  body.innerHTML = '<p class="article-preview-loading">Fetching article preview…</p>';
  openLink.href = article.url;
  modal.hidden = false;
  document.body.classList.add('modal-open');

  try {
    const { preview_text: previewText } = await requestArticlePreview(article.id);
    if (activePreviewArticleId !== article.id) return;

    meta.textContent = `${formatTimeAgo(article.published_at)} · ${getArticleDomain(article.url)}`;
    body.innerHTML = '';

    const formattedPreview = formatPreviewCopy(previewText);
    if (!formattedPreview) {
      renderArticlePreviewError(body);
      return;
    }

    const preview = document.createElement('p');
    preview.className = 'article-preview-copy';
    preview.textContent = formattedPreview;
    body.appendChild(preview);
  } catch (error) {
    if (activePreviewArticleId !== article.id) return;

    meta.textContent = `${formatTimeAgo(article.published_at)} · ${getArticleDomain(article.url)}`;
    renderArticlePreviewError(body);
  }
}

export function hideArticlePreview() {
  activePreviewArticleId = null;
  document.getElementById('article-preview-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function getArticleDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'external article';
  }
}

function formatPreviewCopy(text) {
  const clean = normalizePreviewText(text);
  const sentences = splitPreviewSentences(clean)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence && isCompletePreviewSentence(sentence))
    .slice(0, 5);

  if (sentences.length > 0) {
    return sentences.join(' ');
  }

  return null;
}

function renderArticlePreviewError(body) {
  body.innerHTML = '';

  const error = document.createElement('p');
  error.className = 'article-preview-error';
  error.textContent = 'Preview unavailable for this story right now.';
  body.appendChild(error);
}

function normalizePreviewText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function splitPreviewSentences(text) {
  return text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) || [];
}

function isCompletePreviewSentence(sentence) {
  return /[.!?](?:["')\]]*)\s*$/.test(sentence) && !(/…\s*$/.test(sentence) || /\.{3}\s*$/.test(sentence));
}
