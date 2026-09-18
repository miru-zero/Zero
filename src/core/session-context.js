const fs = require('node:fs');

exports.read = (sessionFile) => {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return { status: 'MISSING', cookie: null, headers: {}, source: 'none' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const headers = data.headers && typeof data.headers === 'object'
      ? { ...data.headers }
      : {};
    const rawCookie = typeof data.cookie === 'string'
      ? data.cookie
      : (headers.Cookie || headers.cookie || '');
    const cookie = typeof rawCookie === 'string' ? rawCookie.trim() : '';

    if (!cookie) {
      return { status: 'INVALID', cookie: null, headers, source: 'file' };
    }

    headers.Cookie = cookie;
    delete headers.cookie;
    return { status: 'READY', cookie, headers, source: 'file' };
  } catch {
    return { status: 'INVALID', cookie: null, headers: {}, source: 'invalid-file' };
  }
};

exports.load = (sessionFile) => exports.read(sessionFile);
exports.loadSessionContext = (env = process.env, sessionFile) => exports.read(sessionFile);
