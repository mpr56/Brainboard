/**
 * A one-page PDF that is a single JPEG, scaled to fill the page.
 *
 * Written by hand rather than with a PDF library because this is all export
 * needs, and the format for it is small: a catalogue, a page tree, one page,
 * the image (JPEG is a filter PDF readers decode natively, so the bytes go in
 * untouched) and a three-operator content stream that draws it. The one fiddly
 * part is the cross-reference table, which must give every object's exact byte
 * offset — which is why the file is assembled from byte chunks with a running
 * length rather than as a string.
 */
export function jpegToPdf(
  jpeg: Uint8Array,
  pixels: { w: number; h: number },
  pagePt: { w: number; h: number },
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  const offsets: number[] = []
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const obj = (n: number, body: string) => {
    offsets[n] = length
    push(`${n} 0 obj\n${body}\nendobj\n`)
  }

  const W = pagePt.w.toFixed(2)
  const H = pagePt.h.toFixed(2)
  const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`

  push('%PDF-1.4\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  )
  offsets[4] = length
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixels.w} /Height ${pixels.h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)

  const xref = length
  const rows = ['0000000000 65535 f \n']
  for (let n = 1; n <= 5; n++) rows.push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`xref\n0 6\n${rows.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** CSS pixels to PDF points: a CSS pixel is 1/96 in, a point 1/72 in. */
export const PX_TO_PT = 72 / 96
