// Stand-in for tesseract.js: "reads" a page whose rows the test set in window.__OCR_ROWS
// ([[name, price], ...]), laid out like a right-to-left price list: name on the right, price on the left.
(function () {
  const rows = () => window.__OCR_ROWS || [];
  const word = (text, x0, x1, y) => ({ text, confidence: 90, bbox: { x0, x1, y0: y - 12, y1: y + 12 } });
  function page() {
    return rows().map(([name, price], i) => {
      const y = 200 + i * 60, words = [];
      let x = 1900;
      for (const w of String(name).split(' ')) { const wd = 20 * w.length; words.push(word(w, x - wd, x, y)); x -= wd + 14; }
      words.push(word(String(price), 300, 300 + 20 * String(price).length, y));
      return { words, bbox: { x0: 300, x1: 1900, y0: y - 12, y1: y + 12 } };
    });
  }
  window.Tesseract = {
    createWorker: async (lang) => ({
      setParameters: async () => {},
      terminate: async () => {},
      recognize: async (canvas, opts) => {
        const lines = page();
        if (lang === 'eng' && opts && opts.rectangle) { // the digits-only pass over the price column
          const r = opts.rectangle;
          return { data: { words: lines.flatMap(l => l.words).filter(w => /^[\d.,]+$/.test(w.text) && w.bbox.x0 >= r.left && w.bbox.x1 <= r.left + r.width) } };
        }
        return { data: { lines, words: lines.flatMap(l => l.words) } };
      },
    }),
  };
})();
