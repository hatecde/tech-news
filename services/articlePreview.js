const { getDb } = require('../db/database');

const PREVIEW_MAX_SENTENCES = 5;
const MIN_PREVIEW_SENTENCES = 3;
const MIN_ACCEPTABLE_SENTENCES = 2;
const MIN_SINGLE_SENTENCE_LENGTH = 90;
const MAX_PREVIEW_LENGTH = 980;
const PREVIEW_REBUILD_BEFORE = Date.parse('2026-04-24T00:00:00.000Z');
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'how',
  'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why',
  'with', 'you', 'your',
]);

async function getArticlePreview(articleId, { force = false } = {}) {
  const db = getDb();
  const article = db.prepare(`
    SELECT
      a.id,
      a.description,
      a.title,
      a.url,
      a.content_html,
      a.content_text,
      a.preview_text,
      a.preview_fetched_at,
      s.name AS source_name
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.id = ?
  `).get(articleId);

  if (!article) {
    throw new Error('Article not found');
  }

  if (!force && hasUsableCachedPreview(article)) {
    return {
      article_id: article.id,
      preview_text: article.preview_text,
      preview_fetched_at: article.preview_fetched_at,
      cached: true,
    };
  }

  const previewText = await fetchArticlePreviewText(article.url, article);
  const fetchedAt = new Date().toISOString();

  db.prepare(`
    UPDATE articles
    SET
      preview_text = ?,
      preview_fetched_at = ?
    WHERE id = ?
  `).run(previewText, fetchedAt, articleId);

  return {
    article_id: article.id,
    preview_text: previewText,
    preview_fetched_at: fetchedAt,
    cached: false,
  };
}

function hasUsableCachedPreview(article) {
  if (!article.preview_text || !article.preview_fetched_at) {
    return false;
  }

  const fetchedAt = Date.parse(article.preview_fetched_at);
  if (!Number.isFinite(fetchedAt) || fetchedAt < PREVIEW_REBUILD_BEFORE) {
    return false;
  }

  return !(
    isBoilerplateText(article.preview_text) ||
    isSyntheticPreview(article.preview_text) ||
    isWeakPreview(article.preview_text, article.title)
  );
}

async function fetchArticlePreviewText(url, article) {
  const candidates = [];

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TechFeedAggregator/1.0 (+https://github.com/techfeed)',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (response.ok) {
      const html = await response.text();
      candidates.push(...extractCandidateTextsFromHtml(html, 'live-page'));
    }
  } catch (_) {
    // Fall back to stored feed-backed content below.
  }

  if (article.content_html) {
    candidates.push(...extractCandidateTextsFromHtml(article.content_html, 'stored-feed-html'));
  }

  if (article.content_text) {
    candidates.push(...buildStoredTextCandidates(article.content_text, 'stored-feed-text'));
  }

  if (article.description) {
    candidates.push(...buildStoredTextCandidates(article.description, 'feed-description', 99));
  }

  const preview = buildEditorialBrief(article.title, candidates);
  if (preview) {
    return preview;
  }

  throw new Error('Could not extract article preview');
}

function extractCandidateTextsFromHtml(html, origin) {
  const candidates = [];

  candidates.push(...extractJsonLdTexts(html, origin));
  candidates.push(...extractMetaTexts(html, origin));

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');

  const articleMatches = [
    ...cleaned.matchAll(/<(article|main|section|div)[^>]*>[\s\S]*?<\/\1>/gi),
  ];

  const targets = articleMatches.length
    ? articleMatches.map((match) => match[0])
    : [cleaned];

  for (const target of targets.slice(0, 12)) {
    const paragraphMatches = target.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
    const paragraphs = [];

    for (const paragraph of paragraphMatches) {
      const text = normalizeText(stripHtml(paragraph));
      if (text && text.length >= 70 && !isBoilerplateText(text) && !looksLikeLowValueBlock(text)) {
        paragraphs.push(text);
      }
    }

    if (paragraphs.length > 0) {
      candidates.push(...buildParagraphCandidates(paragraphs, origin));
    }
  }

  return candidates;
}

function extractJsonLdTexts(html, origin) {
  const texts = [];
  const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const match of matches) {
    const json = match
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(decodeHtmlEntities(json));
      collectJsonLdText(parsed, texts, origin);
    } catch (_) {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return texts;
}

function collectJsonLdText(node, texts, origin) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdText(item, texts, origin);
    return;
  }

  if (typeof node !== 'object') return;

  const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : node['@type'];
  const looksArticleLike = typeof type === 'string' && /article|posting|news/i.test(type);

  if (looksArticleLike) {
    for (const key of ['articleBody', 'description', 'abstract']) {
      const text = normalizeText(node[key]);
      if (text && text.length >= 70 && !isBoilerplateText(text)) {
        texts.push({
          text,
          source: key === 'articleBody' ? `${origin}-jsonld-body` : `${origin}-jsonld-description`,
          order: key === 'articleBody' ? 0 : 1,
        });
      }
    }
  }

  for (const value of Object.values(node)) {
    collectJsonLdText(value, texts, origin);
  }
}

