import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '../types'
import {
  DEFAULT_EXPORT,
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  clampScale,
  effectiveOptions,
  exportContent,
  exportFileName,
  exportFrame,
  wrapText,
} from './layout'
import { jpegToPdf } from './pdf'

/** Every character is 10 wide. */
const mono = (s: string) => s.length * 10

describe('wrapText', () => {
  it('leaves a line that fits alone', () => {
    expect(wrapText('hello world', 200, mono)).toEqual(['hello world'])
  })

  it('wraps at word boundaries', () => {
    expect(wrapText('aaa bbb ccc', 75, mono)).toEqual(['aaa bbb', 'ccc'])
  })

  it('keeps hard line breaks, including empty lines', () => {
    expect(wrapText('one\n\ntwo', 200, mono)).toEqual(['one', '', 'two'])
  })

  it('breaks a word too long for any line', () => {
    expect(wrapText('abcdefghij', 40, mono)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('export framing', () => {
  const n = (id: string, x: number, y: number): Node => ({
    id, type: 'text', x, y, w: 100, h: 50, z: 1, parent: null, props: {},
  })
  const e = (id: string, from: string, to: string): Edge => ({
    id, from: { nodeId: from }, to: { nodeId: to }, style: { kind: 'curve', arrow: 'end', color: '#000' },
  })

  it('covers every node plus padding', () => {
    expect(exportFrame([n('a', 0, 0), n('b', 300, 200)], 10)).toEqual({ x: -10, y: -10, w: 420, h: 270 })
  })

  it('has nothing to frame on an empty board', () => {
    expect(exportFrame([])).toBeNull()
  })

  it('exports only the selection and the links inside it', () => {
    const nodes = [n('a', 0, 0), n('b', 200, 0), n('c', 400, 0)]
    const edges = [e('ab', 'a', 'b'), e('bc', 'b', 'c')]
    const out = exportContent(nodes, edges, 'selection', new Set(['a', 'b']))
    expect(out.nodes.map((x) => x.id)).toEqual(['a', 'b'])
    expect(out.edges.map((x) => x.id)).toEqual(['ab'])
  })

  it('exports the whole board when "selection" is asked for with nothing selected', () => {
    const nodes = [n('a', 0, 0)]
    expect(exportContent(nodes, [], 'selection', new Set()).nodes).toBe(nodes)
  })
})

describe('clampScale', () => {
  it('keeps the asked-for scale when it fits', () => {
    expect(clampScale({ w: 1000, h: 800 }, 2)).toBe(2)
  })

  it('shrinks the scale for a board too big for a canvas', () => {
    const s = clampScale({ w: 20000, h: 20000 }, 3)
    expect(20000 * s).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    expect(20000 * s * 20000 * s).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1)
  })
})

describe('effectiveOptions', () => {
  it('turns a transparent JPEG or PDF white', () => {
    expect(effectiveOptions({ ...DEFAULT_EXPORT, format: 'jpeg', background: 'transparent' }).background).toBe('white')
    expect(effectiveOptions({ ...DEFAULT_EXPORT, format: 'pdf', background: 'transparent' }).background).toBe('white')
  })

  it('keeps a transparent PNG transparent', () => {
    expect(effectiveOptions({ ...DEFAULT_EXPORT, format: 'png', background: 'transparent' }).background).toBe(
      'transparent',
    )
  })
})

describe('exportFileName', () => {
  it('names the file after the board and the day', () => {
    expect(exportFileName('My board', 'jpeg', new Date('2026-10-10T12:00:00Z'))).toBe('My-board-2026-10-10.jpg')
    expect(exportFileName('My board', 'board', new Date('2026-10-10T12:00:00Z'))).toBe('My-board-2026-10-10.brainboard.json')
    expect(exportFileName('', 'pdf', new Date('2026-10-10T12:00:00Z'))).toBe('board-2026-10-10.pdf')
  })
})

describe('jpegToPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
  const pdf = jpegToPdf(jpeg, { w: 40, h: 30 }, { w: 30, h: 22.5 })
  const text = new TextDecoder('latin1').decode(pdf)

  it('is a PDF that ends properly', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('embeds the JPEG bytes untouched', () => {
    const at = text.indexOf('stream\n') + 'stream\n'.length
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg])
  })

  it('points every cross-reference entry at its object', () => {
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((off, i) => expect(text.slice(off, off + 7)).toBe(`${i + 1} 0 obj`))
  })

  it('sizes the page in points', () => {
    expect(text).toContain('/MediaBox [0 0 30.00 22.50]')
  })
})
