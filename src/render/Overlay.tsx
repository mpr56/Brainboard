import { worldToScreen, type Camera } from '../camera'
import { connectorPath } from '../geometry/ribbon'
import type { EdgeStyleKind, Point, Rect } from '../types'

/**
 * The in-flight connector, already routed in world space by `geometry/`
 * (rule 4). The Overlay only maps the points into screen space and paints
 * them; it computes no geometry of its own.
 */
export type PendingPath = { points: Point[]; kind: EdgeStyleKind; color: string }

type Props = {
  camera: Camera
  marquee: Rect | null
  pending: PendingPath | null
}

/**
 * Screen space on purpose: handles, marquee and the in-flight connector keep a
 * constant visual weight at any zoom rather than scaling with the world.
 */
export function Overlay({ camera, marquee, pending }: Props) {
  const box = marquee
    ? {
        tl: worldToScreen({ x: marquee.x, y: marquee.y }, camera),
        br: worldToScreen({ x: marquee.x + marquee.w, y: marquee.y + marquee.h }, camera),
      }
    : null

  // The preview is the connector you are about to make, not a generic line:
  // same shape, same routing, same branch colour. Its whole job is to answer
  // "which way will this point and what will it look like" before you let go,
  // so a dashed hairline that resembled nothing was answering neither.
  //
  // Widths are scaled by zoom because this layer works in screen space while
  // the committed edge is drawn inside the world transform. Leaving them
  // unscaled would make the preview and the edge it becomes disagree at every
  // zoom but 100%.
  const pendingD = pending
    ? connectorPath(
        pending.points.map((p) => worldToScreen(p, camera)),
        pending.kind,
        camera.zoom,
      )
    : null

  return (
    <svg
      data-testid="overlay"
      // The explicit size is not redundant with `inset: 0`. An <svg> is a
      // replaced element, so insets do not stretch it: left to itself it is
      // 300×150, and everything drawn outside that corner was clipped away.
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {box && (
        <rect
          data-testid="marquee"
          x={box.tl.x}
          y={box.tl.y}
          width={box.br.x - box.tl.x}
          height={box.br.y - box.tl.y}
          fill="rgba(45,99,214,.08)"
          stroke="#2d63d6"
          strokeWidth={1}
        />
      )}
      {pendingD && (
        <path
          data-testid="pending-edge"
          data-edge-style={pending!.kind}
          d={pendingD}
          fill={pending!.color}
          stroke="none"
          // Translucent so it still reads as not-yet-committed, and so the node
          // it is currently over stays legible underneath it.
          opacity={0.55}
        />
      )}
    </svg>
  )
}