function extractMetaTexts(html, origin) {
  const texts = [];
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let order = 0;
    for (const match of html.matchAll(pattern)) {
      const text = normalizeText(match[1]);
      if (text && text.length >= 70 && !isBoilerplateText(text)) {
        texts.push({
          text,
          source: `${origin}-meta-description`,
          order: order++,
        });
      }
    }
  }

  return texts;
}

function buildParagraphCandidates(paragraphs, origin) {
  const candidates = [];
  const leadParagraphs = paragraphs.slice(0, 4);

  if (leadParagraphs.length >= 2) {
    candidates.push({
      text: leadParagraphs.join(' '),
      source: `${origin}-lead-paragraphs`,
      order: 0,
    });
  }

  for (const size of [3, 2]) {
    if (paragraphs.length >= size) {
      candidates.push({
        text: paragraphs.slice(0, size).join(' '),
        source: `${origin}-lead-window`,
        order: 1 + (3 - size),
      });
    }
  }

  for (const [index, paragraph] of paragraphs.slice(0, 8).entries()) {
    candidates.push({
      text: paragraph,
      source: `${origin}-paragraph`,
      order: index + 4,
    });
  }

  return candidates;
}

function buildStoredTextCandidates(text, source, startingOrder = 0) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const sentences = collectCandidateSentences(normalized);
  const candidates = [{
    text: normalized,
    source,
    order: startingOrder,
  }];

  if (sentences.length >= 2) {
    candidates.push({
      text: sentences.slice(0, Math.min(5, sentences.length)).join(' '),
      source: `${source}-lead`,
      order: startingOrder + 1,
    });
  }

  if (sentences.length >= 3) {
    candidates.push({
      text: sentences.slice(0, 3).join(' '),
      source: `${source}-brief`,
      order: startingOrder + 2,
    });
  }

  return candidates;
}

function buildEditorialBrief(title, candidates) {
  const titleKeywords = extractTitleKeywords(title);
  const normalizedCandidates = candidates
    .map((candidate, index) => normalizeCandidate(candidate, index))
    .filter(Boolean);

  let bestMatch = null;

  for (const candidate of normalizedCandidates) {
    const sentences = collectCandidateSentences(candidate.text);
    if (
      sentences.length < MIN_ACCEPTABLE_SENTENCES &&
      !(sentences.length === 1 && sentences[0].length >= MIN_SINGLE_SENTENCE_LENGTH)
    ) {
      continue;
    }

    for (const window of buildSentenceWindows(sentences)) {
      const evaluation = evaluateWindow(window, candidate, titleKeywords);
      if (!evaluation.accepted) continue;

      if (!bestMatch || evaluation.score > bestMatch.score) {
        bestMatch = {
          score: evaluation.score,
          sentences: window,
        };
      }
    }
  }

  if (!bestMatch) {
    return null;
  }

  return formatPreviewText(bestMatch.sentences);
}

function normalizeCandidate(candidate, fallbackOrder) {
  const rawText = typeof candidate === 'string' ? candidate : candidate?.text;
  const text = normalizeText(rawText);
  if (!text) return null;

  return {
    text,
    source: candidate?.source || 'unknown',
    order: Number.isFinite(candidate?.order) ? candidate.order : fallbackOrder,
  };
}

function collectCandidateSentences(text) {
  const sentences = [];
  const seen = new Set();
  const cleanedText = stripTrailingFragment(text);

  for (const sentence of splitIntoSentences(cleanedText)) {
    const normalizedSentence = normalizeSentence(sentence);
    if (!normalizedSentence) continue;
    if (normalizedSentence.length < 45) continue;
    if (normalizedSentence.length > 300) continue;
    if (!isCompleteSentence(normalizedSentence)) continue;
    if (isBoilerplateText(normalizedSentence)) continue;
    if (looksLikeLowValueSentence(normalizedSentence)) continue;

    const key = normalizedSentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sentences.push(normalizedSentence);
  }

  return sentences;
}

