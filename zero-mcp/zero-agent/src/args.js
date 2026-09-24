'use strict';

const parseArgs = (argv = []) => {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      out._.push(item);
      continue;
    }
    const raw = item.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      out[raw.slice(0, eq)] = raw.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[raw] = next;
      index += 1;
    } else {
      out[raw] = true;
    }
  }
  return out;
};

module.exports = { parseArgs };
