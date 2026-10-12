import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '../types'
import { hitTestDom } from '../tools/hitTest'
import { NodeLayer } from './NodeLayer'

const node = (id: string, text: string): Node => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  w: 200,
  h: 80,
  z: 1,
  parent: null,
  props: { text },
})

const layer = (over: Partial<React.ComponentProps<typeof NodeLayer>> = {}) => {
  const props = {
    nodes: [node('n1', 'first'), node('n2', 'second')],
    selection: new Set<string>(),
    editingId: 'n1',
    onEdit: vi.fn(),
    onMeasure: vi.fn(),
    onEndEdit: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
  render(<NodeLayer {...props} />)
  return props
}

describe('NodeLayer', () => {
  // Double-click is deliberately NOT handled here. The viewport captures the
  // pointer on pointer-down, and per the Pointer Events spec that retargets
  // `click` and `dblclick` to the capturing element, so a handler bound to a
  // node div never runs in the real app. One used to be bound here anyway and
  // was dead the whole time — jsdom has no pointer capture, so the unit test
  // asserting it passed happily while double-clicking an idle node did nothing
  // on screen. App interprets double-clicks centrally instead; the e2e suite
  // covers it, where pointer capture is real.
  it('binds no double-click handler of its own', () => {
    layer({ editingId: null })
    const wrapper = document.querySelector('[data-node-id="n2"]')!
    expect(wrapper.getAttribute('ondblclick')).toBeNull()
  })

  // The counterpart to the edit session starting. Without it App can never clear editingId,
  // so the board stays in "typing" mode from the first node created onward.
  it('reports the end of an edit session with the node id that ended it', () => {
    const onEndEdit = vi.fn()
    layer({ editingId: 'n1', onEndEdit })
    fireEvent.focusOut(screen.getByText('first'))
    expect(onEndEdit).toHaveBeenCalledWith('n1')
  })

  describe('spawn handles', () => {
    const handles = (id: string) =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-node-id="${id}"] > [data-part="handle"]`,
        ),
      )

    it('gives every node one handle per side', () => {
      layer({ editingId: null })
      expect(handles('n1').map((el) => el.dataset.dir)).toEqual(['n', 'e', 's', 'w'])
      expect(handles('n2')).toHaveLength(4)
    })

    // hitTestDom walks up from the hit element looking for data-part, then
    // data-node-id. A handle that carried its own data-node-id, or sat outside
    // the node's box in the DOM, would resolve to the wrong node or to none.
    it('marks each handle so hit-testing resolves it to its own node and side', () => {
      layer({ editingId: null })
      for (const el of handles('n1')) {
        expect(el.dataset.part).toBe('handle')
        expect(el.hasAttribute('data-node-id')).toBe(false)
        expect(el.closest('[data-node-id]')!.getAttribute('data-node-id')).toBe('n1')
      }
    })

    it('names the direction for assistive tech rather than relying on position alone', () => {
      layer({ editingId: null })
      const east = handles('n1').find((el) => el.dataset.dir === 'e')!
      expect(east.getAttribute('aria-label')).toMatch(/right/i)
    })

    // Each handle must sit on its own side. Getting two of them on the same
    // edge is invisible in a jsdom render but obvious on screen, so the
    // positioning is asserted rather than eyeballed.
    it('places each handle outside the border on its own side', () => {
      layer({ editingId: null })
      const at = (dir: string) => handles('n1').find((el) => el.dataset.dir === dir)!.style

      expect(at('n').top.startsWith('-')).toBe(true)
      expect(at('n').left).toBe('50%')
      expect(at('s').bottom.startsWith('-')).toBe(true)
      expect(at('s').left).toBe('50%')
      expect(at('w').left.startsWith('-')).toBe(true)
      expect(at('w').top).toBe('50%')
      expect(at('e').right.startsWith('-')).toBe(true)
      expect(at('e').top).toBe('50%')
    })

    // Not cosmetic. Hit-testing runs through elementFromPoint, which honours
    // pointer-events, so a handle that stayed interactive while invisible would
    // ring every node with a dead zone that swallowed marquee drags.
    it('keeps handles out of hit-testing until their node is hovered', () => {
      layer({ editingId: null })
      const css = document.querySelector('style')!.textContent!
      expect(css).toMatch(
        /\[data-node-id\]\s*>\s*\[data-part="handle"\][^}]*pointer-events:\s*none/,
      )
      expect(css).toMatch(
        /\[data-node-id\]:hover\s*>\s*\[data-part="handle"\][^}]*pointer-events:\s*auto/,
      )
    })

    // The gap between a node's border and its handles, and the moment of
    // leaving the border on the way to one, both un-hover the node. The halo
    // is what stops the handles blinking out mid-reach.
    it('surrounds each node with a hover halo that reaches its handles', () => {
      layer({ editingId: null })
      const halo = screen.getByTestId('halo-n1')
      const reach = -parseFloat(halo.style.inset)
      const handle = handles('n1').find((el) => el.dataset.dir === 'n')!
      const handleSize = parseFloat(handle.style.width)
      const handleOut = -parseFloat(handle.style.top)
      // At least to the middle of each handle, so there is no gap between
      // the halo and the handle where the node would un-hover.
      expect(reach).toBeGreaterThanOrEqual(handleOut - handleSize / 2)
      // Behind the node, so it never covers the body's own hit area.
      expect(halo.style.zIndex).toBe('-1')
    })

    // Without data-hit="none" the hit-test walk would reach the node and
    // report it, so pressing anywhere near a node would select it and a
    // marquee could never be started from that space.
    it('marks the halo as hover-only so a press inside it still hits canvas', () => {
      layer({ editingId: null })
      expect(screen.getByTestId('halo-n1').getAttribute('data-hit')).toBe('none')
      expect(hitTestDom(screen.getByTestId('halo-n1'))).toBeNull()
    })

    it('hides them again while the node is being dragged', () => {
      layer({ editingId: null, dragPreview: { ids: new Set(['n1']), dx: 5, dy: 5 } })
      const css = document.querySelector('style')!.textContent!
      expect(css).toMatch(/\[data-dragging="true"\]\s*>\s*\[data-part="handle"\][^}]*opacity:\s*0/)
    })

  })

  describe('delete button', () => {
    it('gives every node one', () => {
      layer({ editingId: null })
      expect(screen.getByTestId('delete-n1')).toBeDefined()
      expect(screen.getByTestId('delete-n2')).toBeDefined()
    })

    it('deletes its own node', () => {
      const onDelete = vi.fn()
      layer({ editingId: null, onDelete })
      fireEvent.pointerDown(screen.getByTestId('delete-n2'))
      expect(onDelete).toHaveBeenCalledWith('n2')
    })

    // Deliberately pointer-down, not click: the viewport captures the pointer
    // and the spec retargets `click` to the capturing element, so an onClick
    // bound here would never fire in the real app — the same trap that left
    // NodeLayer's old double-click handler dead.
    it('acts on pointer-down, because click never reaches it in the real app', () => {
      const onDelete = vi.fn()
      layer({ editingId: null, onDelete })
      fireEvent.click(screen.getByTestId('delete-n1'))
      expect(onDelete).not.toHaveBeenCalled()
      fireEvent.pointerDown(screen.getByTestId('delete-n1'))
      expect(onDelete).toHaveBeenCalledWith('n1')
    })

    // Otherwise the viewport also sees the press and starts selecting or
    // dragging the node that is about to disappear.
    it('stops the press reaching the board underneath', () => {
      const onDelete = vi.fn()
      const onBoardPointerDown = vi.fn()
      render(
        <div onPointerDown={onBoardPointerDown}>
          <NodeLayer
            nodes={[node('n3', 'third')]}
            selection={new Set()}
            editingId={null}
            onEdit={vi.fn()}
            onMeasure={vi.fn()}
            onEndEdit={vi.fn()}
            onDelete={onDelete}
          />
        </div>,
      )
      fireEvent.pointerDown(screen.getByTestId('delete-n3'))
      expect(onDelete).toHaveBeenCalledWith('n3')
      expect(onBoardPointerDown).not.toHaveBeenCalled()
    })
  })

  // Spec §7: the ephemeral drag store exists so the gesture can be *seen*.
  // Without this the node sat at its committed position for the whole drag
  // and jumped only on release.
  describe('drag preview', () => {
    const box = (id: string) => document.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!

    it('paints the in-flight offset on the dragged node only', () => {
      layer({
        editingId: null,
        dragPreview: { ids: new Set(['n1']), dx: 40, dy: -15 },
      })
      // node() places both at x:0 y:0.
      expect(box('n1').style.left).toBe('40px')
      expect(box('n1').style.top).toBe('-15px')
      expect(box('n2').style.left).toBe('0px')
      expect(box('n2').style.top).toBe('0px')
    })

    it('follows the pointer as the offset grows', () => {
      const { rerender } = render(
        <NodeLayer
          nodes={[node('n1', 'first')]}
          selection={new Set()}
          editingId={null}
          onEdit={vi.fn()}
          onMeasure={vi.fn()}
          onEndEdit={vi.fn()}
          onDelete={vi.fn()}
          dragPreview={{ ids: new Set(['n1']), dx: 10, dy: 10 }}
        />,
      )
      expect(box('n1').style.left).toBe('10px')
      rerender(
        <NodeLayer
          nodes={[node('n1', 'first')]}
          selection={new Set()}
          editingId={null}
          onEdit={vi.fn()}
          onMeasure={vi.fn()}
          onEndEdit={vi.fn()}
          onDelete={vi.fn()}
          dragPreview={{ ids: new Set(['n1']), dx: 90, dy: 55 }}
        />,
      )
      expect(box('n1').style.left).toBe('90px')
      expect(box('n1').style.top).toBe('55px')
    })

    it('paints committed positions when no drag is in flight', () => {
      layer({ editingId: null, dragPreview: null })
      expect(box('n1').style.left).toBe('0px')
      expect(box('n1').style.top).toBe('0px')
    })
  })
})

describe('NodeLayer box-less nodes', () => {
  const bare = (): Node => ({ ...node('b1', 'bare'), props: { text: 'bare', boxless: true } })
  const outer = () => document.querySelector<HTMLElement>('[data-node-id="b1"]')!

  it('draws no card behind box-less text', () => {
    layer({ nodes: [bare()], editingId: null })
    expect(outer().style.background).toBe('transparent')
    expect(outer().style.boxShadow).toBe('none')
    expect(outer().style.borderColor).toBe('transparent')
  })

  // The border keeps its width so the box does not change size, and the
  // selection still has an outline to show.
  it('still outlines a selected box-less node', () => {
    layer({ nodes: [bare()], editingId: null, selection: new Set(['b1']) })
    expect(outer().style.borderStyle).toBe('dashed')
    expect(outer().style.borderColor).toBe('rgb(45, 99, 214)')
  })
})

describe('NodeLayer branch colours', () => {
  const outer = () => document.querySelector<HTMLElement>('[data-node-id="n1"]')!

  it('draws a node`s border in its branch colour, with a faint wash on the card', () => {
    layer({ editingId: null, colors: new Map([['n1', '#c96a6a']]) })
    expect(outer().style.borderColor).toBe('rgb(201, 106, 106)')
    expect(outer().style.background).not.toBe('rgb(253, 252, 249)')
  })

  it('draws a node with no branch colour in ink', () => {
    layer({ editingId: null })
    expect(outer().style.borderColor).toBe('rgb(26, 26, 26)')
  })

  // The colour wheel opens on a selected node; hiding its colour under a
  // selection border would hide the very thing being changed.
  it('keeps the branch colour while selected, ringing the node instead', () => {
    layer({ editingId: null, selection: new Set(['n1']), colors: new Map([['n1', '#c96a6a']]) })
    expect(outer().style.borderColor).toBe('rgb(201, 106, 106)')
    expect(outer().style.outline).toContain('solid')
  })
})

describe('NodeLayer media nodes', () => {
  const pic = (): Node => ({
    id: 'm1', type: 'image', x: 0, y: 0, w: 300, h: 200, z: 1, parent: null, props: { name: 'a.png' },
  })
  const outer = () => document.querySelector<HTMLElement>('[data-node-id="m1"]')!

  // A picture on the board is just the picture: no card, border or shadow.
  it('draws no frame round media', () => {
    layer({ nodes: [pic()], editingId: null, colors: new Map([['m1', '#c96a6a']]) })
    expect(outer().style.background).toBe('transparent')
    expect(outer().style.boxShadow).toBe('none')
    expect(parseFloat(outer().style.borderWidth || '0')).toBe(0)
    expect(outer().style.borderColor).toBe('')
  })

  it('still rings selected media', () => {
    layer({ nodes: [pic()], editingId: null, selection: new Set(['m1']) })
    expect(outer().style.outline).toContain('solid')
  })
})
