// Text out of Word (.docx) and PowerPoint (.pptx) files. Both are zip archives of XML, so Node's zlib is enough.
import { inflateRawSync } from 'node:zlib';

// Minimal zip reader via the central directory: { 'path/in/zip': () => Buffer }.
// ponytail: no zip64, fine for Office files under the 10 MB upload limit
export function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip file');
  const files = {};
  let p = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + size);
    files[name] = () => method === 8 ? inflateRawSync(data) : data;
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
// One line per paragraph (<w:p> in Word, <a:p> in PowerPoint), joining its text runs (<w:t> / <a:t>).
const paragraphs = (xml, ns) => xml.split(`</${ns}:p>`)
  .map(p => [...p.matchAll(new RegExp(`<${ns}:t(?:\\s[^>]*)?>([^<]*)</${ns}:t>`, 'g'))].map(m => decode(m[1])).join(''))
  .filter(t => t.trim()).join('\n');

export function docxText(buf) {
  const doc = unzip(buf)['word/document.xml'];
  if (!doc) throw new Error('not a Word document');
  return paragraphs(doc().toString('utf8'), 'w');
}

// One string per slide, in slide order, so citations can point at slide numbers.
export function pptxSlides(buf) {
  const files = unzip(buf);
  const slides = Object.keys(files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => a.match(/\d+/)[0] - b.match(/\d+/)[0]);
  if (!slides.length) throw new Error('not a PowerPoint file');
  return slides.map(n => paragraphs(files[n]().toString('utf8'), 'a'));
}
