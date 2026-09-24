'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('./config');
const pkg = require('../package.json');

const DEFAULT_INTERVAL = 30000;

const q = (value) => '"' + String(value).replace(/"/g, '""') + '"';
const winPath = (value) => String(value).replace(/\//g, '\\');

const defaultRoots = (env = process.env) => {
  if (env.ZERO_AGENT_ROOTS) return env.ZERO_AGENT_ROOTS;
  const home = env.USERPROFILE || os.homedir();
  return [
    path.join(home, 'Desktop', 'zero'),
    path.join(home, 'Downloads')
  ].join(path.delimiter);
};

const startupDir = (env = process.env) => {
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
};
const paths = (env = process.env) => {
  const home = config.agentHome(env);
  return {
    home,
    launcherFile: path.join(home, 'start-zero-agent.cmd'),
    startupFile: path.join(startupDir(env), 'MiruZeroAgent.vbs'),
    logFile: path.join(config.logDir(env), 'zero-agent.log')
  };
};

const packageSpec = () => pkg.name + '@' + pkg.version;
const packageBin = () => path.join(__dirname, '..', 'bin', 'zero-agent.js');

const launcherContent = ({ interval = DEFAULT_INTERVAL, roots, logFile }, env = process.env) => {
  const home = config.agentHome(env);
  const spec = packageSpec();
  const bin = packageBin();
  return [
    '@echo off',
    'setlocal',
    'set "ZERO_TRACE=1"',
    'set "ZERO_AGENT_HOME=' + winPath(home) + '"',
    'set "ZERO_AGENT_ROOTS=' + winPath(roots) + '"',
    'set "ZERO_AGENT_INTERVAL=' + Number(interval || DEFAULT_INTERVAL) + '"',
    'rem interval=' + Number(interval || DEFAULT_INTERVAL) + 'ms',
    'if not exist ' + q(winPath(path.dirname(logFile))) + ' mkdir ' + q(winPath(path.dirname(logFile))),
    'echo [%date% %time%] starting ' + spec + ' >> ' + q(winPath(logFile)),
    'node ' + q(winPath(bin)) + ' start --interval %ZERO_AGENT_INTERVAL% >> ' + q(winPath(logFile)) + ' 2>&1',
    ''
  ].join('\r\n');
};

const vbsContent = (launcherFile) => [
  'Set WshShell = CreateObject("WScript.Shell")',
  'WshShell.Run Chr(34) & "' + winPath(launcherFile).replace(/"/g, '""') + '" & Chr(34), 0, False',
  ''
].join('\r\n');

const prepare = (options = {}, env = process.env) => {
  config.ensureDirs(env);
  const p = paths(env);
  const interval = Number(options.interval || env.ZERO_AGENT_INTERVAL || DEFAULT_INTERVAL);
  const roots = options.roots || defaultRoots(env);
  fs.mkdirSync(path.dirname(p.launcherFile), { recursive: true });
  fs.mkdirSync(path.dirname(p.startupFile), { recursive: true });
  fs.mkdirSync(path.dirname(p.logFile), { recursive: true });
  fs.writeFileSync(p.launcherFile, launcherContent({ interval, roots, logFile: p.logFile }, env), 'utf8');
  fs.writeFileSync(p.startupFile, vbsContent(p.launcherFile), 'utf8');
  return { ok: true, interval, roots, ...p };
};

const autostart = {
  DEFAULT_INTERVAL,
  defaultRoots,
  paths,
  prepare,
  launcherContent
};

Object.assign(exports, autostart);
