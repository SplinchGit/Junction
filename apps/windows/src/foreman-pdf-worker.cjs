'use strict';

const {parentPort, workerData} = require('node:worker_threads');

async function extract() {
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({
    data: new Uint8Array(workerData),
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0
  });
  try {
    const document = await loading.promise;
    if(document.numPages > 40)return {error:'PDF exceeds the 40-page limit'};
    const pages=[];
    let bytes=0;
    for(let index=1;index<=document.numPages;index++){
      const page=await document.getPage(index);
      const {items}=await page.getTextContent();
      const text=items.filter(item=>typeof item.str==='string').map(item=>item.str+(item.hasEOL?'\n':' ')).join('').trim();
      bytes+=Buffer.byteLength(text)+1;
      if(bytes>128*1024)return {error:'PDF extracted text exceeds the 128 KiB limit'};
      pages.push(text);
      page.cleanup();
    }
    const content=pages.join('\n').trim();
    return content?{content}:{error:'PDF contains no selectable text. Scanned pages require OCR.'};
  } finally {
    await loading.destroy();
  }
}

extract().then(result=>parentPort.postMessage(result),()=>parentPort.postMessage({error:'Could not read PDF text. The PDF may be damaged or encrypted.'}));
