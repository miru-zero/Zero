const readline = require('node:readline/promises');

exports.buildMenuText = (useColor = false, tokenName = 'default') => {
  const purple = useColor ? '\x1b[95m' : '';
  const cyan = useColor ? '\x1b[96m' : '';
  const reset = useColor ? '\x1b[0m' : '';

  return [
    `${purple}──────────────────────── Login Menu ─────────────────────────${reset}`,
    '',
    `  Active Token: ${cyan}${tokenName}${reset}`,
    '',
    '  1. Login ChatGPT',
    '  2. Token Status',
    '  3. Replace Access Token',
    '  0. Exit',
    ''
  ].join('\n');
};

exports.promptLoginMenu = async (input = process.stdin, output = process.stdout, tokenName = 'default') => {
  output.write(`${exports.buildMenuText(Boolean(output.isTTY), tokenName)}\n`);
  const rl = readline.createInterface({ input, output });

  try {
    const selection = await rl.question('Select: ');
    return { selection: selection.trim() };
  } finally {
    rl.close();
  }
};
