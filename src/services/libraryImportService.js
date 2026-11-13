const path = require('node:path');
const mammoth = require('mammoth');
const pdfParseMod = require('pdf-parse');

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
const HARD_STREAM_LIMIT_BYTES = 16 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.docx', '.pdf']);

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const FORBIDDEN_TEXT_MAGICS = [
  ZIP_MAGIC, PDF_MAGIC,
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from('GIF8', 'ascii'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0x4d, 0x5a]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
];

function createImportError(message, status = 422) {
  return Object.assign(new Error(message), { status, expose: true });
}

function hasValidMagicBytes(buffer, ext) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (ext === '.docx') {
    return buffer.length >= 30 && buffer.subarray(0, 4).equals(ZIP_MAGIC) && buffer.includes(Buffer.from('word/document.xml', 'utf8'));
  }
  if (ext === '.pdf') {
    return buffer.length >= 8 && buffer.subarray(0, 5).equals(PDF_MAGIC);
  }
  if (ext === '.txt' || ext === '.md') {
    if (buffer.includes(0x00)) return false;
    if (FORBIDDEN_TEXT_MAGICS.some((m) => buffer.length >= m.length && buffer.subarray(0, m.length).equals(m))) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return true; } catch { return false; }
  }
  return false;
}

async function extractTextFromFile({ originalname = '', buffer = null, fileTooLarge = false } = {}) {
  if (fileTooLarge || (Buffer.isBuffer(buffer) && buffer.length > MAX_IMPORT_FILE_BYTES)) {
    throw createImportError('파일 크기는 5MB 이하여야 합니다.', 422);
  }
  if (!originalname || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw createImportError('업로드할 파일을 선택해 주세요.', 422);
  }
  const ext = path.extname(String(originalname).trim()).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw createImportError('지원하지 않는 파일 형식입니다. (.txt, .md, .docx, .pdf 파일만 가능)', 422);
  }
  if (!hasValidMagicBytes(buffer, ext)) {
    throw createImportError('파일 확장자와 실제 파일 시그니처가 일치하지 않거나 손상된 파일입니다.', 422);
  }

  let rawText = '';
  if (ext === '.txt' || ext === '.md') {
    rawText = buffer.toString('utf8').replace(/^\uFEFF/, '');
  } else if (ext === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result && typeof result.value === 'string' ? result.value : '';
    } catch {
      throw createImportError('DOCX 파일에서 텍스트를 추출할 수 없습니다.', 422);
    }
  } else if (ext === '.pdf') {
    try {
      if (typeof pdfParseMod === 'function') {
        const parsed = await pdfParseMod(buffer);
        rawText = parsed && typeof parsed.text === 'string' ? parsed.text : '';
      } else if (pdfParseMod && typeof pdfParseMod.PDFParse === 'function') {
        const parser = new pdfParseMod.PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText({ pageJoiner: '' });
          rawText = parsed && typeof parsed.text === 'string' ? parsed.text : '';
        } finally {
          await parser.destroy();
        }
      }
    } catch {
      throw createImportError('PDF 파일에서 텍스트를 추출할 수 없습니다.', 422);
    }
  }

  const normalized = String(rawText || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw createImportError('파일에서 추출된 텍스트 내용이 없습니다.', 422);
  return normalized;
}

function matchQuestionHeading(line, prevLineBlank) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.length > 200) return null;
  const cleanMd = trimmed.replace(/^#{1,4}\s+/, '').trim();
  const numbered = cleanMd.match(/^(?:Q\s*\d+\s*[.):\-]?|문항\s*\d+\s*[.):\-]?|\[\s*문항\s*\d+\s*\]|\d+\s*[.)]|[\u2460-\u2473])\s*(.+)$/i);
  if (numbered && numbered[1].trim().length >= 2) return { question: cleanMd, title: numbered[1].trim().slice(0, 80) };
  if (/^#{1,3}\s+.+/.test(trimmed) && cleanMd.length >= 2) return { question: cleanMd, title: cleanMd.slice(0, 80) };
  if (prevLineBlank && cleanMd.length <= 150 && /\?\s*(?:\([^)]*\))?$/.test(cleanMd)) return { question: cleanMd, title: cleanMd.slice(0, 80) };
  return null;
}

