'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const defaultHome = () => path.join(os.homedir(), '.zero-agent');

const agentHome = (env = process.env) => path.resolve(env.ZERO_AGENT_HOME || defaultHome());
const deviceFile = (env = process.env) => path.join(agentHome(env), 'device.json');
const logDir = (env = process.env) => path.join(agentHome(env), 'logs');

const ensureDirs = (env = process.env) => {
  fs.mkdirSync(agentHome(env), { recursive: true });
  fs.mkdirSync(logDir(env), { recursive: true });
};

const readJson = (file, fallback = null) => {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
};

const loadDevice = (env = process.env) => readJson(deviceFile(env), null);

const saveDevice = (device, env = process.env) => {
  ensureDirs(env);
  writeJson(deviceFile(env), device);
  return deviceFile(env);
};

const redactedDevice = (device) => {
  if (!device) return null;
  const clone = { ...device };
  if (clone.device_token) clone.device_token = 'REDACTED';
  if (clone.token) clone.token = 'REDACTED';
  return clone;
};
module.exports = {
  agentHome,
  deviceFile,
  logDir,
  ensureDirs,
  readJson,
  writeJson,
  loadDevice,
  saveDevice,
  redactedDevice
};
