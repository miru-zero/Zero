const path = require('node:path');
const authLoader = require('./core/auth-loader');
const authStatus = require('./core/auth-status');
const tokenSetup = require('./setup/token-setup');
const loginMenu = require('./setup/login-menu');
const chatgptLogin = require('./setup/chatgpt-login');

exports.resolveAuthFile = (env = process.env) => {
  if (env.ZERO_CHATGPT_AUTH_FILE) {
    return path.resolve(env.ZERO_CHATGPT_AUTH_FILE);
  }
  return path.resolve(__dirname, '../runtime/auth-context.json');
};

exports.resolveSessionFile = (env = process.env) => {
  if (env.ZERO_CHATGPT_SESSION_FILE) {
    return path.resolve(env.ZERO_CHATGPT_SESSION_FILE);
  }
  return path.resolve(__dirname, '../runtime/session-context.json');
};

exports.start = (env = process.env) => {
  console.log('[Zero-ChatGPT] Starting...');

  const authFile = exports.resolveAuthFile(env);
  const loaded = authLoader.loadAccessToken(env, authFile);
  const result = authStatus.inspectAccessToken(loaded.token);

  console.log(`[Auth] accessToken: ${result.status}`);
  console.log(`[Auth] source: ${loaded.source}`);

  if (Number.isFinite(result.remainingSeconds)) {
    console.log(`[Auth] remaining: ${result.remainingSeconds}s`);
  }

  if (result.status === 'VALID') {
    console.log('[Zero-ChatGPT] authentication ready');
    return {
      exitCode: 0,
      auth: result,
      source: loaded.source,
      authFile,
      tokenName: loaded.tokenName || 'default'
    };
  }

  if (result.status === 'MISSING') {
    console.log('[Zero-ChatGPT] authentication required');
    return { exitCode: 2, auth: result, source: loaded.source, authFile };
  }

  if (result.status === 'EXPIRED') {
    console.log('[Zero-ChatGPT] authentication expired');
    return { exitCode: 3, auth: result, source: loaded.source, authFile };
  }

  console.log(`[Zero-ChatGPT] authentication invalid${result.reason ? ` (${result.reason})` : ''}`);
  return { exitCode: 4, auth: result, source: loaded.source, authFile };
};

exports.openLoginMenu = async (
  state,
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  dependencies = {}
) => {
  const menu = await loginMenu.promptLoginMenu(input, output, state.tokenName || 'default');
  if (menu.selection !== '1') return { ...state, menuSelection: menu.selection };

  const verifyLogin = dependencies.verifyLogin || chatgptLogin.verify;
  const chatgpt = await verifyLogin({
    authFile: state.authFile,
    sessionFile: exports.resolveSessionFile(env),
    env
  });

  if (chatgpt.status === 'VERIFIED') {
    output.write(`\n[ChatGPT] LOGIN VERIFIED (${chatgpt.httpStatus})\n`);
  } else {
    output.write(`\n[ChatGPT] LOGIN ${chatgpt.status}${chatgpt.httpStatus ? ` (${chatgpt.httpStatus})` : ''}\n`);
  }
  return { ...state, menuSelection: menu.selection, chatgpt };
};

exports.run = async (env = process.env, input = process.stdin, output = process.stdout, dependencies = {}) => {
  const result = exports.start(env);

  if (result.auth.status === 'VALID') {
    if (!input.isTTY || !output.isTTY) return result;
    return exports.openLoginMenu(result, env, input, output, dependencies);
  }

  if (result.auth.status !== 'MISSING') return result;
  if (!input.isTTY || !output.isTTY) return result;

  const entered = await tokenSetup.promptAccessToken(input, output);
  const inspected = authStatus.inspectAccessToken(entered.token);
  if (inspected.status !== 'VALID') {
    output.write(`\n[Auth] provided accessToken: ${inspected.status}\n`);
    return { exitCode: inspected.status === 'EXPIRED' ? 3 : 4, auth: inspected };
  }

  tokenSetup.saveAccessToken(result.authFile, entered.tokenName, entered.token);
  output.write(`\n[Auth] accessToken saved as ${entered.tokenName}\n`);
  output.write(`[Auth] remaining: ${inspected.remainingSeconds}s\n`);
  output.write('[Zero-ChatGPT] authentication ready\n\n');

  return exports.openLoginMenu({
    exitCode: 0,
    auth: inspected,
    source: 'file',
    authFile: result.authFile,
    tokenName: entered.tokenName
  }, env, input, output, dependencies);
};

if (require.main === module) {
  exports.run()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(`[Zero-ChatGPT] fatal: ${error.message}`);
      process.exitCode = 1;
    });
}
