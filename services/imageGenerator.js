const fs = require('fs');
const path = require('path');

const { getDb, GENERATED_DIR } = require('../db/database');

const OPENAI_IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
const DEFAULT_SIZE = process.env.OPENAI_IMAGE_SIZE || '1536x1024';
const DEFAULT_QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'low';

const inFlight = new Map();
const failedGenerationAt = new Map();
const FAILURE_COOLDOWN_MS = 60 * 60 * 1000;
const MAX_CONCURRENT_GENERATIONS = boundedInteger(
  process.env.MAX_CONCURRENT_IMAGE_GENERATIONS, 2, 1, 8
);
let activeGenerations = 0;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function generateArticleImage(articleId, { force = false } = {}) {
  if (inFlight.has(articleId)) return inFlight.get(articleId);
  if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) {
    throw new Error('Image generation capacity reached');
  }

  activeGenerations += 1;
  const promise = generateArticleImageInternal(articleId, { force }).finally(() => {
    inFlight.delete(articleId);
    activeGenerations -= 1;
  });
  inFlight.set(articleId, promise);
  return promise;
}

async function generateArticleImageInternal(articleId, { force = false } = {}) {
  const db = getDb();
  const article = db.prepare(`
    SELECT
      a.id,
      a.title,
      a.url,
      a.description,
      a.image_url,
      a.generated_image_url,
      a.generated_image_status,
      s.name AS source_name,
      s.slug AS source_slug
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.id = ?
  `).get(articleId);

  if (!article) {
    throw new Error('Article not found');
  }

  if (!force && article.generated_image_url && generatedFileExists(article.generated_image_url)) {
    return {
      generated_image_url: article.generated_image_url,
      generated_image_status: 'ready',
      cached: true,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const lastFailureAt = failedGenerationAt.get(articleId);
  if (!force && lastFailureAt && Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    throw new Error('Image generation is cooling down after a recent failure');
  }

  db.prepare(`
    UPDATE articles
    SET generated_image_status = ?, generated_image_generated_at = NULL
    WHERE id = ?
  `).run('pending', articleId);

  try {
    const prompt = buildArticleImagePrompt(article);
    let imageBase64;
    try {
      imageBase64 = await requestImageGeneration(prompt);
    } catch (error) {
      failedGenerationAt.set(articleId, Date.now());
      throw error;
    }

    const previousGeneratedUrl = article.generated_image_url;
    const filename = `article-${articleId}-${Date.now()}.jpg`;
    const absolutePath = path.join(GENERATED_DIR, filename);
    const publicPath = `/generated-images/${filename}`;

    fs.writeFileSync(absolutePath, Buffer.from(imageBase64, 'base64'));

    db.prepare(`
      UPDATE articles
      SET
        generated_image_url = ?,
        generated_image_status = ?,
        generated_image_generated_at = ?
      WHERE id = ?
    `).run(publicPath, 'ready', new Date().toISOString(), articleId);

    failedGenerationAt.delete(articleId);
    if (previousGeneratedUrl && previousGeneratedUrl !== publicPath) {
      removeGeneratedImageFile(previousGeneratedUrl);
    }

    return {
      generated_image_url: publicPath,
      generated_image_status: 'ready',
      cached: false,
    };
  } catch (error) {
    db.prepare(`
      UPDATE articles
      SET generated_image_status = ?
      WHERE id = ?
    `).run('failed', articleId);
    throw error;
  }
}

async function requestImageGeneration(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch(OPENAI_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt,
        size: DEFAULT_SIZE,
        quality: DEFAULT_QUALITY,
        output_format: 'jpeg',
        output_compression: 82,
        background: 'opaque',
        moderation: 'auto',
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI image generation failed (${response.status})`;
      throw new Error(message);
    }

    const imageBase64 = payload?.data?.[0]?.b64_json || null;
    if (!imageBase64) {
      throw new Error('OpenAI image generation returned no image data');
    }

    return imageBase64;
  } finally {
    clearTimeout(timeout);
  }
}

function buildArticleImagePrompt(article) {
  const subjectHint = inferSubjectHint(article.title, article.description);
  const detail = article.description
    ? article.description.replace(/\s+/g, ' ').trim().slice(0, 260)
    : 'No description was provided by the feed.';

  return [
    'Use case: photorealistic-natural',
    'Asset type: tech news aggregator article cover image',
    `Primary request: Create a dark editorial cover image for this article headline: "${article.title}"`,
    `Scene/backdrop: ${subjectHint.scene}`,
    `Subject: ${subjectHint.subject}`,
    'Style/medium: cinematic editorial illustration with realistic lighting and believable detail',
    'Composition/framing: landscape 3:2, strong focal subject, clean center-weighted composition, suitable as a news card image',
    'Lighting/mood: moody, dramatic, polished, nocturnal or low-key lighting',
    'Color palette: black, charcoal, graphite, deep shadows, restrained cool highlights, subtle contrast, preserve a dark website theme',
    `Materials/textures: ${subjectHint.textures}`,
    `Constraints: The image must visually reflect the article topic. Source: ${article.source_name}. Supporting context: ${detail}`,
    'Avoid: text, captions, logos, watermarks, browser UI, collage layout, split panels, bright white backgrounds, oversaturated colors, cartoon stickers',
  ].join('\n');
}

function inferSubjectHint(title, description = '') {
  const text = `${title} ${description}`.toLowerCase();

  if (containsAny(text, ['health', 'healthcare', 'hospital', 'medical', 'medicine', 'doctor', 'patient', 'clinical', 'biotech'])) {
    return {
      scene: 'a modern healthcare setting with technology integrated into the environment',
      subject: 'medical professionals, digital health systems, patient monitoring equipment, or a hospital-tech environment that matches the headline',
      textures: 'glass displays, medical instruments, soft monitor glow, clean metallic surfaces',
    };
  }

  if (containsAny(text, ['ai', 'openai', 'llm', 'model', 'machine learning', 'neural', 'agent'])) {
    return {
      scene: 'an abstract but believable AI lab or computational environment',
      subject: 'intelligent systems, glowing compute structures, or a human-technology interaction that clearly signals artificial intelligence',
      textures: 'matte metal, dark glass, screen glow, subtle volumetric light',
    };
  }

  if (containsAny(text, ['security', 'breach', 'hack', 'cyber', 'malware', 'privacy', 'ransomware'])) {
    return {
      scene: 'a dark cybersecurity operations setting',
      subject: 'security analysts, digital threat maps, secure infrastructure, or a stylized visualization of cyber defense',
      textures: 'dark monitors, reflective glass, code-like light trails, matte black surfaces',
    };
  }

  if (containsAny(text, ['chip', 'gpu', 'cpu', 'nvidia', 'amd', 'intel', 'semiconductor', 'silicon'])) {
    return {
      scene: 'a high-end semiconductor or data-center environment',
      subject: 'processor hardware, server racks, silicon wafers, or advanced compute machinery',
      textures: 'brushed metal, illuminated circuitry, dark industrial surfaces',
    };
  }

  if (containsAny(text, ['space', 'rocket', 'nasa', 'satellite', 'moon', 'mars', 'orbit'])) {
    return {
      scene: 'a cinematic space-tech environment',
      subject: 'rockets, satellites, mission control, or spacecraft hardware matching the headline',
      textures: 'carbon fiber, brushed alloy, deep space shadows, controlled instrument lighting',
    };
  }

  if (containsAny(text, ['phone', 'iphone', 'android', 'pixel', 'mobile', 'watch', 'tablet'])) {
    return {
      scene: 'a premium consumer tech studio setting',
      subject: 'smartphones, wearables, or mobile-device hardware presented dramatically',
      textures: 'glass, anodized metal, matte black backdrops, soft reflections',
    };
  }

  return {
    scene: 'a dark, premium technology editorial scene that literally reflects the headline',
    subject: 'the central object, industry, or real-world scenario implied by the article headline',
    textures: 'charcoal materials, subtle industrial detail, cinematic light falloff',
  };
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function removeGeneratedImageFile(publicPath) {
  if (typeof publicPath !== 'string' || !publicPath.startsWith('/generated-images/')) return;

  const filename = path.basename(publicPath);
  const absolutePath = path.resolve(GENERATED_DIR, filename);
  const generatedRoot = path.resolve(GENERATED_DIR) + path.sep;
  if (!absolutePath.startsWith(generatedRoot)) return;

  try {
    fs.unlinkSync(absolutePath);
  } catch (_) {
    // Best-effort cleanup.
  }
}

function generatedFileExists(publicPath) {
  const filename = publicPath.split('/').pop();
  if (!filename) return false;
  return fs.existsSync(path.join(GENERATED_DIR, filename));
}

module.exports = { generateArticleImage };
