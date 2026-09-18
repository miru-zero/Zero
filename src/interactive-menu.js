const readline = require('node:readline/promises');

const parseValue = (raw, spec = {}) => {
  const type = spec.type || 'string';
  if (Array.isArray(spec.enum) && !spec.enum.includes(raw)) {
    throw new Error(`ต้องเป็นค่าใดค่าหนึ่ง: ${spec.enum.join(', ')}`);
  }
  if (type === 'boolean') {
    const value = raw.toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(value)) return true;
    if (['false', '0', 'no', 'n'].includes(value)) return false;
    throw new Error('ต้องเป็น true/false');
  }
  if (type === 'integer') {
    const value = Number(raw);
    if (!Number.isInteger(value)) throw new Error('ต้องเป็นจำนวนเต็ม');
    return value;
  }
  if (type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('ต้องเป็นตัวเลข');
    return value;
  }
  if (type === 'object' || type === 'array') {
    const value = JSON.parse(raw);
    if (type === 'array' && !Array.isArray(value)) throw new Error('ต้องเป็น JSON array');
    if (type === 'object' && (Array.isArray(value) || value === null || typeof value !== 'object')) throw new Error('ต้องเป็น JSON object');
    return value;
  }
  return raw;
};
const collectArgs = async ({ tool, ask, output }) => {
  const schema = tool.inputSchema || {};
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const args = {};
  for (const [name, spec] of Object.entries(properties)) {
    while (true) {
      const type = spec?.type || 'any';
      const enumHint = Array.isArray(spec?.enum) ? ` ${spec.enum.join('|')}` : '';
      const raw = await ask(`${name}${required.has(name) ? ' *' : ''} [${type}${enumHint}]: `);
      if (!raw) {
        if (required.has(name)) {
          output.write(`  ${name} จำเป็นต้องระบุ\n`);
          continue;
        }
        break;
      }
      try {
        args[name] = parseValue(raw, spec);
        break;
      } catch (error) {
        output.write(`  invalid ${name}: ${error.message}\n`);
      }
    }
  }
  return args;
};

const renderValue = (output, value) => {
  if (value === undefined) return;
  if (typeof value === 'string') output.write(`${value}${value.endsWith('\n') ? '' : '\n'}`);
  else output.write(`${JSON.stringify(value, null, 2)}\n`);
};
exports.run = async ({
  input = process.stdin,
  output = process.stdout,
  providers = [],
  question = null,
  listTools = null,
  executeTool = null,
  executeCore = null
} = {}) => {
  let rl = null;
  const ask = question
    ? async (label) => String(await question(label)).trim()
    : async (label) => {
      if (!rl) rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
      return String(await rl.question(label)).trim();
    };

  const pause = async () => { await ask('\nPress Enter to continue...'); };

  const providerMenu = async (provider) => {
    if (typeof listTools !== 'function') return { args: [provider.name] };
    let tools;
    try {
      tools = await listTools(provider.name);
    } catch (error) {
      output.write(`error=${error.code || 'TOOL_LIST_FAILED'} ${error.message}\n`);
      await pause();
      return { action: 'back' };
    }

    while (true) {
      output.write(`\nProvider: ${provider.name} [${provider.type || 'unknown'}]\n`);
      tools.forEach((tool, index) => {
        output.write(`  ${index + 1}) ${tool.name}${tool.description ? ` — ${tool.description}` : ''}\n`);
      });
      output.write('  b) Back\n  q) Exit\n\n');      const rawChoice = await ask('Select tool: ');
      if (rawChoice.toLowerCase() === 'q') return { action: 'exit' };
      if (rawChoice.toLowerCase() === 'b' || rawChoice === '') return { action: 'back' };
      const choice = Number(rawChoice);
      if (!Number.isInteger(choice) || choice < 1 || choice > tools.length) {
        output.write(`Unknown selection: ${rawChoice}\n`);
        continue;
      }
      const tool = tools[choice - 1];
      const args = await collectArgs({ tool, ask, output });
      if (typeof executeTool !== 'function') {
        return { args: [provider.name, 'call', tool.name, JSON.stringify(args)] };
      }
      try {
        const result = await executeTool(provider.name, tool.name, args);
        output.write('\nResult:\n');
        renderValue(output, result);
      } catch (error) {
        output.write(`error=${error.code || 'TOOL_FAILED'} ${error.message}\n`);
      }
      await pause();
    }
  };

  try {
    while (true) {
      output.write('\nZERO Core\nProviders:\n');
      providers.forEach((provider, index) => {
        output.write(`  ${index + 1}) ${provider.name} [${provider.type || 'unknown'}]\n`);
      });
      if (providers.length === 0) output.write('  (none)\n');      const coreStart = providers.length + 1;
      output.write('\nCore:\n');
      output.write(`  ${coreStart}) Tools / Providers\n`);
      output.write(`  ${coreStart + 1}) Auth Status\n`);
      output.write(`  ${coreStart + 2}) Help\n`);
      output.write('  q) Exit\n\n');

      const rawChoice = await ask('Select: ');
      if (rawChoice.toLowerCase() === 'q' || rawChoice === '') return { exitCode: 0, action: 'exit' };
      const choice = Number(rawChoice);
      if (Number.isInteger(choice) && choice >= 1 && choice <= providers.length) {
        const result = await providerMenu(providers[choice - 1]);
        if (result?.action === 'exit') return { exitCode: 0, action: 'exit' };
        if (result?.args) return { exitCode: 0, args: result.args };
        continue;
      }

      const coreArgs = choice === coreStart ? ['tools']
        : choice === coreStart + 1 ? ['auth', 'status']
          : choice === coreStart + 2 ? ['help'] : null;
      if (!coreArgs) {
        output.write(`Unknown selection: ${rawChoice}\n`);
        continue;
      }
      if (typeof executeCore !== 'function') return { exitCode: 0, args: coreArgs };
      await executeCore(coreArgs);
      await pause();
    }
  } finally {
    if (rl) rl.close();
  }
};