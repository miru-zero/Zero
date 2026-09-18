const fs = require('node:fs');
const https = require('node:https');
const sessionContext = require('./session-context');

// auth store ชุดเดียวของ zero: runtime/auth-context.json (token) + runtime/session-context.json (cookie)
// logic ยกมาจาก puperteer_GPT3.1/core/miru_func.js refreshTokenWithCookies
// แต่ cookie ของ zero เป็น string ใน session-context headers.Cookie อยู่แล้ว ไม่ต้องแปลง jar ใหม่

const DEFAULT_SESSION_URL = 'https://chatgpt.com/api/auth/session';

const parseSetCookies = (setCookie) => {
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  const pairs = [];
  for (const entry of list) {
    const first = String(entry).split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) pairs.push([first.slice(0, eq).trim(), first.slice(eq + 1).trim()]);
  }
  return pairs;
};

exports.mergeSetCookies = (cookieString, setCookie) => {
  const jar = new Map();
  for (const pair of String(cookieString || '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  let changed = false;
  for (const [name, value] of parseSetCookies(setCookie)) {
    if (jar.get(name) !== value) {
      jar.set(name, value);
      changed = true;
    }
  }
  return { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), changed };
};

const defaultRequest = (url, headers) => new Promise((resolve, reject) => {
  const req = https.request(url, { method: 'GET', headers }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      let json = null;
      try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* เก็บ null ไว้ */ }
      resolve({ status: res.statusCode, json, headers: { ...res.headers } });
    });
  });
  req.on('error', reject);
  req.end();
});

// คืน { status: 'REFRESHED' | 'NO_SESSION' | 'SESSION_DEAD' | 'FAILED' | 'ERROR', ... }
// REFRESHED: เขียน token ใหม่ทับ authFile (คง tokenName/field เดิม) + merge set-cookie กลับ sessionFile ถ้ามี
exports.refreshAccessToken = async (options = {}) => {
  const { authFile, sessionFile } = options;
  const sessionUrl = options.sessionUrl || process.env.ZERO_CHATGPT_AUTH_SESSION_URL || DEFAULT_SESSION_URL;
  const requestImpl = options.requestImpl || defaultRequest;
  const nowIso = options.nowIso || (() => new Date().toISOString());

  if (!authFile || !sessionFile) {
    return { status: 'FAILED', reason: 'MISSING_FILES' };
  }

  const session = sessionContext.read(sessionFile);
  if (session.status !== 'READY') {
    return { status: 'NO_SESSION', sessionStatus: session.status };
  }

  const headers = { accept: 'application/json', Cookie: session.cookie };
  if (session.headers['user-agent']) headers['user-agent'] = session.headers['user-agent'];

  let response;
  try {
    response = await requestImpl(sessionUrl, headers);
  } catch (error) {
    return { status: 'ERROR', error: error.message };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'SESSION_DEAD', httpStatus: response.status };
  }
  if (response.status !== 200 || !response.json || typeof response.json.accessToken !== 'string' || !response.json.accessToken) {
    return { status: 'FAILED', httpStatus: response.status };
  }

  let authData = {};
  try {
    authData = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  } catch { /* ไฟล์เดิมพัง/ไม่มี — สร้างใหม่จากศูนย์ */ }
  authData.accessToken = response.json.accessToken;
  authData.updatedAt = nowIso();
  fs.writeFileSync(authFile, JSON.stringify(authData, null, 2) + '\n', 'utf8');

  let cookieRotated = false;
  const setCookie = response.headers && response.headers['set-cookie'];
  if (setCookie) {
    const merged = exports.mergeSetCookies(session.cookie, setCookie);
    if (merged.changed) {
      try {
        const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        if (sessionData.headers && typeof sessionData.headers === 'object') {
          sessionData.headers.Cookie = merged.cookie;
          delete sessionData.headers.cookie;
        } else {
          sessionData.cookie = merged.cookie;
        }
        fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2) + '\n', 'utf8');
        cookieRotated = true;
      } catch { /* cookie rotate ไม่สำเร็จไม่ถือว่า refresh ล้ม */ }
    }
  }

  return {
    status: 'REFRESHED',
    token: response.json.accessToken,
    expires: response.json.expires || null,
    user: response.json.user || null,
    cookieRotated
  };
};
