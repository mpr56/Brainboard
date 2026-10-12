import { useEffect, useRef, useState } from 'react'
import { NODE_BORDER } from '../nodeBox'
import type { NodeTypeDef, NodeViewProps } from '../registry'
import { NEW_NODE_TEXT } from '../../document/create'
import { BODY_FONT_PX, readTextStyle, withTextStyle, type TextStyle } from './textStyle'

// The three numbers the laid-out height of a one-line node is made of. They
// are constants rather than literals inside the style block because
// `defaultSize` below is derived from them: a node is created at an estimated
// height and then corrected by measurement, and when the estimate is wrong the
// correction moves the node's height without moving its position — so it ends
// up off-centre from the point it was created at, and a child spawned off a
// handle sits off its parent's axis. Keeping the estimate and the style in
// terms of the same constants is what stops the two drifting apart.
const PAD_Y = 13
const PAD_X = 18
const FONT_PX = BODY_FONT_PX
const LINE_RATIO = 1.4
/** Every boxed text node is this wide; there is no resize yet. */
const BOX_W = 240
/**
 * A box-less node is as wide as its text, up to this, and wraps beyond it.
 * Its width is measured rather than fixed because a connector ends at the
 * node's edge: at a fixed 220 with no card to fill the gap, short text would
 * leave connectors stopping in mid-air well short of the words.
 */
const BOXLESS_MAX_W = 260
const BOXLESS_MIN_W = 40

/**
 * The numbers text is laid out with, for painters that cannot ask the browser
 * — export draws to a canvas and must wrap and place text exactly as the board
 * does.
 */
export const TEXT_LAYOUT = {
  padX: PAD_X,
  padY: PAD_Y,
  lineRatio: LINE_RATIO,
  boxW: BOX_W,
  boxlessMaxW: BOXLESS_MAX_W,
} as const

/**
 * ⌘B / ⌘I / ⌘U toggle the node's own style. Left to the browser, they would
 * wrap the selection in <b>/<i>/<u> — markup the commit then throws away,
 * because it reads `textContent`.
 */
const SHORTCUTS: Record<string, keyof Pick<TextStyle, 'bold' | 'italic' | 'underline'>> = {
  b: 'bold',
  i: 'italic',
  u: 'underline',
}

/**
 * The prompt an empty node shows. It is painted by CSS from an attribute, not
 * stored as text, so typing replaces it rather than appending to it — and the
 * editor's `textContent`, which is what gets committed, never contains it.
 */
const PLACEHOLDER_CSS = `
[data-testid="text-node-body"][data-empty="true"]::before {
  content: attr(data-placeholder);
  color: #a19c90;
  pointer-events: none;
}
`

/** What a node holding a single unwrapped line measures, border included — what onMeasure reports. */
const SINGLE_LINE_H = PAD_Y * 2 + Math.round(FONT_PX * LINE_RATIO) + NODE_BORDER * 2

