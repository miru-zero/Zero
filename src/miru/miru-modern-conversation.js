const cloneJson = (value) => JSON.parse(JSON.stringify(value));

exports.acquisitionNumTurns = (limit) => {
  const lines = Math.max(1, Number.parseInt(limit, 10) || 5);
  return lines * 2;
};

exports.compactPluralConversation = (source, limit) => {
  const out = cloneJson(source || {});
  const messages = Array.isArray(out.messages) ? out.messages : [];
  const userIndexes = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.author?.role === 'user') userIndexes.push(i);
  }
  if (!userIndexes.length) throw new Error('conversation has no user messages');

  const lines = Math.max(1, Number.parseInt(limit, 10) || 1);
  const firstUserIndex = userIndexes[0];
  const tailUserIndex = userIndexes[Math.max(0, userIndexes.length - lines)];
  const prefix = messages.slice(0, firstUserIndex);
  out.messages = prefix.concat(messages.slice(tailUserIndex));

  const keptIds = new Set(out.messages.map((message) => message?.id).filter(Boolean));
  const current = out.messages.find((message) => message?.id === out.current_node);
  if (!current || !current?.content?.parts?.[0]) {
    const fallback = [...out.messages].reverse().find((message) =>
      message?.author?.role === 'assistant'
      && typeof message?.content?.parts?.[0] === 'string'
      && message.content.parts[0].trim()
    );
    out.current_node = fallback?.id || out.messages.at(-1)?.id || null;
  } else if (!keptIds.has(out.current_node)) {
    out.current_node = out.messages.at(-1)?.id || null;
  }

  if (out.page_info && typeof out.page_info === 'object') {
    out.page_info.has_previous_page = false;
    out.page_info.has_next_page = false;
    out.page_info.start_cursor = out.messages[0]?.id || null;
    out.page_info.end_cursor = out.current_node || out.messages.at(-1)?.id || null;
  }

  return out;
};
