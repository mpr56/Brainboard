import type * as Y from 'yjs'
import type { EdgeStyleKind } from '../types'
import { metaMap, transact, type Origin } from './schema'

const EDGE_STYLE_KEY = 'edgeStyle'
const EDGE_STYLES: readonly EdgeStyleKind[] = ['curve', 'arrow', 'elbow', 'straight']

/**
 * How every connector on the board is routed.
 *
 * One value for the whole board, kept in the document so it survives a reload
 * along with the board it styles. Each edge still stores a `style.kind` of its
 * own, but painting reads this instead — switching style restyles the board
 * rather than only the connectors drawn after the switch.
 */
export function readEdgeStyle(doc: Y.Doc): EdgeStyleKind {
  const v = metaMap(doc).get(EDGE_STYLE_KEY)
  return EDGE_STYLES.includes(v as EdgeStyleKind) ? (v as EdgeStyleKind) : 'curve'
}

/**
 * Written to `meta`, which the undo manager does not track: this is a view
 * choice, and ⌘Z should step back through edits to the board's content.
 */
export function setEdgeStyle(doc: Y.Doc, kind: EdgeStyleKind, origin: Origin = 'user'): void {
  transact(doc, origin, () => metaMap(doc).set(EDGE_STYLE_KEY, kind))
}
