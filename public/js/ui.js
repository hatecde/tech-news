import {
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
}, { paginationMessage = null } = {}) {
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

  const resultsMeta = document.getElementById('results-meta');
  const baseMessage = totalArticles
    ? `Showing ${formatCompactNumber(visibleCount || 0)} of ${formatCompactNumber(totalArticles)} stories${lastFetchedAt ? ` · synced ${formatTimeAgo(lastFetchedAt)}` : ''}`
    : 'Waiting for the first feed refresh to populate the stream.';

  resultsMeta.textContent = paginationMessage
    ? `${baseMessage} · ${paginationMessage}`
    : baseMessage;
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
  const wrap = document.createElement('div');
  wrap.className = 'card-image-wrap';

  const initialUrl = getPreferredImageUrl(article);
  if (!initialUrl) {
    wrap.appendChild(makeImagePlaceholder('card'));
    return wrap;
  }

  const img = createMediaImage(initialUrl, 'card');
  img.onerror = () => wrap.replaceChildren(makeImagePlaceholder('card'));
  wrap.appendChild(img);
  return wrap;
}

function makeFeaturedMediaContent(article) {
  const initialUrl = getPreferredImageUrl(article);
  if (!initialUrl) return makeImagePlaceholder('featured');

  const img = createMediaImage(initialUrl, 'featured');
  img.onerror = () => img.replaceWith(makeImagePlaceholder('featured'));
  return img;
}

function makeImagePlaceholder(variant) {
  const placeholder = document.createElement('div');
  placeholder.className = variant === 'featured'
    ? 'featured-media-placeholder'
    : 'card-image-placeholder';
  placeholder.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'image-placeholder-label';
  label.textContent = 'No image available';
  placeholder.appendChild(label);
  return placeholder;
}

function createMediaImage(url, variant) {
  const img = document.createElement('img');
  img.className = variant === 'featured' ? 'featured-media-image' : 'card-media-image';
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

function getPreferredImageUrl(article) {
  return article.image_url || null;
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
  const btn = document.getElementById('load-more');
  btn.hidden = !visible;
  if (!visible) {
    btn.disabled = false;
  }
}

export function setLoadMoreLoading(isLoading) {
  const btn = document.getElementById('load-more');
  btn.disabled = isLoading;
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
