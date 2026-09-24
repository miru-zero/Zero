'use strict';

const requestJson = async (url, { method = 'GET', token = null, body = null, timeoutMs = 15000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: 'application/json' };
    if (body !== null) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { ok: response.ok, status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { requestJson };
