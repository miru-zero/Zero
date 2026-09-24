'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');
const pkg = require('../package.json');
const config = require('./config');
const autostart = require('./autostart');
const caps = require('./capabilities');
const agent = require('./agent');
const { parseArgs } = require('./args');

const usage = () => `Zero Agent

Usage:
  zero-agent setup [--server <url>] [--name <device>] [--code <pairing-code>] [--no-global]
  zero-agent init --server <url> [--name <device>]
  zero-agent pair --server <url> --code <pairing-code> [--name <device>]
  zero-agent start [--once] [--interval <ms>] [--code <pairing-code>] [--name <device>]
  zero-agent status
  zero-agent devices
  zero-agent doctor
  zero-agent providers
  zero-agent tools
  zero-agent capabilities
`;

const printJson = (value) => console.log(JSON.stringify(value, null, 2));
const okMark = (ok) => ok ? 'OK' : 'FAIL';
const DEFAULT_SERVER = 'https://zero.miru.work';

const autostartInterval = (parsed) => Number(parsed.interval || autostart.DEFAULT_INTERVAL);

const printAutostartInfo = (prepared) => {
  console.log('Autostart file');
  console.log(prepared.startupFile);
  console.log('ตัวนี้จะรันตอน user logon และเปิด:');
  console.log(prepared.launcherFile);
  console.log('Launcher');
  console.log(prepared.launcherFile);
  console.log('ตั้งค่า:');
  console.log('ZERO_TRACE=1');
  console.log('ZERO_AGENT_ROOTS=' + prepared.roots);
  console.log('interval=' + prepared.interval + 'ms');
  console.log('log=' + prepared.logFile);
};

const ensureLocalBootstrap = async (parsed, env) => {
  let device = config.loadDevice(env);
  if (!device) {
    const init = agent.initDevice({ name: parsed.name, server: parsed.server || DEFAULT_SERVER }, env);
    console.log('autoInit=OK file=' + init.file);
    device = config.loadDevice(env);
  }
  const prepared = autostart.prepare({ interval: autostartInterval(parsed) }, env);
  console.log('autoSetup=OK launcher=' + prepared.launcherFile);
  if (parsed.code && (!device || !device.device_id)) {
    const paired = await agent.pairDevice({
      name: parsed.name || device?.name,
      server: parsed.server || device?.server || DEFAULT_SERVER,
      code: parsed.code
    }, env);
    console.log('autoPair=OK file=' + paired.file);
  }
  return prepared;
};

const runGlobalInstall = (parsed, env) => {
  if (parsed['no-global'] || env.ZERO_AGENT_SKIP_GLOBAL_INSTALL === '1') {
    console.log('globalInstall=SKIPPED');
    return { skipped: true };
  }
  const spec = parsed.package || (pkg.name + '@' + pkg.version);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log('globalInstall=START ' + spec);
  const result = childProcess.spawnSync(npmCmd, ['install', '-g', spec], { stdio: 'inherit', env });
  if (result.status === 0) {
    console.log('globalInstall=OK');
    return { ok: true };
  }
  console.log('globalInstall=WARN exitCode=' + result.status);
  return { ok: false, exitCode: result.status };
};

const runSetup = async (parsed, env) => {
  const server = parsed.server || DEFAULT_SERVER;
  const name = parsed.name || undefined;
  console.log('Zero Agent Setup');
  console.log('server=' + server);
  console.log('name=' + (name || os.hostname()));
  runGlobalInstall(parsed, env);
  const init = agent.initDevice({ name, server }, env);
  console.log('init=OK file=' + init.file);
  const prepared = autostart.prepare({ interval: autostartInterval(parsed) }, env);
  printAutostartInfo(prepared);
  if (!parsed.code) {
    console.log('pairing=NEEDS_CODE');
    console.log('Next: zero-agent pair --server ' + server + ' --code ZERO-XXXXXX --name ' + init.device.name);
    console.log('Or:   npx ' + pkg.name + '@latest setup --server ' + server + ' --name ' + init.device.name + ' --code ZERO-XXXXXX');
    return 0;
  }
  const paired = await agent.pairDevice({ name: init.device.name, server, code: parsed.code }, env);
  console.log('pair=OK file=' + paired.file);
  printJson(paired.device);
  const heartbeat = await runStartOnce(env);
  console.log('verify=OK');
  printJson(heartbeat);
  console.log('Start: zero-agent start');
  return 0;
};


