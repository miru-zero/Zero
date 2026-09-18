const fs = require('node:fs');

exports.loadAccessToken = (env = process.env, authFile) => {
  const envToken = env.ZERO_CHATGPT_ACCESS_TOKEN;
  if (typeof envToken === 'string' && envToken.trim()) {
    return {
      token: envToken.trim(),
      tokenName: env.ZERO_CHATGPT_TOKEN_NAME || 'env',
      source: 'env'
    };
  }

  if (!authFile || !fs.existsSync(authFile)) {
    return { token: null, tokenName: null, source: 'none' };
  }

  try {
    const data = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (typeof data.accessToken === 'string' && data.accessToken.trim()) {
      return {
        token: data.accessToken.trim(),
        tokenName: data.tokenName || 'default',
        source: 'file'
      };
    }
  } catch {
    return { token: null, tokenName: null, source: 'invalid-file' };
  }
  return { token: null, tokenName: null, source: 'none' };
};
