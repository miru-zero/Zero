const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const scriptsDefault = 'https://chatgpt.com/backend-api/sentinel/sdk.js';
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const config = (ua, scripts = [scriptsDefault], build = '') => {
  const perf = performance.now();
  return [
    pick([3000, 4000, 5000]),
    new Date().toString(),
    4294705152, 1, ua, pick(scripts.length ? scripts : [scriptsDefault]), build,
    'en-US', 'en-US,es-US,en,es', Math.random(),
    pick(['webdriver-false','vendor-Google Inc.','hardwareConcurrency-32','pdfViewerEnabled-true']),
    pick(['location','documentURI','compatMode']),
    pick(['window','self','document','location','navigator','performance','crypto','fetch']),
    perf, crypto.randomUUID(), '', pick([8,16,24,32]), Date.now() - perf,
    0,0,0,0,0,0,0
  ];
};

exports.buildRequirementsToken = (ua, scripts, build) => 'gAAAAAC' + b64(config(ua, scripts, build));

exports.buildProofToken = (seed, difficulty, ua, scripts, build) => {
  const target = Buffer.from(String(difficulty || '0'), 'hex');
  const value = config(ua, scripts, build);
  for (let i = 0; i < 500000; i += 1) {
    value[3] = i; value[9] = i >> 1;
    const encoded = b64(value);
    const digest = crypto.createHash('sha3-512').update(String(seed)).update(encoded).digest();
    if (Buffer.compare(digest.subarray(0, target.length), target) <= 0) return 'gAAAAAB' + encoded;
  }
  throw new Error('failed to solve sentinel proof');
};

// Contract จาก captures_live 2026-09-13:
//   POST /backend-api/sentinel/chat-requirements/prepare  {p: gAAAAAC...} -> {prepare_token, persona}
//   POST /backend-api/sentinel/chat-requirements/finalize {prepare_token} -> {token, persona}
const REQUIREMENTS_PREPARE = '/backend-api/sentinel/chat-requirements/prepare';
const REQUIREMENTS_FINALIZE = '/backend-api/sentinel/chat-requirements/finalize';

const requireStep = (response, step) => {
  if (!response || response.status !== 200 || !response.json) {
    const error = new Error(`sentinel ${step} failed (${response?.status || 'no-status'})`);
    error.status = response?.status || null;
    throw error;
  }
  return response.json;
};

exports.fetchChatRequirements = async ({ token, sessionHeaders = {}, userAgent, requestJson }) => {
  if (typeof requestJson !== 'function') throw new Error('requestJson is required');
  const ua = userAgent || sessionHeaders['user-agent'] || sessionHeaders['User-Agent'] || '';
  const p = exports.buildRequirementsToken(ua);
  const prepare = requireStep(await requestJson(REQUIREMENTS_PREPARE, token, sessionHeaders, {
    method: 'POST', body: { p }, route: REQUIREMENTS_PREPARE
  }), 'prepare');
  if (!prepare.prepare_token) throw new Error('sentinel prepare missing prepare_token');
  const finalize = requireStep(await requestJson(REQUIREMENTS_FINALIZE, token, sessionHeaders, {
    method: 'POST', body: { prepare_token: prepare.prepare_token }, route: REQUIREMENTS_FINALIZE
  }), 'finalize');
  if (!finalize.token) throw new Error('sentinel finalize missing token');
  let proofToken = null;
  if (prepare.proofofwork?.required) {
    proofToken = exports.buildProofToken(prepare.proofofwork.seed, prepare.proofofwork.difficulty, ua);
  }
  return { token: finalize.token, persona: finalize.persona || null, proofToken };
};
