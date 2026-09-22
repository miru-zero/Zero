const apiServer = require('./server');
const runtime = require('./runtime');

exports.createAppServer = ({
  env = process.env,
  completeChat = runtime.createCompleteChat({ env })
} = {}) => apiServer.createServer({ completeChat });

exports.start = ({
  env = process.env,
  host = env.ZERO_LLM_HOST || '127.0.0.1',
  port = Number(env.ZERO_LLM_PORT || 8050)
} = {}) => new Promise((resolve, reject) => {
  const server = exports.createAppServer({ env });
  server.once('error', reject);
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`[Zero-LLM] listening http://${address.address}:${address.port}`);
    resolve(server);
  });
});

if (require.main === module) {
  exports.start().catch((error) => {
    console.error(`[Zero-LLM] fatal: ${error.message}`);
    process.exitCode = 1;
  });
}