function TextNodeView({ node, state, onEdit, onMeasure, onEndEdit }: NodeViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const text = (node.props.text as string) ?? ''
  const style = readTextStyle(node.props)

  // Render-phase "previous props" idiom (no useEffect, no DOM writes): seed a
  // local draft exactly when an edit session begins (editing flips false ->
  // true), then freeze it there. While editing, we render `draft`, which
  // never changes for the length of the session, so React has nothing to
  // reconcile against the DOM the browser is mutating directly underneath it
  // (Enter splits the text node and inserts <br>, contentEditable does its
  // own thing). Without this, a `text` prop change arriving mid-session
  // (a commit from elsewhere, or undo) would make React try to patch a live
  // DOM structure it no longer recognises — the standard cause of a
  // `removeChild` NotFoundError.
  const [prevEditing, setPrevEditing] = useState(state.editing)
  const [draft, setDraft] = useState(text)
  if (state.editing !== prevEditing) {
    setPrevEditing(state.editing)
    if (state.editing) setDraft(text)
  }
  const content = state.editing ? draft : text

  // Whether to show the placeholder. Tracked from input during an edit rather
  // than read off `content`, because the draft is frozen for the session (see
  // above) while the DOM under it is what the user is actually typing into.
  const [empty, setEmpty] = useState(content === '')
  const [prevContent, setPrevContent] = useState(content)
  if (content !== prevContent) {
    setPrevContent(content)
    setEmpty(content === '')
  }

  // Rule 1: the browser lays the text out, then we report the size so the
  // document — not the DOM — remains the source of truth.
  //
  // A boxed node is always BOX_W wide, and reporting that (rather than
  // nothing) is what puts a node back to full width after it is switched back
  // from box-less, including when that switch is an undo. A box-less node's
  // text box is `max-content`, so offsetWidth is the width of its longest line
  // — in layout units, untouched by the zoom transform — and it does not
  // depend on node.w, so writing it back cannot feed a loop.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.scrollHeight <= 0) return
    // The node's border sits outside this element but inside the node's box.
    const h = el.scrollHeight + NODE_BORDER * 2
    const w = style.boxless ? el.offsetWidth : BOX_W
    if (Math.abs(h - node.h) > 1 || Math.abs(w - node.w) > 1) onMeasure({ w, h })
    // The style is a dependency because a size or weight change re-wraps the
    // text without touching it.
  }, [text, node.w, node.h, onMeasure, style.fontSize, style.bold, style.italic, style.boxless])

  return (
    <>
      {/* Outside the editor: inside it, the rule would be part of textContent. */}
      <style>{PLACEHOLDER_CSS}</style>
      <div
        ref={ref}
        data-testid="text-node-body"
        data-part="body"
        data-empty={empty ? 'true' : undefined}
        data-placeholder={NEW_NODE_TEXT}
        contentEditable={state.editing}
        suppressContentEditableWarning
        onInput={(e) => {
          // A contentEditable emptied by backspacing can keep a stray <br>, so
          // "empty" is judged on the text, not on whether the element has children.
          setEmpty((e.currentTarget.textContent ?? '') === '')
        }}
        onKeyDown={(e) => {
          if (!state.editing || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
          const key = SHORTCUTS[e.key.toLowerCase()]
          if (!key) return
          e.preventDefault()
          onEdit({ props: withTextStyle(node.props, { [key]: !style[key] }) })
        }}
        onBlur={(e) => {
          // Commit first, unconditionally: focus can leave after `state.editing`
          // has already flipped false (a pointer-down elsewhere clears
          // `editingId` before the browser moves focus), and skipping the commit
          // in that window would silently discard everything the user typed.
          const next = e.currentTarget.textContent ?? ''
          if (next !== text) onEdit({ props: { ...node.props, text: next } })
          // Then report that the session is over. The listener upstream only
          // acts if THIS node is the one being edited, so a stray blur on an
          // idle node is a no-op.
          onEndEdit()
        }}
        style={{
          // Box-less text is centred on the node and grows both ways as you
          // type, so committing — which re-centres the node on its new width —
          // does not make it jump.
          ...(style.boxless
            ? {
                position: 'relative',
                left: '50%',
                translate: '-50% 0',
                width: 'max-content',
                minWidth: BOXLESS_MIN_W,
                maxWidth: BOXLESS_MAX_W,
                textAlign: 'center',
              }
            : { width: '100%' }),
          padding: `${PAD_Y}px ${PAD_X}px`,
          boxSizing: 'border-box',
          outline: 'none',
          font: `${style.italic ? 'italic ' : ''}${style.bold ? 700 : 400} ${style.fontSize}px/${LINE_RATIO} system-ui, sans-serif`,
          textDecoration: style.underline ? 'underline' : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          // The viewport turns text selection off for the whole board, and
          // `user-select` inherits — so an idle node needs no declaration here
          // at all. Only the node being edited opts back in, or the caret cannot
          // be placed and select-all inside the editor does nothing.
          //
          // Writing 'none' on the idle branch too would look tidier and be
          // worse: it would mask the viewport's rule, so losing that rule would
          // stop failing any test. Leaving it to inherit keeps one owner.
          userSelect: state.editing ? 'text' : undefined,
          WebkitUserSelect: state.editing ? 'text' : undefined,
        }}
      >
        {content}
      </div>
    </>
  )
}

export const TEXT_NODE_TYPE: NodeTypeDef = {
  type: 'text',
  domOnly: false,
  editable: true,
  // Height is the measured height of one line, not a roomier guess. An
  // over-estimate is not harmless: measurement corrects `h` but never `y`, so
  // the node settles higher than where it was asked to appear and a spawned
  // child misses its parent's axis by half the error.
  defaultSize: () => ({ w: BOX_W, h: SINGLE_LINE_H }),
  View: TextNodeView,
}
