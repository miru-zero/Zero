const path = require('node:path');
const authLoader = require('../core/auth-loader');
const authStatus = require('../core/auth-status');
const sessionContext = require('../core/session-context');
const chatRuntime = require('../llm/chat-runtime');

const defaultAuthFile = () => path.resolve(__dirname, '../../runtime/auth-context.json');
const defaultSessionFile = () => path.resolve(__dirname, '../../runtime/session-context.json');

exports.loadContext = ({
  env = process.env,
  authFile = env.ZERO_CHATGPT_AUTH_FILE || defaultAuthFile(),
  sessionFile = env.ZERO_CHATGPT_SESSION_FILE || defaultSessionFile(),
  loadAccessToken = authLoader.loadAccessToken,
  inspectAccessToken = authStatus.inspectAccessToken,
  readSession = sessionContext.read
} = {}) => {
  const loaded = loadAccessToken(env, authFile);
  const inspected = inspectAccessToken(loaded.token);
  if (inspected.status !== 'VALID') {
    const error = new Error(`ChatGPT auth is ${inspected.status}`);
    error.code = 'AUTH_NOT_READY';
    throw error;
  }
  const session = readSession(sessionFile);
  if (session.status !== 'READY') {
    const error = new Error(`ChatGPT session is ${session.status}`);
    error.code = 'SESSION_NOT_READY';
    throw error;
  }

  return {
    token: loaded.token,
    sessionHeaders: session.headers || {}
  };
};

exports.createCompleteChat = ({
  env = process.env,
  loadContext = exports.loadContext,
  complete = chatRuntime.complete
} = {}) => async ({ model, messages, conversationId = null, tools = [], onChunk = null }) => {
  const context = loadContext({ env });
  return complete({ model, messages, context, conversationId, tools, onChunk });
};
