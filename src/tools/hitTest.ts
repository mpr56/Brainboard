import type { Dir } from '../types'
import type { Hit, Part } from './types'

const PARTS: Part[] = ['body', 'edge', 'handle', 'scrubber', 'resize']
const DIRS: Dir[] = ['n', 'e', 's', 'w']

const isPart = (v: string | null): v is Part => v !== null && PARTS.includes(v as Part)

// Anything outside the four sides is not a direction. Waving an unrecognised
// string through would land in spawnCentre's exhaustive switch, which has no
// default arm and would hand back undefined as a Point.
const isDir = (v: string | null): v is Dir => v !== null && DIRS.includes(v as Dir)

/**
 * The swappable seam of rule 3. Today it reads the DOM; a future canvas
 * renderer replaces this one function with a quadtree query and every tool
 * keeps working unchanged.
 */
export function hitTestDom(target: EventTarget | null): Hit | null {
  let el = target instanceof Element ? target : null
  let part: Part | null = null
  let dir: Dir | undefined

  while (el) {
    // An element can be hoverable without being hittable. The halo that widens
    // a node's hover area is the case this exists for: the browser must see it
    // to set :hover on the node, but a press inside it is a press on empty
    // canvas — it must start a marquee, not select the node it surrounds.
    // Checked before anything else so the walk stops rather than continuing up
    // to the node and reporting a hit anyway.
    if (el.getAttribute('data-hit') === 'none') return null
    if (part === null) {
      const attr = el.getAttribute('data-part')
      if (isPart(attr)) {
        part = attr
        // Read together with the part, never separately: the direction
        // describes the thing that was hit. Walking on and picking up a
        // data-dir from some ancestor would attribute another element's side
        // to this hit.
        const d = el.getAttribute('data-dir')
        if (isDir(d)) dir = d
      }
    }
    const nodeId = el.getAttribute('data-node-id')
    // `dir` is omitted rather than set to undefined so a hit without one
    // compares equal to a plain `{nodeId, part}`.
    if (nodeId) return dir ? { nodeId, part: part ?? 'body', dir } : { nodeId, part: part ?? 'body' }
    el = el.parentElement
  }
  return null
}