function splitTextIntoLibraryEntries(rawText, { defaultTitlePrefix = '가져온 자소서' } = {}) {
  const normalized = String(rawText || '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const sections = [];
  let current = null;
  let prevBlank = true;

  for (const rawLine of normalized.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (current && current.bodyLines.length > 0) current.bodyLines.push('');
      prevBlank = true;
      continue;
    }
    const heading = matchQuestionHeading(trimmed, prevBlank);
    if (heading) {
      if (current && current.bodyLines.join('\n').trim()) {
        sections.push(current);
        current = { title: heading.title, question: heading.question, bodyLines: [] };
      } else if (current) {
        current.question = current.question ? `${current.question} ${heading.question}` : heading.question;
        current.title = current.title || heading.title;
      } else {
        current = { title: heading.title, question: heading.question, bodyLines: [] };
      }
      prevBlank = false;
      continue;
    }
    if (!current) current = { title: `${defaultTitlePrefix} 1`, question: '', bodyLines: [rawLine] };
    else current.bodyLines.push(rawLine);
    prevBlank = false;
  }

  if (current && current.bodyLines.join('\n').trim()) sections.push(current);
  else if (current && sections.length === 0 && current.question) {
    sections.push({ title: current.title || `${defaultTitlePrefix} 1`, question: '', bodyLines: [current.question] });
  }

  return sections.map((sec, idx) => {
    const body = sec.bodyLines.join('\n').trim();
    return { title: (sec.title || `${defaultTitlePrefix} ${idx + 1}`).trim().slice(0, 120), question: String(sec.question || '').trim().slice(0, 300), body, content: body, tags: '' };
  });
}

function parseMultipartBody(rawBuffer, boundary) {
  const fields = {};
  let file = null;
  let fileTooLarge = false;
  const boundaryBytes = Buffer.from(`--${boundary}`, 'utf8');
  const headerSep = Buffer.from('\r\n\r\n', 'utf8');

  for (let pos = rawBuffer.indexOf(boundaryBytes); pos !== -1; ) {
    const partStart = pos + boundaryBytes.length;
    if (rawBuffer[partStart] === 0x2d && rawBuffer[partStart + 1] === 0x2d) break;
    const contentStart = rawBuffer[partStart] === 0x0d && rawBuffer[partStart + 1] === 0x0a ? partStart + 2 : partStart;
    const nextBoundary = rawBuffer.indexOf(boundaryBytes, contentStart);
    if (nextBoundary === -1) break;
    const partEnd = rawBuffer[nextBoundary - 2] === 0x0d && rawBuffer[nextBoundary - 1] === 0x0a ? nextBoundary - 2 : nextBoundary;
    const partBuf = rawBuffer.subarray(contentStart, partEnd);
    const sepIdx = partBuf.indexOf(headerSep);
    if (sepIdx !== -1) {
      const headerText = partBuf.subarray(0, sepIdx).toString('utf8');
      const bodySlice = partBuf.subarray(sepIdx + 4);
      const nameMatch = headerText.match(/\bname="([^"]+)"/i);
      const filenameMatch = headerText.match(/\bfilename="([^"]*)"/i);
      const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
      if (filenameMatch) {
        if (bodySlice.length > MAX_IMPORT_FILE_BYTES) fileTooLarge = true;
        file = { fieldname: nameMatch ? nameMatch[1] : 'file', originalname: filenameMatch[1], mimetype: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream', buffer: bodySlice, size: bodySlice.length };
      } else if (nameMatch) {
        const k = nameMatch[1], v = bodySlice.toString('utf8');
        fields[k] = Object.prototype.hasOwnProperty.call(fields, k) ? (Array.isArray(fields[k]) ? [...fields[k], v] : [fields[k], v]) : v;
      }
    }
    pos = nextBoundary;
  }
  return { fields, file, fileTooLarge };
}

function multipartUploadMiddleware(req, res, next) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().startsWith('multipart/form-data')) return next();
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = m ? m[1] || m[2] : null;
  if (!boundary) return next();
  const chunks = [];
  let total = 0, exceeded = false;
  req.on('data', (c) => { total += c.length; if (total <= HARD_STREAM_LIMIT_BYTES) chunks.push(c); else exceeded = true; });
  req.on('error', next);
  req.on('end', () => {
    const { fields, file, fileTooLarge } = parseMultipartBody(Buffer.concat(chunks), boundary);
    req.body = { ...(req.body && typeof req.body === 'object' ? req.body : {}), ...fields };
    req.file = file;
    req.fileTooLarge = Boolean(fileTooLarge || exceeded);
    return next();
  });
}

function buildMinimalDocxBuffer(paragraphs = []) {
  const lines = Array.isArray(paragraphs) ? paragraphs : [String(paragraphs || '')];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const bodyXml = lines.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join('');
  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>` },
  ];
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) { c ^= buf[i]; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const e of entries) {
    const nBuf = Buffer.from(e.name, 'utf8'), dBuf = Buffer.from(e.data, 'utf8'), crc = crc32(dBuf);
    const lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dBuf.length, 18); lh.writeUInt32LE(dBuf.length, 22); lh.writeUInt16LE(nBuf.length, 26);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dBuf.length, 20); ch.writeUInt32LE(dBuf.length, 24); ch.writeUInt16LE(nBuf.length, 28); ch.writeUInt32LE(offset, 42);
    localParts.push(lh, nBuf, dBuf); centralParts.push(ch, nBuf);
    offset += lh.length + nBuf.length + dBuf.length;
  }
  const cBuf = Buffer.concat(centralParts), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cBuf, eocd]);
}

module.exports = {
  MAX_IMPORT_FILE_BYTES, ALLOWED_EXTENSIONS, hasValidMagicBytes,
  extractTextFromFile, splitTextIntoLibraryEntries, multipartUploadMiddleware, buildMinimalDocxBuffer,
};
