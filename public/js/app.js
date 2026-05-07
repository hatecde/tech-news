import { getArticles, getSources, postRefresh } from './api.js';
import {
  initializeArticlePreview,
  openArticlePreview,
  renderSourceList,
  renderCards,
  renderFeaturedStory,
  updateSidebarStats,
  updateOverview,
  updateLastRefreshed,
  showError,
  hideError,
  setRefreshLoading,
  setLoadMoreVisible,
} from './ui.js';

const state = {
  activeSource: null,
  offset: 0,
  limit: 50,
  total: 0,
  isLoading: false,
  lastFetchedAt: null,
  sources: [],
  visibleArticles: [],
};

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  state.activeSource = params.get('source') || null;

  initializeArticlePreview();

  await Promise.all([loadSources(), loadArticles(true)]);

  setInterval(checkForUpdates, 60_000);

  document.getElementById('refresh-btn').addEventListener('click', handleRefresh);

  document.getElementById('load-more').addEventListener('click', () => {
    state.offset += state.limit;
    loadArticles(false);
  });

  window.addEventListener('popstate', () => {
    const current = new URLSearchParams(window.location.search);
    state.activeSource = current.get('source') || null;
    state.offset = 0;
    loadSources();
    loadArticles(true);
  });
});

async function loadSources() {
  try {
    const { sources } = await getSources();
    state.sources = sources;

    renderSourceList(sources, state.activeSource, onSourceClick);
    updateSidebarStats(sources);

    const times = sources.map((source) => source.last_fetched_at).filter(Boolean).sort();
    state.lastFetchedAt = times.at(-1) || null;
    updateLastRefreshed(state.lastFetchedAt);
    updateOverview(getOverviewState());
  } catch (err) {
    console.error('[app] loadSources error:', err);
  }
}

async function loadArticles(reset = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (reset) {
    state.offset = 0;
  }

  try {
    const { articles, total } = await getArticles({
      source: state.activeSource,
      limit: state.limit,
      offset: state.offset,
    });

    state.total = total;

    if (reset) {
      state.visibleArticles = articles;
      renderFeaturedStory(articles[0] || null);
      renderCards(articles.slice(1), {
        append: false,
        hasFeatured: Boolean(articles[0]),
        onArticleClick: handleArticleClick,
      });
    } else {
      state.visibleArticles.push(...articles);
      renderCards(articles, {
        append: true,
        hasFeatured: Boolean(state.visibleArticles[0]),
        onArticleClick: handleArticleClick,
      });
    }

    hideError();
    updateOverview(getOverviewState());

    const hasMore = state.offset + state.limit < total;
    setLoadMoreVisible(hasMore && articles.length > 0);
  } catch (err) {
    console.error('[app] loadArticles error:', err);
    showError('Failed to load articles: ' + err.message);
  } finally {
    state.isLoading = false;
  }
}

function onSourceClick(slug) {
  state.activeSource = slug;
  state.offset = 0;

  const url = new URL(window.location.href);
  if (slug) {
    url.searchParams.set('source', slug);
  } else {
    url.searchParams.delete('source');
  }
  history.pushState({}, '', url);

  loadSources();
  loadArticles(true);
}

async function handleRefresh() {
  setRefreshLoading(true);

  try {
    await postRefresh();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await Promise.all([loadSources(), loadArticles(true)]);
  } catch (err) {
    showError('Refresh failed: ' + err.message);
  } finally {
    setRefreshLoading(false);
  }
}

function handleArticleClick(article) {
  openArticlePreview(article);
}

async function checkForUpdates() {
  try {
    const { sources } = await getSources();
    const times = sources.map((source) => source.last_fetched_at).filter(Boolean).sort();
    const latest = times.at(-1) || null;

    if (latest && latest !== state.lastFetchedAt) {
      state.sources = sources;
      state.lastFetchedAt = latest;

      updateLastRefreshed(latest);
      renderSourceList(sources, state.activeSource, onSourceClick);
      updateSidebarStats(sources);
      updateOverview(getOverviewState());

      if (state.offset === 0) {
        loadArticles(true);
      }
    }
  } catch (_) {
    // Silent — polling failures should not surface to the user.
  }
}

function getOverviewState() {
  return {
    sources: state.sources,
    activeSource: state.activeSource,
    totalArticles: state.total,
    visibleCount: state.visibleArticles.length,
    lastFetchedAt: state.lastFetchedAt,
  };
}
