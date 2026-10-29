const test = require('node:test');
const assert = require('node:assert/strict');
const { isUiRefreshRequest } = require('../services/refreshGuard');

function makeRequest({
  origin = 'http://localhost:3000',
  host = 'localhost:3000',
  action = 'ui-button',
  contentType = 'application/json',
} = {}) {
  const headers = { origin, host, 'x-techfeed-refresh-action': action };

  return {
    get(name) {
      return headers[name.toLowerCase()];
    },
    is(expectedType) {
      return contentType === expectedType ? expectedType : false;
    },
  };
}

test('accepts the same-origin UI refresh action', () => {
  assert.equal(isUiRefreshRequest(makeRequest()), true);
});

test('rejects a missing origin or action marker', () => {
  assert.equal(isUiRefreshRequest(makeRequest({ origin: null })), false);
  assert.equal(isUiRefreshRequest(makeRequest({ action: null })), false);
});

test('rejects cross-origin and malformed origins', () => {
  assert.equal(isUiRefreshRequest(makeRequest({ origin: 'https://attacker.example' })), false);
  assert.equal(isUiRefreshRequest(makeRequest({ origin: 'not a URL' })), false);
});

test('requires JSON request content', () => {
  assert.equal(isUiRefreshRequest(makeRequest({ contentType: 'application/x-www-form-urlencoded' })), false);
});
