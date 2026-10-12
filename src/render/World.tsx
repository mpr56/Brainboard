import { useEffect, useRef, useState, type ReactNode } from 'react'
import { worldTransform, type Camera } from '../camera'

type Props = {
  camera: Camera
  children: ReactNode
  onViewport: (size: { w: number; h: number }) => void
  /**
   * Attached natively, not as a React prop: React registers wheel listeners as
   * passive, so `preventDefault` inside one is ignored and ⌘/ctrl + wheel or a
   * pinch zoomed the browser page as well as the board.
   */
  onWheel: (e: WheelEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onDoubleClick: (e: React.MouseEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}

export function World({ camera, children, onViewport, onWheel, ...handlers }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  // The handler is re-created whenever the camera changes (it zooms from the
  // current camera), so the listener reads it through a ref rather than
  // closing over one copy and zooming from a stale camera forever after.
  const wheelRef = useRef(onWheel)
  wheelRef.current = onWheel
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => wheelRef.current(e)
    // Safari pinches with its own gesture events, not ctrl + wheel; cancelling
    // them is what stops it zooming the page instead.
    const gesture = (e: Event) => e.preventDefault()
    // The same zoom over a control floating above the board — the colour
    // wheel, the toolbar — is not the board's, but it must not zoom the page
    // either, or those controls change size. Keyboard page zoom still works.
    const pageZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('gesturestart', gesture)
    el.addEventListener('gesturechange', gesture)
    window.addEventListener('wheel', pageZoom, { passive: false })
    window.addEventListener('gesturestart', gesture)
    window.addEventListener('gesturechange', gesture)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('gesturestart', gesture)
      el.removeEventListener('gesturechange', gesture)
      window.removeEventListener('wheel', pageZoom)
      window.removeEventListener('gesturestart', gesture)
      window.removeEventListener('gesturechange', gesture)
    }
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const report = () => onViewport({ w: el.clientWidth, h: el.clientHeight })
    report()
    setReady(true)
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onViewport])

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        // The board is a gesture surface, not a document. Without this, any
        // drag across it — moving a node, pulling a connector out of a handle,
        // marquee-selecting — also runs the browser's native drag-select and
        // highlights the text of every node the pointer sweeps over.
        //
        // `user-select` inherits, so this one declaration covers the whole
        // board and every node type on it. The text editor is the single place
        // that opts back in, for the one node being edited.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        background: '#eae7df',
        backgroundImage: 'radial-gradient(#d8d4ca 1.3px, transparent 1.3px)',
        backgroundSize: `${22 * camera.zoom}px ${22 * camera.zoom}px`,
        backgroundPosition: `${-camera.x * camera.zoom}px ${-camera.y * camera.zoom}px`,
      }}
      {...handlers}
    >
      <div
        data-testid="world"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: worldTransform(camera),
          willChange: 'transform',
        }}
      >
        {ready ? children : null}
      </div>
    </div>
  )
}
