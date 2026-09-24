// Generic hierarchical help renderer for Zero modules/providers.
const renderArgSummary = (tool) => {
  const schema = tool?.inputSchema;
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const names = Object.keys(properties);
  if (!names.length) return null;
  return names.map((name) => {
    const type = properties[name]?.type || 'any';
    return required.includes(name) ? `${name}:${type}*` : `${name}:${type}`;
  }).join(', ');
};

exports.renderModules = (output, providers = []) => {
  output.write('Zero\n\nModules:\n');
  for (const provider of providers) {
    const detail = provider.description || provider.type || '';
    output.write(`  ${provider.name}${detail ? `  — ${detail}` : ''}\n`);
  }
  output.write('\nUsage:\n');
  output.write('  zero <module> help\n');
  output.write('  zero <module> <tool> help\n');
  output.write("  zero <module> <tool> '<json>'\n");
};

exports.renderToolList = (output, provider, tools = []) => {
  output.write(`Module: ${provider.name}\n`);
  if (provider.description) output.write(`${provider.description}\n`);
  output.write(`Tools: ${tools.length}\n\n`);
  for (const tool of tools) {
    output.write(`  ${tool.name}${tool.description ? `  — ${tool.description}` : ''}\n`);
    const args = renderArgSummary(tool);
    if (args) output.write(`      args: ${args}  (* = required)\n`);
  }
  output.write(`\nMore: zero ${provider.name} <tool> help\n`);
};

exports.renderToolHelp = (output, provider, tool) => {
  output.write(`Command: zero ${provider.name} ${tool.name}\n\n`);
  if (tool.description) output.write(`${tool.description}\n\n`);
  output.write('Arguments:\n');
  const schema = tool?.inputSchema;
  const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const names = Object.keys(properties);
  if (!names.length) {
    output.write('  (none)\n');
  } else {
    for (const name of names) {
      const spec = properties[name] || {};
      const type = spec.type || 'any';
      const mode = required.includes(name) ? 'required' : 'optional';
      output.write(`  ${name}  ${type}  ${mode}${spec.description ? `  — ${spec.description}` : ''}\n`);
    }
  }
  output.write('\nUsage:\n');
  output.write(`  zero ${provider.name} ${tool.name}`);
  if (names.length) output.write(" '<json>'");
  output.write('\n');
};
