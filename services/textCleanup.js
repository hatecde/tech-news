const URLISH_PARAM_PATTERN = /\b(?:u|url|href|src|media|image)=https?%3A%2F%2F[^\s\])>"']*/gi;
const RAW_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s\])>"']+/gi;
const DANGLING_QUERY_PATTERN = /\b(?:id|xs|url|u|href|src|quality|strip|crop|w|h|width|height|fit|format|auto|ixlib|ixid|fm|q)=[^\s\])>"']+(?:&(?:id|xs|url|u|href|src|quality|strip|crop|w|h|width|height|fit|format|auto|ixlib|ixid|fm|q)=[^\s\])>"']+)*/gi;
const TRACKING_LEAKAGE_PATTERN = /\b(?:u|url|href|src)=https?%3A%2F%2F|\b(?:quality|strip|crop|xs|ixlib|ixid)=|https?:\/\/|www\./i;

function stripHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(text) {
  if (text == null) return '';

  return String(text)
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => decodeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => decodeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#038;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&euro;/gi, '\u20ac')
    .replace(/&yen;/gi, '\u00a5');
}

function cleanArticleText(text, { maxLen = null } = {}) {
  if (text == null) return null;

  const normalized = decodeHtmlEntities(stripHtml(decodeHtmlEntities(text)))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\u00ad/g, '')
    .replace(/\ufffd/g, ' ')
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€¦/g, '...')
    .replace(/â€“|â€”/g, '-')
    .replace(/Â/g, ' ')
    .replace(URLISH_PARAM_PATTERN, ' ')
    .replace(RAW_URL_PATTERN, ' ')
    .replace(DANGLING_QUERY_PATTERN, ' ')
    .replace(/\[[^\]]*(?:https?%3A%2F%2F|https?:\/\/|quality=|strip=)[^\]]*\]/gi, ' ')
    .replace(/(^|\s)\]\s*/g, '$1')
    .replace(/\|\s*Photo:[^.]+(?:\.)?/gi, ' ')
    .replace(/\|\s*Image:[^.]+(?:\.)?/gi, ' ')
    .replace(/\bPhoto by [^.]+(?:\.)?/gi, ' ')
    .replace(/\bImage credit:[^.]+(?:\.)?/gi, ' ')
    .replace(/\bvia Getty Images\b/gi, ' ')
    .replace(/\bRead more:.*$/gi, ' ')
    .replace(/\bContinue reading.*$/gi, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+([)\]}])/g, '$1')
    .replace(/\b([A-Za-z]+)\s+-\s*(iest|ish|like|style|esque)\b/gi, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;
  return maxLen ? truncateCleanText(normalized, maxLen) : normalized;
}

function cleanArticleTitle(title) {
  return cleanArticleText(title) || 'Untitled';
}

function hasTrackingLeakage(text) {
  return TRACKING_LEAKAGE_PATTERN.test(String(text || ''));
}

function truncateCleanText(text, maxLen) {
  if (!maxLen || text.length <= maxLen) return text;

  const sliced = text.slice(0, maxLen);
  const lastSentenceEnd = Math.max(
    sliced.lastIndexOf('.'),
    sliced.lastIndexOf('!'),
    sliced.lastIndexOf('?')
  );

  if (lastSentenceEnd >= Math.max(80, Math.floor(maxLen * 0.45))) {
    return sliced.slice(0, lastSentenceEnd + 1).trim();
  }

  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

function decodeCodePoint(codePoint) {
  if (!Number.isFinite(codePoint)) return '';

  try {
    return String.fromCodePoint(codePoint);
  } catch (_) {
    return '';
  }
}

module.exports = {
  cleanArticleTitle,
  cleanArticleText,
  decodeHtmlEntities,
  hasTrackingLeakage,
  stripHtml,
};
