const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const devicesProvider = require('../../providers/devices/runtime');

const envWithRegistry = () => ({
  ZERO_DEVICE_REGISTRY_FILE: path.join(os.tmpdir(), `zero-devices-${Date.now()}-${Math.random()}.json`)
});

const seed = (env, state) => {
  fs.mkdirSync(path.dirname(env.ZERO_DEVICE_REGISTRY_FILE), { recursive: true });
  fs.writeFileSync(env.ZERO_DEVICE_REGISTRY_FILE, JSON.stringify(state, null, 2));
};

test('devices provider exposes device registry tools', () => {
  const names = devicesProvider.listTools().map((tool) => tool.name);
  assert.deepEqual(names, ['list', 'status', 'heartbeat', 'exec']);
});

test('devices provider lists and filters devices without tokens', async () => {
  const env = envWithRegistry();
  seed(env, {
    pairing_code: 'ZERO-TEST',
    devices: {
      dev_a: {
        device_id: 'dev_a', device_token: 'secret-a', name: 'A-PC', host: 'A-PC',
        status: 'online', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:10.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:10.000Z',
        provider_count: 3, capability_hash: 'hash-a'
      },
      dev_b: {
        device_id: 'dev_b', device_token: 'secret-b', name: 'B-PC', host: 'B-PC',
        status: 'paired', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: null,
        provider_count: 0, capability_hash: null
      }
    }
  });
  const listed = await devicesProvider.callTool('list', {}, { env });
  assert.equal(listed.total, 2);
  assert.equal(listed.online, 1);
  assert.equal(listed.devices[0].device_token, undefined);

  const online = await devicesProvider.callTool('list', { onlineOnly: true }, { env });
  assert.deepEqual(online.devices.map((item) => item.device_id), ['dev_a']);
});

test('devices provider reports status and heartbeat summary', async () => {
  const env = envWithRegistry();
  seed(env, {
    pairing_code: 'ZERO-TEST',
    devices: {
      dev_a: {
        device_id: 'dev_a', device_token: 'secret-a', name: 'MiruZero', host: 'MiruZero',
        status: 'online', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:10.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: new Date(Date.now() - 5000).toISOString(),
        provider_count: 6, capability_hash: 'hash-a'
      }
    }
  });
  const status = await devicesProvider.callTool('status', { name: 'MiruZero' }, { env });
  assert.equal(status.device.device_id, 'dev_a');
  assert.equal(status.device.status, 'online');

  const heartbeat = await devicesProvider.callTool('heartbeat', { device_id: 'dev_a' }, { env });
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.device_id, 'dev_a');
  assert.equal(heartbeat.status, 'online');
  assert.equal(heartbeat.online, true);
  assert.equal(typeof heartbeat.age_ms, 'number');
});


test('devices provider refuses exec by duplicate name', async () => {
  const env = envWithRegistry();
  seed(env, {
    pairing_code: 'ZERO-TEST',
    devices: {
      dev_old: {
        device_id: 'dev_old', device_token: 'secret-old', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z'
      },
      dev_new: {
        device_id: 'dev_new', device_token: 'secret-new', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:01:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
        paired_at: '2026-01-01T00:01:00.000Z', last_seen: '2026-01-01T00:01:00.000Z'
      }
    },
    tasks: {}
  });
  await assert.rejects(
    () => devicesProvider.callTool('exec', { name: 'TON', tool: 'command.listDirectory', arguments: { path: 'x' }, waitMs: 0 }, { env }),
    (error) => error.code === 'DEVICE_AMBIGUOUS'
  );
});


test('devices provider refuses exec by duplicate name', async () => {
  const env = envWithRegistry();
  seed(env, {
    pairing_code: 'ZERO-TEST',
    devices: {
      dev_old: {
        device_id: 'dev_old', device_token: 'secret-old', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z'
      },
      dev_new: {
        device_id: 'dev_new', device_token: 'secret-new', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:01:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
        paired_at: '2026-01-01T00:01:00.000Z', last_seen: '2026-01-01T00:01:00.000Z'
      }
    },
    tasks: {}
  });
  await assert.rejects(
    () => devicesProvider.callTool('exec', { name: 'TON', tool: 'command.listDirectory', arguments: { path: 'x' }, waitMs: 0 }, { env }),
    (error) => error.code === 'DEVICE_AMBIGUOUS'
  );
});


test('devices provider refuses exec by duplicate name', async () => {
  const env = envWithRegistry();
  seed(env, {
    pairing_code: 'ZERO-TEST',
    devices: {
      dev_old: {
        device_id: 'dev_old', device_token: 'secret-old', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        paired_at: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-01T00:00:00.000Z'
      },
      dev_new: {
        device_id: 'dev_new', device_token: 'secret-new', name: 'TON', host: 'TON',
        status: 'online', created_at: '2026-01-01T00:01:00.000Z', updated_at: '2026-01-01T00:01:00.000Z',
        paired_at: '2026-01-01T00:01:00.000Z', last_seen: '2026-01-01T00:01:00.000Z'
      }
    },
    tasks: {}
  });
  await assert.rejects(
    () => devicesProvider.callTool('exec', { name: 'TON', tool: 'command.listDirectory', arguments: { path: 'x' }, waitMs: 0 }, { env }),
    (error) => error.code === 'DEVICE_AMBIGUOUS'
  );
});
