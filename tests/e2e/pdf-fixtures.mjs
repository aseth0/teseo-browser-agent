// Small PDFs made for the e2e: one whose pages have text, one that is only a picture (a scan).

// A PDF of these objects (numbered from 1; the first is the catalog), with its cross-reference table.
function pdfOf(objects) {
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out, 'latin1');
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const stream = (content, dict = '') => `<< ${dict} /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
const page = (content, resources) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources ${resources} >>`;

// Two pages of text, in Helvetica.
export const TEXT_PDF = pdfOf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  page(4, '<< /Font << /F1 7 0 R >> >>'),
  stream('BT /F1 14 Tf 72 720 Td (Hello from example.com, page one.) Tj ET'),
  page(6, '<< /Font << /F1 7 0 R >> >>'),
  stream('BT /F1 14 Tf 72 720 Td (The second page of the report.) Tj ET'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
]);

// One page with only an 8×8 grey picture on it: no text layer.
const pixels = Buffer.alloc(8 * 8 * 3, 0x80).toString('latin1');
export const SCANNED_PDF = pdfOf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  page(4, '<< /XObject << /Im1 5 0 R >> >>'),
  stream('q 400 0 0 400 100 200 cm /Im1 Do Q'),
  stream(pixels, '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8'),
]);
