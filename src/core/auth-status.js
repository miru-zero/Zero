exports.inspectAccessToken = (input, nowEpochSeconds = Math.floor(Date.now() / 1000)) => {
  if (typeof input !== 'string' || !input.trim()) {
    return { status: 'MISSING', tokenPresent: false };
  }

  const token = input.trim().replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { status: 'INVALID', tokenPresent: true, reason: 'MALFORMED_JWT' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { status: 'INVALID', tokenPresent: true, reason: 'MALFORMED_JWT' };
  }

  if (!Number.isFinite(payload.exp)) {
    return { status: 'INVALID', tokenPresent: true, reason: 'MISSING_EXP' };
  }

  const remainingSeconds = Math.floor(payload.exp - nowEpochSeconds);
  return {
    status: remainingSeconds <= 0 ? 'EXPIRED' : 'VALID',
    tokenPresent: true,
    expiresAt: payload.exp,
    remainingSeconds
  };
};