const status = (env) => {
  const device = config.loadDevice(env);
  if (!device) return { paired: false, home: config.agentHome(env) };
  return { paired: Boolean(device.device_id), home: config.agentHome(env), device: config.redactedDevice(device) };
};

const doctor = (env) => {
  const capability = caps.buildCapabilities(env);
  return {
    ok: true,
    node: process.version,
    platform: process.platform,
    agent_home: config.agentHome(env),
    mcp_root: capability.mcp_root,
    providers: capability.providers.length,
    capability_hash: capability.capability_hash
  };
};

const runStartOnce = async (env) => {
  const heartbeat = await agent.heartbeatOnce(env);
  if (!heartbeat.ok && heartbeat.code === 'NOT_PAIRED') return heartbeat;
  const capability = await agent.syncCapabilitiesOnce(env);
  const task = await agent.pollTaskOnce(env);
  return { heartbeat, capability, task };
};

const printStartBanner = (env) => {
  const device = config.loadDevice(env);
  console.log('🚀 Starting Zero Agent...');
  console.log('🔁 Session restored: ' + (device?.device_id ? 'yes' : 'no'));
  console.log('👤 Device Name: ' + (device?.name || '(unpaired)'));
  console.log('🆔 Device ID: ' + (device?.device_id || '(not paired)'));
  console.log('🌐 Server: ' + (device?.server || 'https://zero.miru.work'));
};

const printLoopResult = (result) => {
  if (!result || result.code === 'NOT_PAIRED') {
    console.log('❌ Device not paired: run zero-agent pair first');
    return;
  }
  const hb = result.heartbeat || {};
  const cap = result.capability || {};
  const device = cap.body?.device || hb.body?.device || null;
  const taskState = result.task?.task ? (result.task.task.task_id + ':' + (result.task.task.status || 'done')) : 'none';
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    heartbeat: okMark(Boolean(hb.ok)),
    capabilities: okMark(Boolean(cap.ok)),
    status: device?.status || null,
    name: device?.name || null,
    host: device?.host || null,
    providers: device?.provider_count ?? null,
    last_seen: device?.last_seen || null,
    task: taskState
  }));
};

async function run(argv = [], env = process.env) {
  const parsed = parseArgs(argv);
  const command = parsed._[0] || 'help';
  if (command === 'help' || parsed.help) {
    console.log(usage());
    return 0;
  }
  if (command === 'setup') {
    return runSetup(parsed, env);
  }
  if (command === 'init') {
    const result = agent.initDevice({ name: parsed.name, server: parsed.server }, env);
    console.log(`init=OK file=${result.file}`);
    printJson(result.device);
    return 0;
  }
  if (command === 'pair') {
    const result = await agent.pairDevice({ name: parsed.name, server: parsed.server, code: parsed.code }, env);
    console.log(`pair=OK file=${result.file}`);
    printJson(result.device);
    return 0;
  }
  if (command === 'status') {
    printJson(status(env));
    return 0;
  }
  if (command === 'devices') {
    printJson(await agent.listDevices(env));
    return 0;
  }
  if (command === 'doctor') {
    printJson(doctor(env));
    return 0;
  }
  if (command === 'providers') {
    printJson(caps.manifestProviders(env).map((item) => ({
      name: item.name,
      type: item.type,
      description: item.description,
      status: item.manifestError ? 'invalid' : 'present'
    })));
    return 0;
  }
  if (command === 'tools' || command === 'capabilities') {
    printJson(caps.buildCapabilities(env));
    return 0;
  }
  if (command === 'start') {
    await ensureLocalBootstrap(parsed, env);
    if (parsed.once) {
      printJson(await runStartOnce(env));
      return 0;
    }
    const interval = Number(parsed.interval || autostart.DEFAULT_INTERVAL);
    printStartBanner(env);
    console.log('⏱️  Heartbeat interval: ' + interval + 'ms');
    console.log('🟢 Device ready; press Ctrl+C to stop');
    while (true) {
      const result = await runStartOnce(env);
      printLoopResult(result);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  console.error('unknown command: ' + command);
  console.error(usage());
  return 64;
}

module.exports = { run, usage, status, doctor };
