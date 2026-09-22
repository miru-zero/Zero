// zero tools hub config loader — ลำดับ: ZERO_CONFIG_FILE env → runtime/zero.config.json → config/zero.config.example.json
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RUNTIME_CONFIG = path.resolve(REPO_ROOT, 'runtime/zero.config.json');
const EXAMPLE_CONFIG = path.resolve(REPO_ROOT, 'config/zero.config.example.json');

exports.resolveConfigFile = (env = process.env) => {
  if (env.ZERO_CONFIG_FILE) return path.resolve(env.ZERO_CONFIG_FILE);
  if (fs.existsSync(RUNTIME_CONFIG)) return RUNTIME_CONFIG;
  return EXAMPLE_CONFIG;
};

exports.loadProviderManifests = (mcpRoot) => {
  if (!mcpRoot) return {};
  const providersDir = path.join(mcpRoot, 'providers');
  if (!fs.existsSync(providersDir)) return {};
  const providers = {};
  for (const entry of fs.readdirSync(providersDir, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const providerRoot = path.join(providersDir, entry.name);
    const manifestFile = path.join(providerRoot, 'provider.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      throw Object.assign(new Error(`provider manifest อ่านไม่ได้: ${manifestFile} (${error.message})`), { code: 'CONFIG_INVALID' });
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.type || (manifest.name && manifest.name !== entry.name)) {
      throw Object.assign(new Error(`provider manifest ไม่ถูกต้อง: ${manifestFile}`), { code: 'CONFIG_INVALID' });
    }
    providers[entry.name] = { ...manifest, providerRoot };
  }
  return providers;
};

exports.loadConfig = (env = process.env) => {
  const file = exports.resolveConfigFile(env);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`zero config อ่านไม่ได้: ${file} (${error.message})`), { code: 'CONFIG_INVALID' });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw Object.assign(new Error(`zero config ไม่ถูกต้อง: ${file}`), { code: 'CONFIG_INVALID' });
  }
  const rawMcpRoot = env.ZERO_MCP_ROOT || parsed.mcpRoot || null;
  const expandedMcpRoot = typeof rawMcpRoot === 'string' ? rawMcpRoot.replaceAll('{root}', REPO_ROOT.replace(/\\/g, '/')) : rawMcpRoot;
  const mcpRoot = expandedMcpRoot ? path.resolve(expandedMcpRoot) : null;
  const declaredProviders = parsed.providers === undefined ? {} : parsed.providers;
  if (typeof declaredProviders !== 'object' || declaredProviders === null || (!mcpRoot && parsed.providers === undefined)) {
    throw Object.assign(new Error(`zero config ต้องมี "providers" object หรือ "mcpRoot": ${file}`), { code: 'CONFIG_INVALID' });
  }
  const manifests = exports.loadProviderManifests(mcpRoot);
  return { file, mcpRoot, providers: { ...declaredProviders, ...manifests } };
};