function buildSentenceWindows(sentences) {
  const windows = [];
  const maxStart = Math.min(sentences.length - 1, 2);

  for (let start = 0; start <= maxStart; start += 1) {
    const remaining = sentences.length - start;
    const preferredSize = Math.min(PREVIEW_MAX_SENTENCES, remaining);
    const minimumSize = Math.min(MIN_PREVIEW_SENTENCES, preferredSize);
    const minimumAllowed = remaining === 1 ? 1 : MIN_ACCEPTABLE_SENTENCES;

    for (let size = preferredSize; size >= minimumAllowed; size -= 1) {
      if (size < minimumSize && preferredSize >= MIN_PREVIEW_SENTENCES) {
        continue;
      }

      windows.push(sentences.slice(start, start + size));
    }
  }

  return windows;
}

function evaluateWindow(sentences, candidate, titleKeywords) {
  const text = sentences.join(' ');
  const totalCoverage = measureKeywordCoverage(text, titleKeywords);
  const firstSentenceCoverage = measureKeywordCoverage(sentences[0], titleKeywords);
  const totalLength = text.length;

  if (sentences.length < MIN_ACCEPTABLE_SENTENCES) {
    if (!(sentences.length === 1 && sentences[0].length >= MIN_SINGLE_SENTENCE_LENGTH)) {
      return { accepted: false, score: 0 };
    }
  }

  if (sentences.length === 1 && totalLength < MIN_SINGLE_SENTENCE_LENGTH) {
    return { accepted: false, score: 0 };
  }

  if (sentences.length > 1 && totalLength < 180) {
    return { accepted: false, score: 0 };
  }

  if (titleKeywords.length > 0 && totalCoverage === 0) {
    return { accepted: false, score: 0 };
  }

  if (titleKeywords.length >= 3 && firstSentenceCoverage === 0 && totalCoverage < 0.25) {
    return { accepted: false, score: 0 };
  }

  let score = getSourceWeight(candidate.source) + totalCoverage * 10;

  if (firstSentenceCoverage > 0) {
    score += 4;
  }

  if (sentences.length >= MIN_PREVIEW_SENTENCES) {
    score += 2;
  }

  if (sentences.length === PREVIEW_MAX_SENTENCES) {
    score += 1;
  }

  if (candidate.order === 0) {
    score += 2;
  }

  for (const [index, sentence] of sentences.entries()) {
    score += scoreSentence(sentence, index, titleKeywords);
  }

  if (totalLength > MAX_PREVIEW_LENGTH) {
    score -= 5;
  }

  score -= candidate.order * 0.2;
  return { accepted: true, score };
}

function scoreSentence(sentence, index, titleKeywords) {
  const coverage = measureKeywordCoverage(sentence, titleKeywords);
  const length = sentence.length;
  let score = coverage * 5;

  if (index === 0) score += 3;
  if (index === 1) score += 1.5;
  if (index >= 3) score -= (index - 2) * 0.35;

  if (length >= 70 && length <= 210) {
    score += 1.5;
  }

  if (/[0-9]/.test(sentence)) {
    score += 0.5;
  }

  if (/(because|after|amid|means|will|would|could|allows|designed|expected|impact|risk|goal|plan|launch|release|introduce|announc|report|according|feature|price|availability|shortage)/i.test(sentence)) {
    score += 1.5;
  }

  if (/^(however|but|meanwhile|also|still|yet)\b/i.test(sentence)) {
    score -= 1.5;
  }

  if (/^(it|this|that|they|these|those)\b/i.test(sentence) && coverage === 0 && index === 0) {
    score -= 2.5;
  }

  return score;
}

function formatPreviewText(sentences) {
  const chosen = [];

  for (const sentence of sentences) {
    const nextText = [...chosen, sentence].join(' ');
    if (nextText.length > MAX_PREVIEW_LENGTH && chosen.length >= MIN_ACCEPTABLE_SENTENCES) {
      break;
    }

    chosen.push(sentence);
  }

  while (chosen.length > MIN_ACCEPTABLE_SENTENCES && !isCompleteSentence(chosen[chosen.length - 1])) {
    chosen.pop();
  }

  const finalized = chosen.filter(isCompleteSentence);
  if (finalized.length === 0) {
    return null;
  }

  if (finalized.length === 1 && finalized[0].length < MIN_SINGLE_SENTENCE_LENGTH) {
    return null;
  }

  return finalized.join(' ');
}

function splitIntoSentences(text) {
  if (!text) return [];

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
  }

  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '...')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '—')
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeText(text) {
  const normalized = decodeHtmlEntities(stripHtml(text))
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/â€¦/g, '...')
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '—')
    .replace(/Â/g, ' ')
    .replace(/�/g, ' ')
    .replace(/\|\s*Photo:[^.]+(?:\.)?/gi, ' ')
    .replace(/\|\s*Image:[^.]+(?:\.)?/gi, ' ')
    .replace(/\bPhoto by [^.]+(?:\.)?/gi, ' ')
    .replace(/\bImage credit:[^.]+(?:\.)?/gi, ' ')
    .replace(/\bvia Getty Images\b/gi, ' ')
    .replace(/\bRead more:.*$/gi, ' ')
    .replace(/\bContinue reading.*$/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();

  return normalized || null;
}

