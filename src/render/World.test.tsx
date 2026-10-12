import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { World } from './World'

const noop = vi.fn()

describe('World', () => {
  it('applies the camera transform with a 0 0 origin', () => {
    render(
      <World
        camera={{ x: 100, y: 50, zoom: 2 }}
        onViewport={noop}
        onWheel={noop}
        onPointerDown={noop}
        onPointerMove={noop}
        onPointerUp={noop}
        onDoubleClick={noop}
      >
        <div data-testid="child" />
      </World>,
    )
    const world = screen.getByTestId('world')
    expect(world.style.transform).toBe('scale(2) translate(-100px, -50px)')
    expect(world.style.transformOrigin).toBe('0 0')
  })

  it('reports its viewport size on mount', () => {
    const onViewport = vi.fn()
    render(
      <World
        camera={{ x: 0, y: 0, zoom: 1 }}
        onViewport={onViewport}
        onWheel={noop}
        onPointerDown={noop}
        onPointerMove={noop}
        onPointerUp={noop}
        onDoubleClick={noop}
      >
        <div />
      </World>,
    )
    expect(onViewport).toHaveBeenCalled()
  })

  // React's own wheel listeners are passive, so preventDefault in one is
  // ignored and ⌘/ctrl + wheel zoomed the browser page along with the board —
  // growing the colour wheel and every other screen-space control with it.
  describe('wheel', () => {
    const world = (onWheel: (e: WheelEvent) => void) =>
      render(
        <World
          camera={{ x: 0, y: 0, zoom: 1 }}
          onViewport={noop}
          onWheel={onWheel}
          onPointerDown={noop}
          onPointerMove={noop}
          onPointerUp={noop}
          onDoubleClick={noop}
        >
          <div />
        </World>,
      )
    const wheelOn = (target: EventTarget, init: WheelEventInit = {}) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 50, ...init })
      target.dispatchEvent(e)
      return e
    }

    it('hands wheel events to the board with the power to cancel them', () => {
      const onWheel = vi.fn((e: WheelEvent) => e.preventDefault())
      world(onWheel)
      const e = wheelOn(screen.getByTestId('viewport'), { ctrlKey: true })
      expect(onWheel).toHaveBeenCalledTimes(1)
      expect(e.defaultPrevented).toBe(true)
    })

    it('always calls the latest handler, not the one it mounted with', () => {
      const first = vi.fn()
      const second = vi.fn()
      const view = world(first)
      view.rerender(
        <World
          camera={{ x: 0, y: 0, zoom: 1 }}
          onViewport={noop}
          onWheel={second}
          onPointerDown={noop}
          onPointerMove={noop}
          onPointerUp={noop}
          onDoubleClick={noop}
        >
          <div />
        </World>,
      )
      wheelOn(screen.getByTestId('viewport'))
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)
    })

    it('stops ⌘/ctrl + wheel zooming the page over controls outside the board', () => {
      world(noop)
      expect(wheelOn(document.body, { ctrlKey: true }).defaultPrevented).toBe(true)
      expect(wheelOn(document.body, { metaKey: true }).defaultPrevented).toBe(true)
    })

    it('leaves plain scrolling outside the board alone', () => {
      world(noop)
      expect(wheelOn(document.body).defaultPrevented).toBe(false)
    })
  })
})
