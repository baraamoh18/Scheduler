// Encodes text as Windows-1256 (the encoding older Arabic Excel uses for CSV files).
function toWindows1256(text) {
  const dec = new TextDecoder('windows-1256'), map = new Map();
  for (let b = 0; b < 256; b++) map.set(dec.decode(Uint8Array.of(b)), b);
  return Buffer.from([...text].map(ch => { if (!map.has(ch)) throw new Error('not in Windows-1256: ' + ch); return map.get(ch); }));
}
module.exports = { toWindows1256 };
