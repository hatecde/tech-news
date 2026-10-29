function isUiRefreshRequest(req) {
  const origin = req.get('origin');
  const host = req.get('host');
  const action = req.get('x-techfeed-refresh-action');

  if (!origin || !host || action !== 'ui-button' || !req.is('application/json')) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    return (
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:') &&
      parsedOrigin.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

module.exports = { isUiRefreshRequest };
