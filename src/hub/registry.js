// zero tools hub config loader — ลำดับ: ZERO_CONFIG_FILE env → runtime/zero.config.json → config/zero.config.example.json
const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_CONFIG = path.resolve(__dirname, '../../runtime/zero.config.json');
const EXAMPLE_CONFIG = path.resolve(__dirname, '../../config/zero.config.example.json');

exports.resolveConfigFile = (env = process.env) => {
  if (env.ZERO_CONFIG_FILE) return path.resolve(env.ZERO_CONFIG_FILE);
  if (fs.existsSync(RUNTIME_CONFIG)) return RUNTIME_CONFIG;
  return EXAMPLE_CONFIG;
};

exports.loadConfig = (env = process.env) => {
  const file = exports.resolveConfigFile(env);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`zero config อ่านไม่ได้: ${file} (${error.message})`), { code: 'CONFIG_INVALID' });
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.providers !== 'object' || parsed.providers === null) {
    throw Object.assign(new Error(`zero config ต้องมี "providers" object: ${file}`), { code: 'CONFIG_INVALID' });
  }
  return { file, providers: parsed.providers };
};
