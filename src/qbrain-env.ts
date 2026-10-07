/**
 * Projects QBRAINAI_* onto MCP_* before other modules read process env.
 * QBRAINAI_* wins. MCP_UNTRUSTED stays a sentinel and is not aliased.
 */
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith('QBRAINAI_') || value === undefined) {
    continue;
  }
  const suffix = key.slice('QBRAINAI_'.length);
  if (suffix === 'UNTRUSTED') {
    continue;
  }
  process.env[`MCP_${suffix}`] = value;
}

export {};
