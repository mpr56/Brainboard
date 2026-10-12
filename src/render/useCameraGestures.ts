import { useCallback, useRef } from 'react'
import { panBy, zoomAt, type Camera } from '../camera'

const ZOOM_SENSITIVITY = 0.0015

/**
 * What the wheel handler reads off an event. Native rather than React's
 * synthetic event: World attaches the listener itself, because React's wheel
 * listeners are passive and could never cancel the browser's own zoom.
 */
export type WheelInput = Pick<
  WheelEvent,
  'preventDefault' | 'clientX' | 'clientY' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey'
> & { currentTarget: EventTarget | null }

/**
 * Wheel zooms about the cursor; ctrl/meta-less trackpad two-finger scroll pans.
 * Camera state is owned by the caller and never enters the Yjs document.
 */
export function useCameraGestures(camera: Camera, onCamera: (c: Camera) => void) {
  const panning = useRef<{ lastX: number; lastY: number } | null>(null)

  const onWheel = useCallback(
    (e: WheelInput) => {
      // Load-bearing: ⌘/ctrl + wheel, and a trackpad pinch (which browsers
      // deliver as ctrl + wheel), otherwise also zoom the whole page — so the
      // toolbar, the colour wheel and every other screen-space control grew
      // and shrank along with the board.
      e.preventDefault()
      const rect = (e.currentTarget as Element).getBoundingClientRect()
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      if (e.ctrlKey || e.metaKey) {
        onCamera(zoomAt(camera, screenPoint, Math.exp(-e.deltaY * ZOOM_SENSITIVITY)))
      } else {
        onCamera(panBy(camera, { x: -e.deltaX, y: -e.deltaY }))
      }
    },
    [camera, onCamera],
  )

  const beginPan = useCallback((clientX: number, clientY: number) => {
    panning.current = { lastX: clientX, lastY: clientY }
  }, [])

  const movePan = useCallback(
    (clientX: number, clientY: number) => {
      const p = panning.current
      if (!p) return false
      onCamera(panBy(camera, { x: clientX - p.lastX, y: clientY - p.lastY }))
      panning.current = { lastX: clientX, lastY: clientY }
      return true
    },
    [camera, onCamera],
  )

  const endPan = useCallback(() => {
    panning.current = null
  }, [])

  return { onWheel, beginPan, movePan, endPan, isPanning: () => panning.current !== null }
}
