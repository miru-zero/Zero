'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const runtimeFile = () => path.resolve(__dirname, '../runtime/devices.json');
exports.resolveFile = (env = process.env) => env.ZERO_DEVICE_REGISTRY_FILE
  ? path.resolve(env.ZERO_DEVICE_REGISTRY_FILE)
  : runtimeFile();

const nowIso = () => new Date().toISOString();
const secret = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const makeId = () => `dev_${crypto.randomUUID()}`;
const makePairingCode = () => `ZERO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const deviceKeyOf = (value = {}) => String(value.host || value.name || '').trim().toLowerCase();


const defaultState = (env = process.env) => ({
  pairing_code: env.ZERO_DEVICE_PAIRING_CODE || env.ZERO_PAIRING_CODE || makePairingCode(),
  devices: {},
  tasks: {}
});

exports.loadState = (env = process.env) => {
  const file = exports.resolveFile(env);
  if (!fs.existsSync(file)) return defaultState(env);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const state = {
    pairing_code: parsed.pairing_code || env.ZERO_DEVICE_PAIRING_CODE || env.ZERO_PAIRING_CODE || makePairingCode(),
    devices: parsed.devices || {},
    tasks: parsed.tasks || {}
  };
  return state;
};

exports.saveState = (state, env = process.env) => {
  const file = exports.resolveFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return state;
};

const httpErr = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const publicDevice = (device) => ({
  device_id: device.device_id,
  name: device.name,
  host: device.host || null,
  status: device.status || 'registered',
  created_at: device.created_at,
  updated_at: device.updated_at,
  paired_at: device.paired_at || null,
  last_seen: device.last_seen || null,
  provider_count: device.provider_count || 0,
  capability_hash: device.capability_hash || null,
  capability: device.capability ? {
    provider_count: Array.isArray(device.capability.providers) ? device.capability.providers.length : 0,
    capability_hash: device.capability.capability_hash || null,
    updated_at: device.capability.updated_at || null
  } : null
});

const requireDevice = (state, id, token) => {
  const device = state.devices[id];
  if (!device) throw httpErr(404, 'DEVICE_NOT_FOUND', 'device not found');
  if (!token || token !== device.device_token) {
    throw httpErr(401, 'DEVICE_UNAUTHORIZED', 'unauthorized device token');
  }
  return device;
};

exports.registerDevice = (payload = {}, env = process.env) => {
  const state = exports.loadState(env);
  if (!payload.pairing_code || payload.pairing_code !== state.pairing_code) {
    throw httpErr(403, 'BAD_PAIRING_CODE', 'invalid pairing code');
  }
  const at = nowIso();
  const name = String(payload.name || payload.host || 'device');
  const host = payload.host ? String(payload.host) : null;
  const key = deviceKeyOf({ name, host });
  const existing = Object.values(state.devices || {})
    .find((item) => deviceKeyOf(item) === key);
  const device = existing || {
    device_id: makeId(),
    created_at: at,
    last_seen: null,
    provider_count: 0,
    capability_hash: null,
    capability: null
  };
  device.device_token = secret();
  device.name = name;
  device.host = host;
  device.device_key = key;
  device.status = 'paired';
  device.updated_at = at;
  device.paired_at = at;
  state.devices[device.device_id] = device;
  exports.saveState(state, env);
  return { ok: true, device_id: device.device_id, device_token: device.device_token, device: publicDevice(device) };
};

exports.heartbeatDevice = (id, token, payload = {}, env = process.env) => {
  const state = exports.loadState(env);
  const device = requireDevice(state, id, token);
  const at = nowIso();
  device.status = String(payload.status || 'online');
  device.last_seen = payload.last_seen || at;
  device.updated_at = at;
  device.provider_count = Number(payload.provider_count || device.provider_count || 0);
  device.capability_hash = payload.capability_hash || device.capability_hash || null;
  exports.saveState(state, env);
  return { ok: true, device: publicDevice(device) };
};

exports.saveCapabilities = (id, token, capability = {}, env = process.env) => {
  const state = exports.loadState(env);
  const device = requireDevice(state, id, token);
  const at = nowIso();
  device.capability = { ...capability, updated_at: at };
  device.provider_count = Array.isArray(capability.providers) ? capability.providers.length : device.provider_count || 0;
  device.capability_hash = capability.capability_hash || device.capability_hash || null;
  device.updated_at = at;
  exports.saveState(state, env);
  return { ok: true, device: publicDevice(device) };
};

exports.createTask = (payload = {}, env = process.env) => {
  const state = exports.loadState(env);
  const device = findDevicePrivate(state, payload);
  if (!device) throw httpErr(404, 'DEVICE_NOT_FOUND', 'device not found');
  if (!payload.tool) throw httpErr(400, 'TASK_TOOL_REQUIRED', 'task tool is required');
  const at = nowIso();
  const task = {
    task_id: 'task_' + crypto.randomUUID(),
    device_id: device.device_id,
    tool: String(payload.tool),
    arguments: payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {},
    status: 'queued',
    created_at: at,
    updated_at: at,
    result: undefined,
    error: null
  };
  state.tasks[task.task_id] = task;
  exports.saveState(state, env);
  return { ok: true, task: publicTask(task), device: publicDevice(device) };
};


exports.takeNextTask = (id, bearer, env = process.env) => {
  const state = exports.loadState(env);
  const device = requireDevice(state, id, bearer);
  const task = Object.values(state.tasks || {})
    .filter((item) => item.device_id === device.device_id && item.status === 'queued')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;
  if (!task) return { ok: true, task: null };
  const at = nowIso();
  task.status = 'running';
  task.started_at = at;
  task.updated_at = at;
  exports.saveState(state, env);
  return { ok: true, task: publicTask(task) };
};

exports.completeTask = (id, bearer, taskId, payload = {}, env = process.env) => {
  const state = exports.loadState(env);
  const device = requireDevice(state, id, bearer);
  const task = state.tasks?.[taskId];
  if (!task || task.device_id !== device.device_id) throw httpErr(404, 'TASK_NOT_FOUND', 'task not found');
  const at = nowIso();
  task.status = payload.ok === false ? 'failed' : 'done';
  task.updated_at = at;
  task.finished_at = at;
  task.result = payload.result;
  task.error = payload.error || null;
  exports.saveState(state, env);
  return { ok: true, task: publicTask(task) };
};


exports.getTask = (taskId, env = process.env) => {
  const state = exports.loadState(env);
  const task = state.tasks?.[taskId] || null;
  if (!task) throw httpErr(404, 'TASK_NOT_FOUND', 'task not found');
  return { ok: true, task: publicTask(task) };
};

exports.waitTask = async (taskId, waitMs = 15000, env = process.env) => {
  const deadline = Date.now() + Math.max(0, Math.min(Number(waitMs) || 0, 60000));
  while (true) {
    const current = exports.getTask(taskId, env).task;
    if (current.status === 'done' || current.status === 'failed') return { ok: current.status === 'done', task: current };
    if (Date.now() >= deadline) return { ok: false, timeout: true, task: current };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

exports.listDevices = (env = process.env) => {
  const state = exports.loadState(env);
  const devices = Object.values(state.devices).map(publicDevice)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    ok: true,
    total: devices.length,
    online: devices.filter((item) => item.status === 'online').length,
    devices
  };
};


const publicTask = (task) => ({
  task_id: task.task_id,
  device_id: task.device_id,
  tool: task.tool,
  arguments: task.arguments || {},
  status: task.status,
  created_at: task.created_at,
  updated_at: task.updated_at || null,
  started_at: task.started_at || null,
  finished_at: task.finished_at || null,
  result: task.result,
  error: task.error || null
});

const findDevicePrivate = (state, args = {}) => {
  const devices = Object.values(state.devices || {});
  if (args.device_id) return state.devices[args.device_id] || null;
  if (args.name) {
    const matches = devices.filter((item) => item.name === args.name || item.host === args.name);
    if (matches.length > 1) throw httpErr(409, 'DEVICE_AMBIGUOUS', 'multiple devices match name: ' + args.name);
    return matches[0] || null;
  }
  throw httpErr(400, 'DEVICE_REQUIRED', 'device_id or name is required');
};

exports.pairingInfo = (env = process.env) => {
  const state = exports.loadState(env);
  exports.saveState(state, env);
  return { ok: true, pairing_code: state.pairing_code };
};

exports.rotatePairingCode = (env = process.env) => {
  const state = exports.loadState(env);
  state.pairing_code = makePairingCode();
  exports.saveState(state, env);
  return { ok: true, pairing_code: state.pairing_code };
};

exports.tokenFromRequest = (req) => {
  const value = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
};
