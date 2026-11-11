'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Worker} = require('node:worker_threads');
const yauzl = require('yauzl');
const { SaxesParser } = require('saxes');

const SUPPORTED_TYPES = new Set(['.txt', '.md', '.csv', '.log', '.docx', '.pdf']);
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_DOCX_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_XML_BYTES = 1024 * 1024;
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main'
]);

function readWordXml(data) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, archive) => {
      if (error) return reject(new Error('Could not read this DOCX archive'));
      const fail = message => { archive.close(); reject(new Error(message)); };
      if (archive.entryCount > 512) return fail('DOCX contains too many entries');
      archive.on('error', () => fail('Could not read this DOCX archive'));
      archive.once('end', () => fail('DOCX has no Word document body'));
      archive.on('entry', entry => {
        if (entry.fileName !== 'word/document.xml') return archive.readEntry();
        if (entry.uncompressedSize > MAX_XML_BYTES) return fail('DOCX XML exceeds the 1 MiB limit');
        if (entry.isEncrypted()) return fail('Encrypted DOCX documents cannot be imported');
        archive.openReadStream(entry, (error, stream) => {
          if (error) return fail('Could not read the DOCX document body');
          const chunks = [];
          let length = 0;
          stream.on('data', chunk => {
            length += chunk.length;
            if (length > MAX_XML_BYTES) return stream.destroy(new Error('DOCX XML exceeds the 1 MiB limit'));
            chunks.push(chunk);
          });
          stream.once('error', () => fail('DOCX XML could not be read within its size limit'));
          stream.once('end', () => { archive.close(); resolve(Buffer.concat(chunks, length)); });
        });
      });
      archive.readEntry();
    });
  });
}

async function extractWordText(data) {
  const xml = decodeText(await readWordXml(data));
  const parser = new SaxesParser({ xmlns: true });
  const parts = [];
  let root = false, inText = false;
  parser.on('doctype', () => { throw new Error('DOCX document types are not allowed'); });
  parser.on('error', () => { throw new Error('DOCX contains invalid Word XML'); });
  parser.on('opentag', tag => {
    if (!root) {
      if (tag.local !== 'document' || !WORD_NAMESPACES.has(tag.uri)) throw new Error('DOCX contains no Word document body');
      root = true;
    }
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    if (tag.local === 't') inText = true;
    if (tag.local === 'tab') parts.push('\t');
    if (tag.local === 'br') parts.push('\n');
  });
  parser.on('text', value => { if (inText) parts.push(value); });
  parser.on('cdata', value => { if (inText) parts.push(value); });
  parser.on('closetag', tag => {
    if (!WORD_NAMESPACES.has(tag.uri)) return;
    if (tag.local === 't') inText = false;
    if (tag.local === 'p') parts.push('\n');
  });
  parser.write(xml).close();
  return parts.join('').trim();
}

function decodeText(data) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new Error('Project document is not valid UTF-8'); }
}

function extractPdfText(data) {
  return new Promise((resolve,reject)=>{
    const workerDirectory=__dirname.replace(/([\\/])app\.asar(?=[\\/])/,'$1app.asar.unpacked');
    const worker=new Worker(path.join(workerDirectory,'foreman-pdf-worker.cjs'),{
      workerData:data,resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:24}
    });
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('PDF extraction exceeded its time limit'));},8000);
    worker.once('message',result=>{
      clearTimeout(timer);
      worker.terminate();
      if(result.error)reject(new Error(result.error));
      else resolve(result.content);
    });
    worker.once('error',()=>{clearTimeout(timer);reject(new Error('PDF extraction worker could not complete'));});
    worker.once('exit',()=>{clearTimeout(timer);reject(new Error('PDF extraction worker stopped before returning text'));});
  });
}

/** Only call with a path selected in the host's native file picker. */
async function readApprovedDocument(selectedPath) {
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath) || selectedPath.startsWith('\\\\')) {
    throw new Error('Choose a local document on this PC');
  }
  const source = fs.realpathSync(selectedPath);
  if (source.startsWith('\\\\')) throw new Error('Choose a local document on this PC');
  const extension = path.extname(source).toLowerCase();
  if (!SUPPORTED_TYPES.has(extension)) throw new Error('Unsupported document type. Choose PDF, DOCX or UTF-8 text.');
  const limit = extension === '.pdf' ? MAX_PDF_BYTES : extension === '.docx' ? MAX_DOCX_BYTES : MAX_DOCUMENT_BYTES;
  const fd = fs.openSync(source, 'r');
  let data;
  try {
    const info = fs.fstatSync(fd);
    if (!info.isFile()) throw new Error('Choose a regular document file');
    if (info.size > limit) throw new Error(`Selected document exceeds the ${limit / 1024} KiB limit`);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > limit) throw new Error(`Selected document exceeds the ${limit / 1024} KiB limit`);
    data = bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
  const content = extension === '.pdf' ? await extractPdfText(data) : extension === '.docx' ? await extractWordText(data) : decodeText(data);
  if (content.includes('\0') || !content.trim()) throw new Error('Document contains no usable text');
  if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) throw new Error('Extracted text exceeds the 128 KiB limit');
  return {
    source,
    sourceKey: process.platform === 'win32' ? source.toLowerCase() : source,
    name: path.basename(source),
    content,
    sha256: crypto.createHash('sha256').update(data).digest('hex')
  };
}

module.exports = { readApprovedDocument };
