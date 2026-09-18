const https = require('node:https');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_AFTER_CAP_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_MS = 1000;

exports.buildHeaders = (token, sessionHeaders, target, targetRoute) => {
  const targetPath = target.split('?')[0];
  return {
    ...sessionHeaders,
    authorization: `Bearer ${token}`,
    'x-openai-target-path': targetPath,
    'x-openai-target-route': targetRoute || targetPath
  };
};

exports.parseRetryAfterMs = (headers = {}) => {
  const raw = headers['retry-after'];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, RETRY_AFTER_CAP_MS);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), RETRY_AFTER_CAP_MS);
  return null;
};

const isRetriable = (status) => status === 429 || (status >= 500 && status < 600);

exports.withRetry = async (fn, options = {}) => {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const sleepImpl = options.sleepImpl || sleep;
  const retriable = options.retriable || isRetriable;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fn();
    if (!response || !retriable(response.status) || attempt >= maxRetries) return response;
    const waitMs = exports.parseRetryAfterMs(response.headers) ?? baseMs * 2 ** attempt;
    await sleepImpl(waitMs);
  }
};

const safeParse = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const rawRequest = (target, token, sessionHeaders, options, parseBody) => new Promise((resolve, reject) => {
  const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
  const headers = exports.buildHeaders(token, sessionHeaders, target, options.route);
  if (options.headers) Object.assign(headers, options.headers);
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(payload.length);
  }
  const req = https.request('https://chatgpt.com' + target, { method: options.method || 'GET', headers }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        ...(parseBody ? { json: safeParse(text) } : { text }),
        contentType: res.headers['content-type'] || null,
        headers: { ...res.headers }
      });
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

const retryOptionsOf = (options) => {
  if (options.retry === false) return null;
  const retry = options.retry && typeof options.retry === 'object' ? options.retry : {};
  return {
    maxRetries: retry.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseMs: retry.baseMs ?? DEFAULT_BASE_MS,
    sleepImpl: retry.sleepImpl
  };
};

exports.requestJson = (target, token, sessionHeaders, options = {}) => {
  const retry = retryOptionsOf(options);
  const run = () => rawRequest(target, token, sessionHeaders, options, true);
  return retry ? exports.withRetry(run, retry) : run();
};

exports.requestText = (target, token, sessionHeaders, options = {}) => {
  const retry = retryOptionsOf(options);
  const run = () => rawRequest(target, token, sessionHeaders, options, false);
  return retry ? exports.withRetry(run, retry) : run();
};
