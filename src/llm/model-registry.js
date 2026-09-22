const models = [
  {
    id: 'zero-auto',
    provider: 'chatgpt-web',
    backendModel: 'auto',
    capabilities: {
      stream: true,
      tools: true,
      vision: false,
      reasoning: true
    }
  }
];

exports.list = () => models.map((item) => ({
  ...item,
  capabilities: { ...item.capabilities }
}));

exports.get = (id) => {
  const found = models.find((item) => item.id === id);
  return found ? { ...found, capabilities: { ...found.capabilities } } : null;
};
