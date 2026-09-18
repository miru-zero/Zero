const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const makeJwt = (exp) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.x`;
};
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-connectors-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  };
  const output = { text: '', write(value) { this.text += value; } };
  return { dir, env, output };
};

test('CLI connectors lists installed connectors with status and description', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'connectors'], ctx.env, ctx.output, {
    listConnectors: async (input) => {
      received = input;
      return [
        { id: 'plugins_1', name: 'webcmd', displayName: 'WebCMD', shortDescription: 'run web commands', status: 'ENABLED', enabled: true, disabledSkillNames: [] },
        { id: 'plugins_2', name: 'superpowers', displayName: 'Superpowers', shortDescription: null, status: 'ENABLED', enabled: false, disabledSkillNames: ['brainstorming'] }
      ];
    }
  });
  assert.equal(result.exitCode, 0);
  assert.ok(received.token);
  assert.match(ctx.output.text, /Connectors: 2 installed/);
  assert.match(ctx.output.text, /\[1\] WebCMD/);
  assert.match(ctx.output.text, /name=webcmd status=ENABLED enabled=true/);
  assert.match(ctx.output.text, /run web commands/);
  assert.match(ctx.output.text, /name=superpowers status=ENABLED enabled=false/);
  assert.match(ctx.output.text, /disabled_skills=brainstorming/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI usage includes descriptions and howto', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'bogus'], ctx.env, ctx.output, {});
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /Usage \(provider chatgpt/);
  assert.match(ctx.output.text, /zero chatgpt connectors/);
  assert.match(ctx.output.text, /Howto:/);
  assert.match(ctx.output.text, /agent spawn/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
