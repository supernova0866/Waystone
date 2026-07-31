function parseBackupCodes(rawText) {
  return rawText
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function consumeCode(codes) {
  if (!codes || codes.length === 0) return { code: null, remaining: [] };
  const [code, ...remaining] = codes;
  return { code, remaining };
}

export { parseBackupCodes, consumeCode };
