const registry = require('../llm/model-registry');
const compat = require('../llm/openai-compat');

const errorBody = (message, code) => ({
  error: { message, type: code, code }
});

exports.handle = async ({ method, path, body = {}, completeChat }) => {
  if (method === 'GET' && path === '/health') {
    return { status: 200, body: { ok: true, service: 'zero-llm' } };
  }

  if (method === 'GET' && path === '/v1/models') {
    return {
      status: 200,
      body: {
        object: 'list',
        data: registry.list().map((item) => ({
          id: item.id,
          object: 'model',
          created: 0,
          owned_by: 'zero'
        }))
      }
    };
  }

  if (method === 'POST' && path === '/v1/chat/completions') {
    const model = typeof body.model === 'string' ? body.model : 'zero-auto';
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!registry.get(model)) {
      return { status: 400, body: errorBody(`Unknown model: ${model}`, 'MODEL_NOT_FOUND') };
    }
    if (body.stream === true) {
      return { status: 501, body: errorBody('stream=true is not implemented yet', 'STREAM_UNSUPPORTED') };
    }
    if (typeof completeChat !== 'function') {
      return { status: 503, body: errorBody('LLM runtime is not attached', 'RUNTIME_NOT_READY') };
    }
    const conversation = await completeChat({ model, messages });
    return { status: 200, body: compat.makeChatCompletion({ model, conversation }) };
  }

  return { status: 404, body: errorBody('Not found', 'NOT_FOUND') };
};
