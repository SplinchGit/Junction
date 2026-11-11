'use strict';
function textPdf(text) {
  const stream=`BT /F1 12 Tf 30 120 Td (${text}) Tj ET`;
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];
  let pdf='%PDF-1.4\n';const offsets=[];
  for(const [index,object] of objects.entries()){offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const start=pdf.length;
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return pdf;
}

module.exports={textPdf};
