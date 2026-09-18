// fixture: MCP stdio server ปลอมสำหรับทดสอบ (newline-delimited JSON-RPC)
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id == null) continue;
    let result;
    if (message.method === 'initialize') {
      result = { protocolVersion: message.params.protocolVersion, capabilities: {}, serverInfo: { name: 'fixture', version: '0.0.1' } };
    } else if (message.method === 'tools/list') {
      result = { tools: [{ name: 'ping', description: 'pong' }, { name: 'echo', description: 'echo back' }] };
    } else if (message.method === 'tools/call') {
      if (message.params.name === 'ping') result = { content: [{ type: 'text', text: 'pong' }] };
      else if (message.params.name === 'echo') result = { content: [{ type: 'text', text: JSON.stringify(message.params.arguments || {}) }] };
      else {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'unknown tool' } }) + '\n');
        continue;
      }
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } }) + '\n');
      continue;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  }
});
