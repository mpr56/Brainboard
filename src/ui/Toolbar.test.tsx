import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EdgeStyleKind } from '../types'
import { EDGE_STYLE_KINDS, Toolbar, nextEdgeStyle } from './Toolbar'

const toolbar = (edgeStyle: EdgeStyleKind, onEdgeStyle = vi.fn()) => {
  render(
    <Toolbar
      onAddText={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      zoom={1}
      onZoom={vi.fn()}
      edgeStyle={edgeStyle}
      onEdgeStyle={onEdgeStyle}
    />,
  )
  return onEdgeStyle
}

describe('connector style control', () => {
  it('cycles through every routing style and back, so all three are reachable', () => {
    const seen: EdgeStyleKind[] = []
    let kind: EdgeStyleKind = 'curve'
    for (let i = 0; i < EDGE_STYLE_KINDS.length; i++) {
      seen.push(kind)
      kind = nextEdgeStyle(kind)
    }
    expect(seen).toEqual(EDGE_STYLE_KINDS)
    expect(kind).toBe('curve')
  })

  it('shows the current style and reports the next one on click', () => {
    const onEdgeStyle = toolbar('curve')
    const button = screen.getByTestId('edge-style')
    expect(button.getAttribute('data-edge-style')).toBe('curve')
    expect(button.textContent).toBe('Curve')

    fireEvent.click(button)
    expect(onEdgeStyle).toHaveBeenCalledWith('arrow')
  })

  it('renders the label for a non-default style', () => {
    toolbar('straight')
    expect(screen.getByTestId('edge-style').textContent).toBe('Straight')
  })
})
