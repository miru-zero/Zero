exports.parseConversationIdFromPath = (pathname) => {
  const match = String(pathname || '').match(/\/c\/([0-9a-f\-]{36})(?:\/|$)/i);
  return match?.[1] || null;
};

exports.nextPinnedConversationId = ({
  logicToggle,
  routeConversationId,
  pinnedConversationId
}) => {
  const route = routeConversationId || null;
  const pinned = pinnedConversationId || null;
  if (!pinned && route) return route;
  if (logicToggle === 'off' && route) return route;
  return pinned || route;
};

exports.attachFloatingUserNodesToRoot = (merged, rootId = 'client-created-root') => {
  if (!merged[rootId].children) merged[rootId].children = [];
  for (const [id, node] of Object.entries(merged)) {
    if (
      node.message?.author?.role === 'user'
      && id !== rootId
      && (
        !node.parent
        || !(node.parent in merged)
        || Object.values(merged).every((item) => !item.children?.includes(id))
      )
    ) {
      node.parent = rootId;
      if (!merged[rootId].children.includes(id)) merged[rootId].children.push(id);
    }
  }
};

exports.stripImageMetadataOverLimit = (merged, limit) => {
  let count = 0;
  for (const node of Object.values(merged)) {
    if (!node.message?.metadata?.attachments?.length) continue;
    if (count >= limit) node.message.metadata.attachments = [];
    else count += node.message.metadata.attachments.length;
  }
};

exports.cleanChainLastFromJSON = async (session, limit) => {
  try {
    const mapping = Object.fromEntries(
      Object.entries(session.mapping || {}).sort(([, a], [, b]) =>
        (a?.message?.create_time || 0) - (b?.message?.create_time || 0)
      )
    );
    const rootId = 'client-created-root';
    if (!mapping[rootId]) {
      mapping[rootId] = { id: rootId, message: null, parent: null, children: [] };
    }

    const userNodes = Object.values(mapping)
      .filter((node) => node?.message?.author?.role === 'user');
    const lines = [];
    const seen = new Set();
    for (let i = userNodes.length - 1; i >= 0 && lines.length < limit; i -= 1) {
      const line = {};
      let currentId = userNodes[i].id;
      while (currentId && mapping[currentId] && !seen.has(currentId)) {
        const node = mapping[currentId];
        line[currentId] = node;
        seen.add(currentId);
        const nextId = Array.isArray(node.children) ? node.children[0] : null;
        if (!nextId || !mapping[nextId]) break;
        currentId = nextId;
      }
      if (Object.keys(line).length) lines.unshift(line);
    }

    const rootChain = {};
    let currentId = rootId;
    while (true) {
      if (!currentId || !mapping[currentId]) break;
      const node = mapping[currentId];
      rootChain[currentId] = node;
      if (node.message?.author?.role === 'user') break;
      const nextId = Array.isArray(node.children) ? node.children[0] : null;
      if (!nextId || !mapping[nextId]) break;
      currentId = nextId;
    }

    const latest = lines[0] || {};
    const rest = lines.slice(1);
    const merged = { ...rootChain };
    const newHead = Object.entries(latest);
    const lastInRoot = Object.keys(rootChain).slice(-2)[0];
    const userInRoot = Object.keys(rootChain).slice(-1)[0];
    const headFirstId = newHead[0]?.[0];

    if (lastInRoot && merged[lastInRoot]) {
      newHead[0][1].parent = lastInRoot;
      merged[lastInRoot].children = [headFirstId];
    }

    if (
      userInRoot && userInRoot !== headFirstId
      && !merged[userInRoot]?.children?.length
      && Object.values(merged).every((node) => node.parent !== userInRoot)
    ) {
      delete merged[userInRoot];
    }

    for (const [id, node] of newHead) merged[id] = node;
    for (const line of rest) {
      for (const [id, node] of Object.entries(line)) merged[id] = node;
    }

    exports.attachFloatingUserNodesToRoot(merged);
    exports.stripImageMetadataOverLimit(merged, limit);
    for (const node of Object.values(merged)) {
      if (node.children) node.children = node.children.filter((childId) => childId in merged);
      if (node.parent && !(node.parent in merged)) delete node.parent;
    }

    if (!merged[rootId]) {
      merged[rootId] = { id: rootId, message: null, parent: null, children: [] };
    }
    if (!Array.isArray(merged[rootId].children)) merged[rootId].children = [];

    if (!merged[session.current_node] || !merged[session.current_node]?.message?.content?.parts?.[0]) {
      const fallbackNode = Object.values(merged).reverse().find((node) =>
        node.message?.author?.role === 'assistant'
        && typeof node.message?.content?.parts?.[0] === 'string'
        && node.message.content.parts[0].trim()
      );
      session.current_node = fallbackNode?.id || Object.keys(merged).at(-1);
      if (!merged[session.current_node]?.message) session.current_node = rootId;
    }

    if (!merged[session.current_node]) session.current_node = rootId;
    if (!merged[rootId].children?.length && merged[session.current_node]) {
      merged[rootId].children = [session.current_node];
      merged[session.current_node].parent = rootId;
    }

    return {
      ...session,
      mapping: merged,
      current_node: session.current_node
    };
  } catch {
    return null;
  }
};
