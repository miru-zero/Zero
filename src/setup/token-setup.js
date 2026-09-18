const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

exports.buildSetupText = (useColor = false) => {
  const purple = useColor ? '\x1b[95m' : '';
  const cyan = useColor ? '\x1b[96m' : '';
  const reset = useColor ? '\x1b[0m' : '';

  return [
    `${purple}──────────────────────── Token Setup ────────────────────────${reset}`,
    '',
    '  Add New Access Token',
    '',
    '  Store your ChatGPT access token for use with Zero-ChatGPT.',
    '',
    `${purple}──────────────────────── Instructions ───────────────────────${reset}`,
    '',
    '  How to get your access token:',
    `  1. Open ${cyan}https://chatgpt.com/api/auth/session${reset}`,
    '  2. Copy the returned accessToken value',
    '',
    "  The token should normally start with 'eyJ'.",
    ''
  ].join('\n');
};

exports.saveAccessToken = (authFile, tokenName, token) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  const data = {
    tokenName: tokenName || 'default',
    accessToken: token.trim(),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(authFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { saved: true, tokenName: data.tokenName };
};

exports.promptAccessToken = async (input = process.stdin, output = process.stdout) => {
  output.write(`${exports.buildSetupText(Boolean(output.isTTY))}\n`);
  const rl = readline.createInterface({ input, output });

  try {
    const tokenNameInput = await rl.question('Token Name (default): ');
    const accessTokenInput = await rl.question('Access Token: ');
    return {
      tokenName: tokenNameInput.trim() || 'default',
      token: accessTokenInput.trim()
    };
  } finally {
    rl.close();
  }
};