function normalizeSentence(text) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();

  return normalized || null;
}

function extractTitleKeywords(title) {
  return Array.from(new Set(
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !TITLE_STOPWORDS.has(word))
  ));
}

function measureKeywordCoverage(text, keywords) {
  if (!text || keywords.length === 0) {
    return 0;
  }

  const lower = text.toLowerCase();
  let matches = 0;

  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      matches += 1;
    }
  }

  return matches / keywords.length;
}

function getSourceWeight(source) {
  if (/live-page-paragraph/.test(source)) return 8;
  if (/live-page-lead/.test(source)) return 8;
  if (/live-page-jsonld-body/.test(source)) return 7;
  if (/stored-feed-html-lead/.test(source)) return 6.5;
  if (/stored-feed-text-lead/.test(source)) return 6;
  if (/stored-feed-text/.test(source)) return 5.5;
  if (/jsonld-description/.test(source)) return 4.5;
  if (/meta-description/.test(source)) return 3;
  if (/feed-description/.test(source)) return 2;
  return 0;
}

function isBoilerplateText(text) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.startsWith('read the full story') ||
    lower.startsWith('sign up for') ||
    lower.startsWith('subscribe to') ||
    lower.startsWith('posts from this topic') ||
    lower.startsWith('share this story') ||
    lower.startsWith('most popular') ||
    lower.startsWith('open the story for') ||
    lower.startsWith('click here') ||
    lower.includes('copyright') ||
    lower.includes('all rights reserved') ||
    lower.includes('advertisement') ||
    lower.includes('daily email digest') ||
    lower.includes('homepage feed') ||
    lower.includes('newsletter') ||
    lower.includes('submit your email') ||
    lower.includes('follow us on') ||
    lower.includes('recommended stories') ||
    lower.includes('listen to this article')
  );
}

function isSyntheticPreview(text) {
  const lower = String(text || '').toLowerCase();
  return (
    lower.includes('this story from') ||
    lower.includes('this article from') ||
    lower.includes('the available feed summary points to') ||
    lower.includes('this preview is based on') ||
    lower.includes('open the story for the full article')
  );
}

function looksLikeLowValueBlock(text) {
  return (
    /^photo[:\s]/i.test(text) ||
    /^image[:\s]/i.test(text) ||
    /^caption[:\s]/i.test(text) ||
    /^credit[:\s]/i.test(text)
  );
}

function looksLikeLowValueSentence(sentence) {
  return (
    /^(photo|image|video|caption|credit):/i.test(sentence) ||
    /^(how|what|why|when|where|who)\b/i.test(sentence) ||
    /^by [A-Z][a-z]+/.test(sentence) ||
    /^updated\b/i.test(sentence) ||
    /^published\b/i.test(sentence) ||
    /^related articles\b/i.test(sentence) ||
    /\|\s*photo:/i.test(sentence) ||
    /via getty images/i.test(sentence) ||
    /\?\s*$/.test(sentence) ||
    sentence.split(' ').length < 8
  );
}

function isWeakPreview(text, title) {
  const sentences = collectCandidateSentences(text);
  if (sentences.length < MIN_ACCEPTABLE_SENTENCES) {
    return true;
  }

  const titleKeywords = extractTitleKeywords(title);
  const totalCoverage = measureKeywordCoverage(text, titleKeywords);
  const firstSentenceCoverage = measureKeywordCoverage(sentences[0], titleKeywords);

  return (
    sentences.length > PREVIEW_MAX_SENTENCES + 1 ||
    !isCompleteSentence(sentences[sentences.length - 1]) ||
    (titleKeywords.length > 0 && totalCoverage === 0) ||
    (titleKeywords.length >= 3 && firstSentenceCoverage === 0 && totalCoverage < 0.25)
  );
}

function isCompleteSentence(sentence) {
  const normalized = normalizeSentence(sentence);
  if (!normalized) {
    return false;
  }

  if (/…\s*$/.test(normalized) || /\.{3}\s*$/.test(normalized)) {
    return false;
  }

  return /[.!?]["')\]]*\s*$/.test(normalized);
}

function stripTrailingFragment(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  if (isCompleteSentence(normalized)) {
    return normalized;
  }

  const matches = Array.from(normalized.matchAll(/[.!?]["')\]]*/g));
  if (matches.length === 0) {
    return '';
  }

  const lastMatch = matches[matches.length - 1];
  const lastIndex = lastMatch.index + lastMatch[0].length;
  return normalized.slice(0, lastIndex).trim();
}

module.exports = { getArticlePreview };
