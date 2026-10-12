import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Node } from '../../types'
import { NEW_NODE_TEXT } from '../../document/create'
import { TEXT_NODE_TYPE } from './TextNode'

const node: Node = {
  id: 'n1',
  type: 'text',
  x: 0,
  y: 0,
  w: 200,
  h: 80,
  z: 1,
  parent: null,
  props: { text: 'hello world' },
}

const View = TEXT_NODE_TYPE.View

describe('TextNode', () => {
  it('renders its text', () => {
    render(<View node={node} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    expect(screen.getByText('hello world')).toBeDefined()
  })

  it('renders empty text without crashing', () => {
    const blank = { ...node, props: {} }
    render(<View node={blank} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    expect(screen.getByTestId('text-node-body')).toBeDefined()
  })

  it('is contenteditable only while editing', () => {
    const { rerender } = render(
      <View node={node} state={{ selected: true, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
    )
    expect(screen.getByTestId('text-node-body').getAttribute('contenteditable')).toBe('false')

    rerender(<View node={node} state={{ selected: true, editing: true }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    expect(screen.getByTestId('text-node-body').getAttribute('contenteditable')).toBe('true')
  })

  it('commits text on blur', () => {
    const onEdit = vi.fn()
    render(<View node={node} state={{ selected: true, editing: true }} onEdit={onEdit} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    const body = screen.getByTestId('text-node-body')
    body.textContent = 'changed'
    fireEvent.focusOut(body)
    expect(onEdit).toHaveBeenCalledWith({ props: { text: 'changed' } })
  })

  // Regression: without this signal nothing upstream can learn that the edit
  // session is over. `editingId` then stays set for the rest of the session,
  // which (a) keeps the keyboard in "typing" mode so Delete/v/c never fire and
  // (b) keeps TextNode's frozen draft in play, so the view stops reflecting
  // the document — an undo of the edit changes nothing on screen.
  it('reports the end of the edit session on blur', () => {
    const onEndEdit = vi.fn()
    render(
      <View
        node={node}
        state={{ selected: true, editing: true }}
        onEdit={vi.fn()}
        onMeasure={vi.fn()}
        onEndEdit={onEndEdit}
      />,
    )
    fireEvent.focusOut(screen.getByTestId('text-node-body'))
    expect(onEndEdit).toHaveBeenCalledTimes(1)
  })

  // The blur can arrive after `editing` has already flipped false (a
  // pointer-down elsewhere clears editingId before the browser moves focus).
  // The commit must still happen, or the typed text is silently discarded.
  it('still commits text on a blur that arrives after editing has flipped false', () => {
    const onEdit = vi.fn()
    const onEndEdit = vi.fn()
    const { rerender } = render(
      <View
        node={node}
        state={{ selected: true, editing: true }}
        onEdit={onEdit}
        onMeasure={vi.fn()}
        onEndEdit={onEndEdit}
      />,
    )
    const body = screen.getByTestId('text-node-body')
    body.textContent = 'typed before the click away'
    rerender(
      <View
        node={node}
        state={{ selected: true, editing: false }}
        onEdit={onEdit}
        onMeasure={vi.fn()}
        onEndEdit={onEndEdit}
      />,
    )
    fireEvent.focusOut(screen.getByTestId('text-node-body'))
    expect(onEdit).toHaveBeenCalledWith({ props: { text: 'typed before the click away' } })
  })

  it('declares itself dom-only false and provides a default size', () => {
    expect(TEXT_NODE_TYPE.domOnly).toBe(false)
    // The height is one laid-out line: 13px padding top and bottom, a 21px
    // line box (15px at 1.4), and the node's 2px border top and bottom. It is not a roomier round number on
    // purpose — measurement corrects a node's `h` but never its `y`, so an
    // over-estimate leaves every new node sitting above the point it was
    // created at and every spawned child off its parent's axis. An e2e test
    // pins this to the height the browser actually lays out.
    expect(TEXT_NODE_TYPE.defaultSize()).toEqual({ w: 240, h: 51 })
  })

  it('does not clobber an in-progress edit when text changes while still editing', () => {
    const { rerender } = render(
      <View node={node} state={{ selected: true, editing: true }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
    )
    const body = screen.getByTestId('text-node-body')

    // Simulate what a live contentEditable does when the user presses Enter:
    // it mutates the DOM directly, diverging from the single text child
    // React believes it rendered.
    body.innerHTML = 'hello<br>world'

    const changed: Node = { ...node, props: { text: 'server text' } }
    expect(() =>
      rerender(
        <View node={changed} state={{ selected: true, editing: true }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
      ),
    ).not.toThrow()

    // The in-progress edit is not clobbered: the rendered draft did not
    // change, so React never touched this child's DOM.
    expect(screen.getByTestId('text-node-body').innerHTML).toBe('hello<br>world')
  })

  it('reflects an external text change when not editing', () => {
    const { rerender } = render(
      <View node={node} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
    )
    const changed: Node = { ...node, props: { text: 'updated from sync' } }
    rerender(
      <View node={changed} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
    )
    expect(screen.getByText('updated from sync')).toBeDefined()
  })
})

describe('TextNode formatting', () => {
  const styled = (props: Record<string, unknown>) => ({ ...node, props: { ...node.props, ...props } })

  it('sets its text from the node`s style', () => {
    render(
      <View node={styled({ fontSize: 26, bold: true, italic: true, underline: true })} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />,
    )
    const el = screen.getByTestId('text-node-body')
    expect(el.style.fontSize).toBe('26px')
    expect(el.style.fontWeight).toBe('700')
    expect(el.style.fontStyle).toBe('italic')
    expect(el.style.textDecoration).toBe('underline')
  })

  it('toggles bold on ⌘B while editing, keeping the rest of props', () => {
    const onEdit = vi.fn()
    render(<View node={styled({ color: '#123456' })} state={{ selected: true, editing: true }} onEdit={onEdit} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('text-node-body'), { key: 'b', metaKey: true })
    expect(onEdit).toHaveBeenCalledWith({ props: { text: 'hello world', color: '#123456', bold: true } })
  })

  it('leaves ⌘B alone when not editing', () => {
    const onEdit = vi.fn()
    render(<View node={node} state={{ selected: true, editing: false }} onEdit={onEdit} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    fireEvent.keyDown(screen.getByTestId('text-node-body'), { key: 'b', metaKey: true })
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('TextNode placeholder', () => {
  const empty = { ...node, props: { text: '' } }
  const body = () => screen.getByTestId('text-node-body')

  it('shows the prompt on an empty node without making it text', () => {
    render(<View node={empty} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    expect(body().getAttribute('data-empty')).toBe('true')
    expect(body().getAttribute('data-placeholder')).toBe(NEW_NODE_TEXT)
    expect(body().textContent).toBe('')
  })

  it('drops the prompt as soon as something is typed', () => {
    render(<View node={empty} state={{ selected: true, editing: true }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    body().textContent = 'h'
    fireEvent.input(body())
    expect(body().getAttribute('data-empty')).toBeNull()
  })

  it('commits only what was typed', () => {
    const onEdit = vi.fn()
    render(<View node={empty} state={{ selected: true, editing: true }} onEdit={onEdit} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    body().textContent = 'hello'
    fireEvent.blur(body())
    expect(onEdit).toHaveBeenCalledWith({ props: { text: 'hello' } })
  })

  it('does not show the prompt on a node with text', () => {
    render(<View node={node} state={{ selected: false, editing: false }} onEdit={vi.fn()} onMeasure={vi.fn()} onEndEdit={vi.fn()} />)
    expect(body().getAttribute('data-empty')).toBeNull()
  })
})
