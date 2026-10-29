// API wrapper — thin fetch helpers for each endpoint

const BASE = '';  // same origin

async function request(path, options = {}) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body = await res.json(); msg = body.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Fetch paginated articles.
 * @param {{ source?: string, limit?: number, offset?: number, signal?: AbortSignal }} params
 */
export function getArticles({ source = null, limit = 50, offset = 0, signal } = {}) {
  const qs = new URLSearchParams({ limit, offset });
  if (source) qs.set('source', source);
  return request(`/api/articles?${qs}`, { signal });
}

/**
 * Fetch all sources with article counts.
 */
export function getSources() {
  return request('/api/sources');
}

/**
 * Trigger an immediate RSS refresh from the UI button.
 */
export function postRefresh() {
  return request('/api/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TechFeed-Refresh-Action': 'ui-button',
    },
    body: JSON.stringify({}),
  });
}

/**
 * Fetch a cached or live article preview excerpt.
 * @param {number} articleId
 * @param {{ force?: boolean }} options
 */
export function getArticlePreview(articleId, { force = false } = {}) {
  const qs = new URLSearchParams();
  if (force) qs.set('force', 'true');
  const suffix = qs.size ? `?${qs}` : '';
  return request(`/api/articles/${articleId}/preview${suffix}`);
}
