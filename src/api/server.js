const http = require('node:http');
const crypto = require('node:crypto');
const registry = require('../llm/model-registry');
const compat = require('../llm/openai-compat');
const responsesCompat = require('../llm/responses-compat');
const chatgptSse = require('../llm/chatgpt-sse');

const sendJson = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data)
  });
  res.end(data);
};

const readJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
};

const apiError = (error) => ({
  error: {
    message: error.message || String(error),
    type: error.code || 'ZERO_ERROR',
    code: error.code || null
  }
});

const writeSse = (res, value) => res.write(`data: ${value}\n\n`);
const streamChunk = ({ id, created, model, conversationId = null, content, role, finishReason = null }) => ({
  id,
  object: 'chat.completion.chunk',
  created,
  model,
  ...(conversationId ? { conversation_id: conversationId } : {}),
  choices: [{
    index: 0,
    delta: finishReason ? {} : { ...(role ? { role: 'assistant' } : {}), ...(content !== undefined ? { content } : {}) },
    finish_reason: finishReason
  }]
});

exports.createServer = ({ completeChat } = {}) => http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'zero-llm' });
    }

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return sendJson(res, 200, {
        object: 'list',
        data: registry.list().map((item) => ({
          id: item.id,
          object: 'model',
          created: 0,
          owned_by: 'zero'
        }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await readJson(req);
      const model = typeof body.model === 'string' ? body.model : 'zero-auto';
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const requestTools = Array.isArray(body.tools) ? body.tools : [];
      const conversationId = typeof body.conversation_id === 'string' && body.conversation_id.trim()
        ? body.conversation_id.trim()
        : null;

      if (!registry.get(model)) {
        return sendJson(res, 400, apiError(Object.assign(
          new Error(`Unknown model: ${model}`),
          { code: 'MODEL_NOT_FOUND' }
        )));
      }
      if (body.stream === true) {
        if (typeof completeChat !== 'function') {
          return sendJson(res, 503, apiError(Object.assign(
            new Error('LLM runtime is not attached'),
            { code: 'RUNTIME_NOT_READY' }
          )));
        }

        const id = `chatcmpl-zero-${crypto.randomUUID()}`;
        const created = Math.floor(Date.now() / 1000);
        let first = true;
        let ended = false;
        let streamConversationId = conversationId;
        const hasClientTools = requestTools.length > 0;

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });

        const writeFinish = (finishReason) => {
          if (ended) return;
          ended = true;
          writeSse(res, JSON.stringify(streamChunk({
            id,
            created,
            model,
            conversationId: streamConversationId,
            finishReason
          })));
          writeSse(res, '[DONE]');
          res.end();
        };

        const writeToolCalls = (toolCalls) => {
          if (ended) return;
          const indexed = toolCalls.map((call, index) => ({ index, ...call }));
          writeSse(res, JSON.stringify({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            ...(streamConversationId ? { conversation_id: streamConversationId } : {}),
            choices: [{
              index: 0,
              delta: { role: 'assistant', tool_calls: indexed },
              finish_reason: null
            }]
          }));
          writeFinish('tool_calls');
        };

        const parser = chatgptSse.createParser({
          onDelta: (content) => {
            if (ended || hasClientTools) return;
            writeSse(res, JSON.stringify(streamChunk({
              id,
              created,
              model,
              conversationId: streamConversationId,
              content,
              role: first
            })));
            first = false;
          },
          onConversationId: (value) => {
            if (!streamConversationId) streamConversationId = value;
          },
          onDone: () => {
            if (!hasClientTools) writeFinish('stop');
          }
        });

        try {
          const conversation = await completeChat({
            model,
            messages,
            ...(requestTools.length ? { tools: requestTools } : {}),
            ...(conversationId ? { conversationId } : {}),
            onChunk: (chunk) => parser.push(chunk)
          });
          parser.end();

          if (hasClientTools && !ended) {
            if (!streamConversationId) streamConversationId = conversation?.conversation_id || null;
            const completion = compat.makeChatCompletion({
              model,
              conversation,
              tools: requestTools,
              created
            });
            const choice = completion.choices?.[0];
            const toolCalls = Array.isArray(choice?.message?.tool_calls)
              ? choice.message.tool_calls
              : [];
            if (toolCalls.length) {
              writeToolCalls(toolCalls);
            } else {
              const content = typeof choice?.message?.content === 'string'
                ? choice.message.content
                : '';
              if (content) {
                writeSse(res, JSON.stringify(streamChunk({
                  id,
                  created,
                  model,
                  conversationId: streamConversationId,
                  content,
                  role: true
                })));
              }
              writeFinish('stop');
            }
          }
        } catch (error) {
          if (!ended) res.destroy(error);
        }
        return;
      }
      if (typeof completeChat !== 'function') {
        return sendJson(res, 503, apiError(Object.assign(
          new Error('LLM runtime is not attached'),
          { code: 'RUNTIME_NOT_READY' }
        )));
      }

      const conversation = await completeChat({
        model,
        messages,
        ...(requestTools.length ? { tools: requestTools } : {}),
        ...(conversationId ? { conversationId } : {})
      });
      return sendJson(res, 200, compat.makeChatCompletion({ model, conversation, tools: requestTools }));
    }

    if (req.method === 'POST' && url.pathname === '/v1/responses') {
      const body = await readJson(req);
      const model = typeof body.model === 'string' ? body.model : 'zero-auto';
      const requestTools = Array.isArray(body.tools) ? body.tools : [];
      const toolChoice = body.tool_choice || 'auto';

      if (!registry.get(model)) {
        return sendJson(res, 400, apiError(Object.assign(
          new Error(`Unknown model: ${model}`),
          { code: 'MODEL_NOT_FOUND' }
        )));
      }
      if (typeof completeChat !== 'function') {
        return sendJson(res, 503, apiError(Object.assign(
          new Error('LLM runtime is not attached'),
          { code: 'RUNTIME_NOT_READY' }
        )));
      }

      const previousResponseId = typeof body.previous_response_id === 'string' && body.previous_response_id.trim()
        ? body.previous_response_id.trim()
        : null;
      const explicitConversationId = typeof body.conversation_id === 'string' && body.conversation_id.trim()
        ? body.conversation_id.trim()
        : null;
      const conversationId = explicitConversationId || (previousResponseId
        ? responsesCompat.conversationIdFromResponseId(previousResponseId)
        : null);
      if (previousResponseId && !conversationId) {
        return sendJson(res, 400, apiError(Object.assign(
          new Error('Invalid previous_response_id'),
          { code: 'INVALID_PREVIOUS_RESPONSE_ID' }
        )));
      }

      const instructions = typeof body.instructions === 'string' ? body.instructions : null;
      const messages = responsesCompat.inputToMessages({ instructions, input: body.input });
      if (!messages.length) {
        return sendJson(res, 400, apiError(Object.assign(
          new Error('input is required'),
          { code: 'BAD_REQUEST' }
        )));
      }

      if (body.stream === true) {
        let streamConversationId = conversationId;
        const createdAt = Math.floor(Date.now() / 1000);
        const messageId = `msg_zero_${crypto.randomUUID()}`;
        let responseId = null;
        let started = false;
        let textItemStarted = false;
        let ended = false;
        let fullText = '';
        const pendingDeltas = [];

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });

        const writeEvent = (type, payload) => {
          res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
        };

        const emitStart = () => {
          if (started || !streamConversationId) return;
          started = true;
          responseId = responsesCompat.makeResponseId({
            conversationId: streamConversationId,
            currentNode: `stream-${crypto.randomUUID()}`
          });
          const response = {
            id: responseId,
            object: 'response',
            created_at: createdAt,
            status: 'in_progress',
            error: null,
            incomplete_details: null,
            instructions,
            model,
            output: [],
            parallel_tool_calls: true,
            previous_response_id: previousResponseId,
            tools: requestTools,
            tool_choice: toolChoice,
            metadata: {},
            usage: null
          };
          writeEvent('response.created', { type: 'response.created', response });
          writeEvent('response.in_progress', { type: 'response.in_progress', response });
          while (pendingDeltas.length) emitDelta(pendingDeltas.shift());
        };

        const ensureTextItemStarted = () => {
          emitStart();
          if (!started || textItemStarted) return;
          textItemStarted = true;
          writeEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] }
          });
          writeEvent('response.content_part.added', {
            type: 'response.content_part.added',
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] }
          });
        };

        const emitDelta = (delta) => {
          if (!delta) return;
          if (!started) {
            pendingDeltas.push(delta);
            return;
          }
          ensureTextItemStarted();
          fullText += delta;
          writeEvent('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            delta
          });
        };

        const parser = chatgptSse.createParser({
          onDelta: requestTools.length ? () => {} : emitDelta,
          onConversationId: (value) => {
            if (!streamConversationId) streamConversationId = value;
            emitStart();
          },
          onDone: () => {}
        });

        try {
          const conversation = await completeChat({
            model,
            messages,
            ...(requestTools.length ? { tools: requestTools } : {}),
            ...(streamConversationId ? { conversationId: streamConversationId } : {}),
            onChunk: (chunk) => parser.push(chunk)
          });
          parser.end();
          if (!streamConversationId) streamConversationId = conversation?.conversation_id || null;
          emitStart();
          if (!started) throw new Error('Responses stream missing conversation_id');

          const completed = responsesCompat.makeResponse({
            model,
            conversation,
            instructions,
            previousResponseId,
            tools: requestTools,
            toolChoice,
            createdAt
          });
          completed.id = responseId;

          const outputItem = completed.output?.[0] || null;
          if (outputItem?.type === 'function_call') {
            const argumentsText = typeof outputItem.arguments === 'string' ? outputItem.arguments : '';
            writeEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: 0,
              item: { ...outputItem, status: 'in_progress', arguments: '' }
            });
            if (argumentsText) {
              writeEvent('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                item_id: outputItem.id,
                output_index: 0,
                delta: argumentsText
              });
            }
            writeEvent('response.function_call_arguments.done', {
              type: 'response.function_call_arguments.done',
              item_id: outputItem.id,
              output_index: 0,
              arguments: argumentsText
            });
            writeEvent('response.output_item.done', {
              type: 'response.output_item.done',
              output_index: 0,
              item: outputItem
            });
          } else {
            ensureTextItemStarted();
            if (completed.output?.[0]) completed.output[0].id = messageId;

            const finalText = completed.output_text || '';
            if (finalText.startsWith(fullText) && finalText.length > fullText.length) {
              emitDelta(finalText.slice(fullText.length));
            }

            writeEvent('response.output_text.done', {
              type: 'response.output_text.done',
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              text: finalText
            });
            writeEvent('response.content_part.done', {
              type: 'response.content_part.done',
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              part: { type: 'output_text', text: finalText, annotations: [] }
            });
            writeEvent('response.output_item.done', {
              type: 'response.output_item.done',
              output_index: 0,
              item: completed.output[0]
            });
          }

          writeEvent('response.completed', {
            type: 'response.completed',
            response: completed
          });
          ended = true;
          res.end();
        } catch (error) {
          if (!ended) res.destroy(error);
        }
        return;
      }

      const conversation = await completeChat({
        model,
        messages,
        ...(requestTools.length ? { tools: requestTools } : {}),
        ...(conversationId ? { conversationId } : {})
      });
      return sendJson(res, 200, responsesCompat.makeResponse({
        model,
        conversation,
        instructions,
        previousResponseId,
        tools: requestTools,
        toolChoice
      }));
    }

    return sendJson(res, 404, apiError(Object.assign(
      new Error('Not found'),
      { code: 'NOT_FOUND' }
    )));
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    return sendJson(res, status, apiError(error));
  }
});
