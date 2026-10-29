const dns = require('node:dns').promises;
const net = require('node:net');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_CONCURRENT_REQUESTS = boundedInteger(process.env.MAX_CONCURRENT_OUTBOUND_FETCHES, 8, 1, 32);
const MAX_QUEUED_REQUESTS = 64;
let activeRequests = 0;
const requestQueue = [];

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function fetchLimited(input, {
  headers = {},
  timeoutMs = 8000,
  maxBytes = 1_500_000,
  maxRedirects = 3,
  acceptContentTypes = null,
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let acquiredSlot = false;

  try {
    await acquireRequestSlot(controller.signal);
    acquiredSlot = true;
    let currentUrl = await validatePublicUrl(input);
    if (controller.signal.aborted) throw new Error('Outbound request timed out');

    for (let redirects = 0; ; redirects += 1) {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (response.body) await response.body.cancel().catch(() => {});
        if (!location || redirects >= maxRedirects) {
          throw new Error('Too many or invalid redirects');
        }
        currentUrl = await validatePublicUrl(new URL(location, currentUrl));
        if (controller.signal.aborted) throw new Error('Outbound request timed out');
        continue;
      }

      const contentType = (response.headers.get('content-type') || '')
        .split(';')[0].trim().toLowerCase();

      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => {});
        return { ok: false, status: response.status, contentType, body: Buffer.alloc(0), url: currentUrl.href };
      }

      if (acceptContentTypes && !acceptContentTypes.some((allowed) => (
        allowed.endsWith('/*')
          ? contentType.startsWith(allowed.slice(0, -1))
          : contentType === allowed
      ))) {
        if (response.body) await response.body.cancel().catch(() => {});
        throw new Error(`Unexpected content type: ${contentType || 'unknown'}`);
      }

      const lengthHeader = response.headers.get('content-length');
      const contentLength = lengthHeader === null ? NaN : Number(lengthHeader);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        if (response.body) await response.body.cancel().catch(() => {});
        throw new Error('Response exceeds size limit');
      }

      return {
        ok: true,
        status: response.status,
        contentType,
        body: await readLimitedBody(response, maxBytes),
        url: currentUrl.href,
      };
    }
  } finally {
    clearTimeout(timeout);
    if (acquiredSlot) releaseRequestSlot();
  }
}

function acquireRequestSlot(signal) {
  if (signal.aborted) {
    return Promise.reject(new Error('Outbound request timed out while queued'));
  }

  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return Promise.resolve();
  }

  if (requestQueue.length >= MAX_QUEUED_REQUESTS) {
    return Promise.reject(new Error('Outbound request queue is full'));
  }

  return new Promise((resolve, reject) => {
    const waiter = { signal, resolve, reject, onAbort: null };
    waiter.onAbort = () => {
      const index = requestQueue.indexOf(waiter);
      if (index !== -1) requestQueue.splice(index, 1);
      reject(new Error('Outbound request timed out while queued'));
    };

    requestQueue.push(waiter);
    signal.addEventListener('abort', waiter.onAbort, { once: true });
  });
}

function releaseRequestSlot() {
  while (requestQueue.length > 0) {
    const next = requestQueue.shift();
    next.signal.removeEventListener('abort', next.onAbort);

    if (next.signal.aborted) {
      next.reject(new Error('Outbound request timed out while queued'));
      continue;
    }

    // Transfer the released slot; the active count stays unchanged.
    next.resolve();
    return;
  }

  activeRequests = Math.max(0, activeRequests - 1);
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Response exceeds size limit');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    reader.releaseLock();
  }
}

async function validatePublicUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are permitted');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not permitted');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    throw new Error('Private network destinations are not permitted');
  }

  let addresses;
  try {
    const family = net.isIP(hostname);
    addresses = family ? [{ address: hostname, family }] : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not resolve destination hostname');
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error('Private or non-public destination is not permitted');
  }
  return url;
}

function isPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const groups = expandIpv6(address);
    if (!groups) return false;
    if (groups.every((group) => group === 0)) return false;
    if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false;
    const first = groups[0];
    const second = groups[1];
    if (first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
    if (first === 0x2002) return false;
    return true;
  }
  return false;
}

function expandIpv6(address) {
  const value = address.toLowerCase();
  if (value.includes('.')) return null;
  const parts = value.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((parts.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

module.exports = { fetchLimited, isPublicIp };
