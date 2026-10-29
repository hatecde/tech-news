const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchLimited, isPublicIp } = require('../services/safeFetch');

test('public IPv4 addresses are accepted', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34']) {
    assert.equal(isPublicIp(ip), true, ip);
  }
});

test('private, loopback, link-local, and reserved IPv4 addresses are rejected', () => {
  for (const ip of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '192.0.2.1', '198.19.0.1', '203.0.113.10',
    '224.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(isPublicIp(ip), false, ip);
  }
});

test('non-global IPv6 addresses are rejected and global unicast is accepted', () => {
  for (const ip of ['::', '::1', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('fetchLimited blocks private destinations before calling fetch', async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error('fetch should not be called for localhost');
  };

  try {
    await assert.rejects(
      fetchLimited('http://127.0.0.1/'),
      /Private or non-public destination/
    );
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchLimited enforces response-size limits while streaming', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('12345', {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
  });

  try {
    await assert.rejects(
      fetchLimited('https://1.1.1.1/image.jpg', {
        maxBytes: 4,
        acceptContentTypes: ['image/jpeg'],
      }),
      /Response exceeds size limit/
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchLimited validates redirect destinations', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    });
  };

  try {
    await assert.rejects(
      fetchLimited('https://1.1.1.1/redirect'),
      /Private or non-public destination/
    );
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
