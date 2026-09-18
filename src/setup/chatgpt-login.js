const authLoader = require('../core/auth-loader');
const authStatus = require('../core/auth-status');
const sessionContext = require('../core/session-context');
const chatgptClient = require('../providers/chatgpt/chatgpt-client');

exports.verify = async ({ authFile, sessionFile, env = process.env, requestJson }) => {
  const loaded = authLoader.loadAccessToken(env, authFile);
  const inspected = authStatus.inspectAccessToken(loaded.token);
  if (inspected.status !== 'VALID') {
    return { status: `TOKEN_${inspected.status}`, httpStatus: null };
  }

  const session = sessionContext.load(sessionFile);
  if (session.status !== 'READY') {
    return { status: `SESSION_${session.status}`, httpStatus: null };
  }

  const request = requestJson || chatgptClient.requestJson;
  const response = await request('/backend-api/me', loaded.token, session.headers);
  if (response.status === 200 && response.json && typeof response.json === 'object') {
    return {
      status: 'VERIFIED',
      httpStatus: 200,
      tokenName: loaded.tokenName || 'default',
      profile: { id: response.json.id || null, name: response.json.name || null }
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: 'REJECTED', httpStatus: response.status, tokenName: loaded.tokenName || 'default' };
  }

  return { status: 'ERROR', httpStatus: response.status || null, tokenName: loaded.tokenName || 'default' };
};
