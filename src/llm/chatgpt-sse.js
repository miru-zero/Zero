const parseData = (frame) => {
  const lines = frame.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  return data || null;
};

exports.createParser = ({
  onDelta = () => {},
  onConversationId = () => {},
  onDone = () => {}
} = {}) => {
  let buffer = '';
  let finished = false;
  let currentText = '';
  let conversationId = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
  };

  const appendOp = (op) => {
    if (
      op?.p !== '/message/content/parts/0'
      || typeof op?.v !== 'string'
      || !op.v
    ) return;

    if (op.o === 'append') {
      currentText += op.v;
      onDelta(op.v);
      return;
    }

    if (op.o === 'replace' && op.v.startsWith(currentText)) {
      const delta = op.v.slice(currentText.length);
      currentText = op.v;
      if (delta) onDelta(delta);
    }
  };

  const handle = (frame) => {
    const data = parseData(frame);
    if (!data) return;
    if (data.trim() === '[DONE]') return finish();
    let event = null;
    try { event = JSON.parse(data.trim()); } catch { return; }

    const observedConversationId = typeof event?.conversation_id === 'string'
      ? event.conversation_id
      : (typeof event?.v?.conversation_id === 'string' ? event.v.conversation_id : null);
    if (observedConversationId && !conversationId) {
      conversationId = observedConversationId;
      onConversationId(conversationId);
    }

    const snapshot = event?.v?.message;
    if (
      snapshot?.author?.role === 'assistant'
      && snapshot?.channel === 'final'
      && snapshot?.content?.content_type === 'text'
      && typeof snapshot?.content?.parts?.[0] === 'string'
    ) {
      const text = snapshot.content.parts[0];
      if (text && text.startsWith(currentText)) {
        const delta = text.slice(currentText.length);
        currentText = text;
        if (delta) onDelta(delta);
      }
    }

    appendOp(event);
    if (event?.o === 'patch' && Array.isArray(event.v)) {
      for (const op of event.v) appendOp(op);
    }
  };

  return {
    push(chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      while (true) {
        const match = buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + match[0].length);
        handle(frame);
      }
    },
    end() {
      if (buffer.trim()) handle(buffer);
      buffer = '';
    }
  };
};
