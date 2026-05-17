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
  setLoadMoreLoading,
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
  paginationMessage: null,
};

let paginationMessageTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  state.activeSource = params.get('source') || null;

  initializeArticlePreview();

  await Promise.all([loadSources(), loadArticles(true)]);

  setInterval(checkForUpdates, 60_000);

  document.getElementById('refresh-btn').addEventListener('click', handleRefresh);

  document.getElementById('load-more').addEventListener('click', () => {
    if (state.isLoading) return;
    if (!canLoadMore()) {
      setLoadMoreVisible(false);
      return;
    }

    clearPaginationMessageTimer();
    state.paginationMessage = 'Loading more stories…';
    updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });
    setLoadMoreLoading(true);
    state.offset = state.visibleArticles.length;
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
    updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });
  } catch (err) {
    console.error('[app] loadSources error:', err);
  }
}

async function loadArticles(reset = false) {
  if (reset) {
    clearPaginationMessageTimer();
    state.paginationMessage = null;
    state.offset = 0;
    setLoadMoreVisible(false);
    setLoadMoreLoading(false);
  }

  if (state.isLoading) return;
  state.isLoading = true;

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

      if (articles.length > 0) {
        showPaginationMessage(`Loaded ${articles.length} more ${articles.length === 1 ? 'story' : 'stories'}`, 2200);
      } else {
        clearPaginationMessageTimer();
        state.paginationMessage = null;
      }
    }

    hideError();
    updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });

    setLoadMoreVisible(canLoadMore());
  } catch (err) {
    console.error('[app] loadArticles error:', err);
    clearPaginationMessageTimer();
    state.paginationMessage = null;
    showError('Failed to load articles: ' + err.message);
    updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });
  } finally {
    state.isLoading = false;
    setLoadMoreLoading(false);
  }
}

function canLoadMore() {
  return state.visibleArticles.length > 0 && state.visibleArticles.length < state.total;
}

function onSourceClick(slug) {
  clearPaginationMessageTimer();
  state.paginationMessage = null;
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
  clearPaginationMessageTimer();
  state.paginationMessage = null;

  try {
    await postRefresh();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await Promise.all([loadSources(), loadArticles(true)]);
  } catch (err) {
    showError('Refresh failed: ' + err.message);
  } finally {
    setRefreshLoading(false);
    updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });
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
      updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });

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

function showPaginationMessage(message, clearAfterMs = 0) {
  clearPaginationMessageTimer();
  state.paginationMessage = message;
  updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });

  if (clearAfterMs > 0) {
    paginationMessageTimer = setTimeout(() => {
      if (state.paginationMessage === message) {
        state.paginationMessage = null;
        updateOverview(getOverviewState(), { paginationMessage: state.paginationMessage });
      }
      paginationMessageTimer = null;
    }, clearAfterMs);
  }
}

function clearPaginationMessageTimer() {
  if (paginationMessageTimer) {
    clearTimeout(paginationMessageTimer);
    paginationMessageTimer = null;
  }
}
