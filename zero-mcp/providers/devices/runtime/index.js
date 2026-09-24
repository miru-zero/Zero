'use strict';

const path = require('node:path');

const coreRoot = process.env.ZERO_CORE_ROOT || path.resolve(__dirname, '..', '..', '..', 'zero-core');
const registry = require(path.join(coreRoot, 'src', 'core', 'device-registry'));

const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false
});

const TOOLS = [
  ['list', 'List paired Zero devices from the server device registry.'],
  ['status', 'Get one paired Zero device by device_id or name.'],
  ['heartbeat', 'Summarize the latest heartbeat state for one Zero device.'],
  ['exec', 'Queue a safe command tool on a paired Zero agent device and wait for the result.']
];
const toolSchemas = {
  list: schema({
    onlineOnly: { type: 'boolean', default: false }
  }),
  status: schema({
    device_id: { type: 'string' },
    name: { type: 'string' }
  }),
  heartbeat: schema({
    device_id: { type: 'string' },
    name: { type: 'string' }
  }),
  exec: schema({
    device_id: { type: 'string' },
    name: { type: 'string' },
    tool: { type: 'string' },
    arguments: { type: 'object', additionalProperties: true },
    waitMs: { type: 'integer', minimum: 0, maximum: 60000, default: 15000 }
  }, ['tool'])
};

const err = (code, message) => Object.assign(new Error(message), { code });
const envOf = (context = {}) => context.env || process.env;

const findDevice = (args = {}, env = process.env) => {
  const devices = registry.listDevices(env).devices;
  if (args.device_id) return devices.find((item) => item.device_id === args.device_id);
  if (args.name) return devices.find((item) => item.name === args.name || item.host === args.name);
  return devices[0];
};

const list = (args = {}, context = {}) => {
  const result = registry.listDevices(envOf(context));
  const devices = args.onlineOnly
    ? result.devices.filter((item) => item.status === 'online')
    : result.devices;
  return {
    ...result,
    total: devices.length,
    online: devices.filter((item) => item.status === 'online').length,
    devices
  };
};

const status = (args = {}, context = {}) => {
  const device = findDevice(args, envOf(context));
  if (!device) throw err('DEVICE_NOT_FOUND', 'device not found');
  return { ok: true, device };
};

const heartbeat = (args = {}, context = {}) => {
  const device = findDevice(args, envOf(context));
  if (!device) throw err('DEVICE_NOT_FOUND', 'device not found');
  const lastSeen = device.last_seen ? Date.parse(device.last_seen) : NaN;
  const ageMs = Number.isFinite(lastSeen) ? Date.now() - lastSeen : null;
  return {
    ok: true,
    device_id: device.device_id,
    name: device.name,
    host: device.host,
    status: device.status,
    online: device.status === 'online',
    last_seen: device.last_seen,
    age_ms: ageMs,
    provider_count: device.provider_count,
    capability_hash: device.capability_hash
  };
};


const trace = (env, event, payload = {}) => {
  if (env.ZERO_TRACE !== '1') return;
  console.error(JSON.stringify({ at: new Date().toISOString(), event, ...payload }));
};

const exec = async (args = {}, context = {}) => {
  const env = envOf(context);
  const created = registry.createTask({
    device_id: args.device_id,
    name: args.name,
    tool: args.tool,
    arguments: args.arguments || {}
  }, env);
  trace(env, 'devices.exec.create', { device: created.device.name, task_id: created.task.task_id, tool: args.tool, args: args.arguments || {} });
  const waitMs = Number.isInteger(args.waitMs) ? args.waitMs : 15000;
  const finished = await registry.waitTask(created.task.task_id, waitMs, env);
  trace(env, 'devices.exec.result', { task_id: created.task.task_id, status: finished.task.status, timeout: finished.timeout === true });
  return { ...finished, device: created.device };
};

const handlers = { list, status, heartbeat, exec };

exports.listTools = () => TOOLS.map(([name, description]) => ({
  name,
  description: `${description} Canonical: zero.devices.${name}`,
  inputSchema: toolSchemas[name]
}));

exports.callTool = async (name, args = {}, context = {}) => {
  const handler = handlers[name];
  if (!handler) throw err('UNKNOWN_TOOL', 'unknown devices tool: ' + name);
  return handler(args, context);
};
