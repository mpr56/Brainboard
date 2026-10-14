import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  boundsOf,
  fitCamera,
  screenToWorld,
  worldRectToScreen,
  worldToScreen,
  zoomAt,
  type Camera,
} from './camera'
import { createNodeAt } from './document/create'
import { removeEdge, setEdgeColor } from './document/edges'
import { getNode, removeNode, updateNode } from './document/nodes'
import {
  branchColor,
  edgeOwnColor,
  nodeColor,
  resolveEdgeColors,
  resolveNodeColors,
} from './document/palette'
import { metaMap, transact } from './document/schema'
import { exportBoard } from './export/exportBoard'
import type { Scene } from './export/draw'
import { previewCounts, renderThumbnail } from './export/thumbnail'
import { DEFAULT_EXPORT, exportContent, type ExportOptions } from './export/layout'
import { pickEdge, routeFor, routeMidpoint, type EdgeRoute } from './geometry/edgeRoute'
import { MEDIA_ACCEPT, ingestFiles } from './media/ingest'
import { useEdgeStyle, useEdges, useNodes } from './document/hooks'
import { setEdgeStyle } from './document/settings'
import { useBoard } from './useBoard'
import type { Backend, BoardPreview } from './account/types'
import { ConnectorLayer } from './render/ConnectorLayer'
import { nodePort } from './geometry/anchors'
import { routeEdge } from './geometry/routeEdge'
import { NodeLayer } from './render/NodeLayer'
import { Overlay, type PendingPath } from './render/Overlay'
import { World } from './render/World'
import { getNodeType } from './render/registry'
import {
  applyPreset,
  readTextStyle,
  stepFontSize,
  withTextStyle,
} from './render/nodes/textStyle'
import { visibleNodes } from './render/visibleNodes'
import { useCameraGestures } from './render/useCameraGestures'
import { connectTool, pendingEdge, resetConnectTool } from './tools/connect'
import { hitTestDom } from './tools/hitTest'
import { createResizeTool, resetResizeTool, resizePreview } from './tools/resize'
import { dragPreview, resetSelectTool, selectTool } from './tools/select'
import type { Tool, WorldEvent } from './tools/types'
import { ColorWheel } from './ui/ColorWheel'
import { CreatePicker, type CreateKind } from './ui/CreatePicker'
import { EdgeMenu } from './ui/EdgeMenu'
import { ExportDialog } from './ui/ExportDialog'
import { FormatBar } from './ui/FormatBar'
import { Toolbar } from './ui/Toolbar'
import type { Anchor, EdgeId, Node, NodeId, Point, Rect } from './types'

/** How close to a link, in screen pixels, a click still picks it. */
const EDGE_PICK_PX = 8
/** How long the Fit button's camera move takes. */
const FIT_MS = 260
/** How long edits must settle before the home-screen picture is redrawn. */
const PREVIEW_IDLE_MS = 1500

/** A gesture that does nothing — what a press that picked a link hands its move/up to. */
const idleTool: Tool = { name: 'idle' }

type Props = {
  boardId: string
  /** Names the exported file. Falls back to the title stored in the document. */
  boardTitle?: string
  persist?: Backend['persistBoard']
  /** Saves the home screen's picture of the board. Called once edits settle, and on the way out. */
  onPreview?: (preview: Omit<BoardPreview, 'savedAt'>) => Promise<void>
  /** Files to add as soon as the board has loaded — a board started from a drop on the home screen. */
  initialFiles?: File[]
}

/**
 * One open board. Mounted per board (keyed by id in Root), so camera,
 * selection and undo history all start fresh when the user switches boards.
 */
export function App({ boardId, boardTitle, persist, onPreview, initialFiles }: Props) {
  const { doc, store, undo, ready, error, status } = useBoard(boardId, persist)
  const nodes = useNodes(store)
  const edges = useEdges(store)
  // A board-wide setting, not per-edge: the toolbar switch restyles every
  // connector at once (see document/settings.ts).
  const edgeStyleKind = useEdgeStyle(store)

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [selection, setSelection] = useState<Set<NodeId>>(new Set())
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [editingId, setEditingId] = useState<NodeId | null>(null)
  // A clicked link. Exclusive with node selection: picking one clears the other.
  const [selectedEdge, setSelectedEdge] = useState<EdgeId | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  // Remembered between openings, so a second export starts where the first left off.
  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT)
  // A short message at the bottom of the screen, for things that went wrong
  // out of sight (a file that could not be added).
  const [notice, setNotice] = useState<string | null>(null)
  // The Text / Media picker a double-click on empty canvas opens: where it
  // opened on screen, and the board point whatever is picked will go.
  const [picker, setPicker] = useState<{ client: Point; world: Point } | null>(null)
  const mediaInput = useRef<HTMLInputElement>(null)
  // Where files chosen from the file picker go. Set when Media is picked,
  // read when the chooser hands the files back.
  const mediaAt = useRef<Point | null>(null)
  const [, forceRender] = useState(0)

  // The latest camera, for the Fit animation, which runs across many renders.
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const fitFrame = useRef<number | null>(null)

  const gestures = useCameraGestures(camera, setCamera)
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes])

  /**
   * The link under a world point, if any. Routed against the committed
   * document — a link is only ever picked with nothing in flight.
   */
  const edgeAt = useCallback(
    (p: Point): EdgeId | null => {
      const routes = edges
        .map((e) => routeFor(e, nodesById, edgeStyleKind))
        .filter((r): r is EdgeRoute => r !== null)
      return pickEdge(routes, p, EDGE_PICK_PX / camera.zoom)
    },
    [edges, nodesById, edgeStyleKind, camera.zoom],
  )
  // True between a pointer-down and its matching up/cancel. onPointerMove is a
  // viewport prop, so it also fires on bare hover with nothing in flight; this
  // is what lets those events be dropped before they cost anything.
  const gestureActive = useRef(false)

  /**
   * Which tool handles a gesture is decided by what the pointer went down on,
   * not by a mode the user has to remember they are in.
   *
   * Pressing a spawn handle means "draw a link from here"; pressing a media
   * scrubber means the same thing anchored to a moment. Everything else —
   * node bodies, empty canvas — is selection and movement. That is what lets
   * the toolbar have no tool buttons at all: there is no state to get stuck in.
   */
  const resizeTool = useMemo(
    () =>
      createResizeTool((id) => {
        const n = getNode(doc, id)
        return n ? getNodeType(n.type).keepAspect === true : false
      }),
    [doc],
  )
  const toolFor = (hit: WorldEvent['hit']): Tool =>
    hit?.part === 'resize'
      ? resizeTool
      : hit && (hit.part === 'handle' || hit.part === 'scrubber')
        ? connectTool
        : selectTool

  /**
   * The tool chosen at pointer-down, held for the rest of that gesture.
   *
   * onMove and onUp must reach the same tool that saw onDown, whatever is
   * under the cursor by then — a connect drag passes over other nodes and ends
   * on empty canvas, and re-deciding per event would hand its onUp to
   * selectTool, which knows nothing about the pending edge.
   */
  const activeTool = useRef<Tool>(selectTool)

  // Read once: every text node is created at the type's default size, and the
  // registry entry does not change for the life of the app.
  const newNodeSize = useMemo(() => getNodeType('text').defaultSize(), [])

  /**
   * The one place a node comes into being, whatever asked for it — the toolbar
   * button, the double-click picker, or a spawn handle. Keeping the
   * policy here rather than in each caller is what makes "a new node is
   * selected and ready to type into" true of all three without being written
   * three times.
   */
  const createNode = useCallback(
    (at: Point, from?: Anchor): NodeId => {
      const id = createNodeAt(doc, at, { size: newNodeSize, from, edgeStyleKind }, 'user')
      setSelection(new Set([id]))
      setEditingId(id)
      return id
    },
    [doc, edgeStyleKind, newNodeSize],
  )

  /**
   * The one delete path, shared by the keyboard and each node's × button.
   *
   * Clearing `editingId` is not housekeeping: if the node being edited is
   * removed while the flag still points at it, every later keystroke is
   * treated as typing and Delete stays dead for the rest of the session. The ×
   * makes that reachable in one click, since a freshly created node is always
   * the one being edited.
   *
   * removeNode already cascades to the connectors touching the node; one
   * transaction around the whole set makes a multi-node delete one undo step.
   */
  const deleteNodes = useCallback(
    (target: NodeId | NodeId[]) => {
      const ids = Array.isArray(target) ? target : [target]
      if (ids.length === 0) return
      transact(doc, 'user', () => {
        for (const id of ids) removeNode(doc, id, 'user')
      })
      setSelection((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
      setEditingId((current) => (current !== null && ids.includes(current) ? null : current))
    },
    [doc],
  )

  const ctx = useMemo(
    () => ({
      doc,
      nodes,
      selection,
      setSelection,
      marquee,
      setMarquee,
      edgeStyleKind,
      newNodeSize,
      createNode,
    }),
    [doc, nodes, selection, marquee, edgeStyleKind, newNodeSize, createNode],
  )

  // Ruling 2: World's mount effect keys its ResizeObserver lifecycle off
  // `[onViewport]`. An inline arrow function would be a new identity every
  // render, tearing down and re-observing on every state change.
  const onViewport = useCallback((size: { w: number; h: number }) => setViewport(size), [])

  const toWorldEvent = useCallback(
    (e: React.PointerEvent, type: WorldEvent['type']): WorldEvent => {
      const rect = e.currentTarget.getBoundingClientRect()
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      // Not `e.target`: onPointerDown below calls setPointerCapture on the
      // viewport, and per the Pointer Events spec that redirects `target` on
      // every subsequent pointermove/pointerup for this pointer to the
      // capturing element itself, regardless of what is visually under the
      // cursor. hitTestDom(e.target) would then always see the viewport div
      // and report no hit, silently breaking anything that needs to know
      // which node the pointer is over on move/up (connectTool's onUp, in
      // particular — it never created an edge). elementFromPoint reads the
      // real DOM at the cursor's current position, immune to capture
      // redirection, while still respecting pointer-events/z-index the same
      // way native target resolution would.
      const real = document.elementFromPoint(e.clientX, e.clientY)
      return {
        type,
        screenPoint,
        worldPoint: screenToWorld(screenPoint, camera),
        hit: hitTestDom(real),
        modifiers: { shift: e.shiftKey, meta: e.metaKey, alt: e.altKey, space: false },
      }
    },
    [camera],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1) {
        // Capture before returning. Without it the pointer-up is delivered to
        // whatever is under the cursor at release — the Toolbar is a sibling
        // of the viewport, so its events never bubble here — and `endPan`,
        // which only the viewport's onPointerUp calls, never runs. The pan
        // then survives the gesture and the next bare mouse move drags the
        // board with no button held.
        e.currentTarget.setPointerCapture(e.pointerId)
        gestures.beginPan(e.clientX, e.clientY)
        return
      }
      gestureActive.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      const we = toWorldEvent(e, 'down')
      // A pointer-down that lands anywhere but the node being edited ends the
      // session. Blur alone is not enough: focus can already have been lost
      // (or never taken) while `editingId` is still set, and until it clears
      // the keyboard stays in "typing" mode and Delete/v/c are dead.
      // Landing on the edited node itself is caret placement, not an exit.
      if (editingId !== null && we.hit?.nodeId !== editingId) {
        // Order matters. Dropping `editingId` first flips the node's
        // contentEditable off, and the blur the browser then delivers is not
        // reliably routed back to the view — so the text the user just typed
        // is never committed. Moving focus out explicitly fires focusout
        // synchronously, which runs the view's own commit-and-report handler
        // (that handler is what nulls editingId in the normal path); the
        // setState below is the fallback for when focus was never in an
        // editor to begin with.
        const active = document.activeElement
        if (active instanceof HTMLElement && active.isContentEditable) active.blur()
        setEditingId(null)
      }
      // A press on empty canvas that lands on a link picks the link, rather
      // than starting a marquee. Links are found geometrically (see pickEdge).
      const picked = we.hit ? null : edgeAt(we.worldPoint)
      setSelectedEdge(picked)
      if (picked) {
        setSelection(new Set())
        activeTool.current = idleTool
        forceRender((n) => n + 1)
        return
      }
      const chosen = toolFor(we.hit)
      activeTool.current = chosen
      chosen.onDown?.(we, ctx)
      forceRender((n) => n + 1)
    },
    [ctx, editingId, gestures, toWorldEvent, edgeAt],
  )

  /**
   * Every double-click on the board is interpreted here: on a node it opens an
   * edit session, on empty canvas it opens the Text / Media picker.
   *
   * It has to live at the viewport and route by hit test, because a handler on
   * the node itself would never run. `onPointerDown` calls setPointerCapture
   * on the viewport, and per the Pointer Events spec that retargets the
   * compatibility mouse events too — `click` and `dblclick` are dispatched at
   * the capturing element, not at whatever is under the cursor. A `dblclick`
   * bound to a node div is therefore dead code, which is how this went
   * unnoticed: the tests that double-clicked a node were always double-clicking
   * one that "+ Text" had already put into edit mode, so an inert handler and a
   * working one looked identical.
   *
   * elementFromPoint reads the real DOM at the cursor and is immune to the same
   * retargeting, which is why the hit test here is trustworthy when e.target is
   * not.
   */
  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestDom(document.elementFromPoint(e.clientX, e.clientY))
      if (hit) {
        // Two clicks on a spawn handle are two child nodes. Opening the parent
        // for editing behind them is not what was asked for.
        if (hit.part === 'handle' || hit.part === 'resize') return
        setSelection(new Set([hit.nodeId]))
        // Only some nodes have anything to open: text to type into, a PDF to
        // read. A picture or a player stays selected.
        const node = nodesById.get(hit.nodeId)
        if (node && getNodeType(node.type).editable) setEditingId(hit.nodeId)
        return
      }
      const rect = e.currentTarget.getBoundingClientRect()
      const at = screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, camera)
      // A double-click on a link is two clicks on the link, not a new node.
      if (edgeAt(at)) return
      // Empty canvas asks what to put there: swipe left for text, right for media.
      setPicker({ client: { x: e.clientX, y: e.clientY }, world: at })
    },
    [camera, edgeAt, nodesById],
  )

  const onPick = useCallback(
    (kind: CreateKind) => {
      const at = picker?.world
      setPicker(null)
      if (!at) return
      if (kind === 'text') {
        createNode(at)
        return
      }
      mediaAt.current = at
      mediaInput.current?.click()
    },
    [createNode, picker],
  )

  // Ruling 1: `gestures.movePan` is a per-render prop (deps `[camera, onCamera]`
  // on its own useCallback), read fresh here on every render via the `gestures`
  // dependency. It must stay wired through JSX props like this — capturing it
  // once in a mount-only `addEventListener` effect would freeze `camera` in
  // its closure and produce pan drift/jumping.
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (gestures.movePan(e.clientX, e.clientY)) return
      // Bare hover, or any move outside a gesture, gets no further than here.
      // Everything below is expensive: toWorldEvent does a
      // getBoundingClientRect plus an elementFromPoint (two forced
      // layout/hit-test reads) and a hitTestDom ancestor walk, and the
      // forceRender re-reconciles ConnectorLayer and every mounted node. None
      // of it can change anything when no tool gesture is in flight.
      //
      // The buttons check is the self-healing half: if an `up` were ever
      // missed, the first buttonless move clears the flag rather than leaving
      // every subsequent hover doing the full work forever.
      if (e.buttons === 0) gestureActive.current = false
      if (!gestureActive.current) return
      activeTool.current.onMove?.(toWorldEvent(e, 'move'), ctx)
      forceRender((n) => n + 1)
    },
    [ctx, gestures, toWorldEvent],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      gestureActive.current = false
      gestures.endPan()
      activeTool.current.onUp?.(toWorldEvent(e, 'up'), ctx)
      forceRender((n) => n + 1)
    },
    [ctx, gestures, toWorldEvent],
  )

  // Ruling 4: a pointercancel (touch interruption, browser gesture takeover)
  // never reaches onUp, so a dangling drag/marquee/connect gesture would
  // survive in module-level tool state until the next pointer-down. World's
  // Props type has no onPointerCancel slot, so this listens on the DOM
  // directly — on `window`, mirroring the keydown effect below, rather than
  // on a ref to this component's own root. That root only exists in the
  // `ready` tree (the early `if (!ready) return …` below has no ref-bearing
  // element), `ready` starts false, and this effect runs once at the first
  // commit, so such a ref would still be null and the listener would never
  // attach at all, for the component's whole life. `window` always exists.
  // `endPan` is pulled out of `gestures` because it alone is referentially
  // stable (its own useCallback has empty deps and it writes only to a ref),
  // so it can be an honest dependency here without re-attaching the listener
  // on every render the way the whole `gestures` object would.
  const { endPan } = gestures
  useEffect(() => {
    const onCancel = () => {
      gestureActive.current = false
      resetSelectTool()
      resetConnectTool()
      resetResizeTool()
      // A pan is the third gesture kind, and it lives in a different place
      // (the camera hook, not module-level tool state). A cancelled pan that
      // is not ended here sticks exactly like an uncaptured one.
      endPan()
      // Module-level tool state is now clear, but the marquee box is React
      // state that only the (never-fired) onUp would have cleared, and the
      // pending-connector line is recomputed from pendingEdge() below on
      // every render — forceRender alone picks that up once
      // resetConnectTool() has nulled it out.
      setMarquee(null)
      forceRender((n) => n + 1)
    }
    window.addEventListener('pointercancel', onCancel)
    return () => window.removeEventListener('pointercancel', onCancel)
  }, [endPan])

  const onAddText = useCallback(() => {
    createNode(screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera))
  }, [camera, createNode, viewport])

  /**
   * Frames everything on the board, centred exactly in the viewport, as large
   * as it will go. Eased rather than cut so you can see where you were.
   */
  const onFit = useCallback(() => {
    const target = fitCamera(boundsOf(nodes), viewport)
    if (fitFrame.current !== null) cancelAnimationFrame(fitFrame.current)
    const from = cameraRef.current
    const { w, h } = viewport
    // The centre is eased in world space and the zoom geometrically, so the
    // move reads as one smooth glide rather than a swoop off to the side.
    const centre = (c: Camera) => ({ x: c.x + w / 2 / c.zoom, y: c.y + h / 2 / c.zoom })
    const c0 = centre(from)
    const c1 = centre(target)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / FIT_MS)
      if (t >= 1) {
        fitFrame.current = null
        setCamera(target)
        return
      }
      const e = 1 - (1 - t) ** 3
      const zoom = from.zoom * (target.zoom / from.zoom) ** e
      const cx = c0.x + (c1.x - c0.x) * e
      const cy = c0.y + (c1.y - c0.y) * e
      setCamera({ zoom, x: cx - w / 2 / zoom, y: cy - h / 2 / zoom })
      fitFrame.current = requestAnimationFrame(step)
    }
    fitFrame.current = requestAnimationFrame(step)
  }, [nodes, viewport])

  useEffect(
    () => () => {
      if (fitFrame.current !== null) cancelAnimationFrame(fitFrame.current)
    },
    [],
  )

  /** Adds files as media nodes centred on `at`, selecting what was added. */
  const addMedia = useCallback(
    async (files: File[], at: Point) => {
      try {
        const ids = await ingestFiles(doc, files, at)
        if (ids.length > 0) setSelection(new Set(ids))
        if (ids.length < files.length) {
          setNotice(
            ids.length === 0
              ? 'That file type can’t be added. Images, GIFs, video, audio and PDFs can.'
              : 'Some files were skipped — only images, GIFs, video, audio and PDFs can be added.',
          )
        }
      } catch (err) {
        setNotice(`Couldn’t add that file: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [doc],
  )

  const viewportCentre = useCallback(
    () => screenToWorld({ x: viewport.w / 2, y: viewport.h / 2 }, camera),
    [camera, viewport],
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    // Without this the browser opens a dropped file in place of the app.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const files = [...e.dataTransfer.files]
      if (files.length === 0) return
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      void addMedia(files, screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, camera))
    },
    [addMedia, camera],
  )

  // Pasting a file (a screenshot, say) drops it in the middle of the view.
  // Not while typing, where a paste is the editor's.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (editingId !== null) return
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length === 0) return
      e.preventDefault()
      void addMedia(files, viewportCentre())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addMedia, editingId, viewportCentre])

  // A board started from files dropped on the home screen: add them once it
  // has loaded. The open-time fit below waits for them.
  const initialTaken = useRef(false)
  const [awaitingFiles, setAwaitingFiles] = useState(() => (initialFiles?.length ?? 0) > 0)
  useEffect(() => {
    if (!ready || initialTaken.current || !initialFiles?.length) return
    initialTaken.current = true
    void addMedia(initialFiles, { x: 0, y: 0 }).finally(() => setAwaitingFiles(false))
  }, [ready, initialFiles, addMedia])

  // Every board opens framed to fit. The camera is per-viewer and never
  // stored, so without this a board opens wherever the origin happens to be —
  // which can be nowhere near its content. A cut, not Fit's eased glide: there
  // is no "where you were" to show on open. Waits for the viewport to be
  // measured, and for any dropped files to land.
  const [fitOnOpen, setFitOnOpen] = useState(true)
  useEffect(() => {
    if (!fitOnOpen || !ready || viewport.w === 0 || awaitingFiles) return
    setFitOnOpen(false)
    if (nodes.length > 0) setCamera(fitCamera(boundsOf(nodes), viewport))
  }, [fitOnOpen, ready, viewport, awaitingFiles, nodes])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])

  const shown = useMemo(() => visibleNodes(nodes, camera, viewport), [nodes, camera, viewport])

  // Read fresh on every render, like `pendingEdge()` below: both are ephemeral
  // tool state that the forceRender after each pointer event republishes.
  const drag = dragPreview()

  // Connectors are drawn against where the nodes *appear*, not where the
  // document has them. During a drag those differ by the in-flight offset, and
  // drawing against the document left every connector behind until release.
  const resizing = resizePreview()
  const offset = drag ? offsetNodes(nodesById, drag) : nodesById
  const paintedById = resizing ? resizedNodes(offset, resizing) : offset

  // Resolved from structure on every document change, not read off each edge:
  // a node's colour flows down its branch, and old boards stored every
  // connector as black (see palette.ts).
  const edgeColors = useMemo(() => resolveEdgeColors(nodes, edges), [nodes, edges])
  // Each node wears the colour of the branch it is on (see resolveNodeColors).
  const nodeColors = useMemo(
    () => resolveNodeColors(nodes, edges, edgeColors),
    [nodes, edges, edgeColors],
  )

  // The home screen's picture of this board. Redrawn once edits have settled
  // for a moment, and again on the way out so leaving straight after an edit
  // still shows it. Read through refs: the leave-time save runs from an
  // unmount, long after the render that scheduled it.
  const scene = useRef<Omit<Scene, 'images'> | null>(null)
  scene.current = ready ? { nodes, edges, edgeColors, nodeColors, kind: edgeStyleKind } : null
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview
  // What the last saved picture showed, so leaving an untouched board redraws nothing.
  const savedFor = useRef<{ nodes: Node[]; edges: unknown; kind: unknown } | null>(null)
  const savePreview = useCallback(async () => {
    const s = scene.current
    const save = onPreviewRef.current
    if (!s || !save) return
    const last = savedFor.current
    if (last && last.nodes === s.nodes && last.edges === s.edges && last.kind === s.kind) return
    savedFor.current = { nodes: s.nodes, edges: s.edges, kind: s.kind }
    try {
      await save({ image: await renderThumbnail(s), ...previewCounts(s.nodes) })
    } catch (err) {
      console.warn('[preview]', err)
    }
  }, [])
  useEffect(() => {
    if (!ready) return
    const id = setTimeout(() => void savePreview(), PREVIEW_IDLE_MS)
    return () => clearTimeout(id)
  }, [ready, nodes, edges, edgeStyleKind, savePreview])
  useEffect(() => () => void savePreview(), [savePreview])

  const setProps = useCallback(
    (id: NodeId, props: Record<string, unknown>) => updateNode(doc, id, { props }, 'user'),
    [doc],
  )

  // Rule 4: the preview is routed by `geometry/`, with the same anchor
  // resolution and the same routing style the committed edge will get. It used
  // to be a straight line drawn from a locally-duplicated node centre, so the
  // in-flight connector and the edge it produced disagreed in shape — and
  // would have disagreed in position too once Plan 2 lands scrubber anchors.
  const pending = pendingEdge()
  const pendingFrom = pending ? nodesById.get(pending.fromNodeId) : undefined
  // Snapped to a side midpoint for the same reason committed edges are, with
  // the cursor treated as a zero-size box. A locator already resolves to a
  // deliberate spot.
  const pendingPort = pendingFrom
    ? nodePort(pendingFrom, { ...pending!.to, w: 0, h: 0 }, pending!.fromLocator)
    : null
  const pendingPath: PendingPath | null = pendingPort
    ? {
        points: routeEdge(
          pendingPort.point,
          pending!.to,
          edgeStyleKind,
          // The cursor end has no side; routeEdge mirrors this one, so the
          // preview arrives square-on the way the committed edge will.
          pendingPort.side,
        ).points,
        kind: edgeStyleKind,
        // The colour this connector will actually be given on release, so the
        // preview shows which branch it is joining rather than a placeholder.
        color: branchColor(doc, pending!.fromNodeId),
      }
    : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = editingId !== null
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) undo.redo()
        else undo.undo()
        return
      }
      // Escape must be reachable precisely when `typing` is true — it is the
      // way out of an edit session. Handling it before the `typing` gate
      // (rather than after, as bare key-by-key checks below would suggest)
      // means editingId flips to null and returns immediately, without
      // falling through to Delete/v/c on the same keystroke.
      if (e.key === 'Escape') {
        // First press leaves the editor (or the export dialog), the next one
        // lets go of the selection — which is also what closes the colour
        // wheel and the link menu.
        if (exportOpen) setExportOpen(false)
        else if (typing) setEditingId(null)
        else {
          setSelection(new Set())
          setSelectedEdge(null)
        }
        return
      }
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdge !== null) {
          e.preventDefault()
          removeEdge(doc, selectedEdge, 'user')
          setSelectedEdge(null)
        } else if (selection.size > 0) {
          e.preventDefault()
          deleteNodes([...selection])
        }
        return
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault()
        onFit()
      }
      // No tool shortcuts: with connect gone as a mode there is nothing to
      // switch between, and `v`/`c` would only be a way to get stuck.
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, editingId, selection, selectedEdge, exportOpen, onFit, undo])

  if (error) {
    return (
      <div data-testid="board-error" style={{ padding: 24, font: '14px system-ui, sans-serif' }}>
        Couldn&apos;t load this board: {error}
      </div>
    )
  }

  if (!ready) return <div data-testid="loading">Loading board…</div>

  // The text being edited gets the format bar. A node that is simply clicked —
  // the only thing selected, nothing in flight — gets the colour wheel.
  const editNode = editingId !== null ? paintedById.get(editingId) : undefined
  const idle = !drag && !pending && !marquee && !resizing
  const wheelNode =
    !editNode && selection.size === 1 && idle ? paintedById.get([...selection][0]!) : undefined
  // The clicked link, with where its menu opens: halfway along it, on screen.
  const menuEdge = selectedEdge !== null && idle ? edges.find((e) => e.id === selectedEdge) : undefined
  const menuRoute = menuEdge ? routeFor(menuEdge, paintedById, edgeStyleKind) : null
  const screenBox = (n: Node) => worldRectToScreen({ x: n.x, y: n.y, w: n.w, h: n.h }, camera)

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Toolbar
        onAddText={onAddText}
        onUndo={() => undo.undo()}
        onRedo={() => undo.redo()}
        zoom={camera.zoom}
        onZoom={(factor) =>
          setCamera((c) => zoomAt(c, { x: viewport.w / 2, y: viewport.h / 2 }, factor))
        }
        edgeStyle={edgeStyleKind}
        onEdgeStyle={(kind) => setEdgeStyle(doc, kind)}
        onFit={onFit}
        onExport={() => setExportOpen((open) => !open)}
      />
      <World
        camera={camera}
        onViewport={onViewport}
        onWheel={gestures.onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <ConnectorLayer
          edges={edges}
          nodesById={paintedById}
          colors={edgeColors}
          kind={edgeStyleKind}
          selectedEdgeId={selectedEdge}
        />
        <NodeLayer
          nodes={shown}
          colors={nodeColors}
          selection={selection}
          editingId={editingId}
          onEdit={(id, patch) => updateNode(doc, id, patch, 'user')}
          onMeasure={(id, size) => {
            const n = nodesById.get(id)
            if (!n) return
            const patch: Partial<Node> = {}
            if (Math.abs(size.h - n.h) > 1) patch.h = size.h
            // Width changes about the centre, so text that shrinks to fit (or
            // a box that comes back) stays where the user put it.
            if (Math.abs(size.w - n.w) > 1) {
              patch.w = size.w
              patch.x = n.x + (n.w - size.w) / 2
            }
            if (Object.keys(patch).length > 0) updateNode(doc, id, patch, 'system')
          }}
          onEndEdit={(id) => setEditingId((current) => (current === id ? null : current))}
          onDelete={deleteNodes}
          dragPreview={drag}
          resizePreview={resizing}
        />
      </World>
      <Overlay camera={camera} marquee={marquee} pending={pendingPath} />
      {editNode && editNode.type === 'text' && (
        <FormatBar
          anchor={screenBox(editNode)}
          viewport={viewport}
          style={readTextStyle(editNode.props)}
          onPreset={(id) => setProps(editNode.id, applyPreset(editNode.props, id))}
          onStepSize={(dir) => {
            const { fontSize } = readTextStyle(editNode.props)
            setProps(editNode.id, withTextStyle(editNode.props, { fontSize: stepFontSize(fontSize, dir) }))
          }}
          onToggle={(key) => {
            const style = readTextStyle(editNode.props)
            setProps(editNode.id, withTextStyle(editNode.props, { [key]: !style[key] }))
          }}
        />
      )}
      {wheelNode && (
        <ColorWheel
          // Keyed by node so the opening animation replays when it moves to
          // another node, instead of the wheel sliding across.
          key={wheelNode.id}
          anchor={screenBox(wheelNode)}
          viewport={viewport}
          current={nodeColor(wheelNode)}
          effective={nodeColors.get(wheelNode.id) ?? null}
          onPick={(color) => {
            const { color: _old, ...rest } = wheelNode.props
            setProps(wheelNode.id, color ? { ...rest, color } : rest)
          }}
        />
      )}
      {menuEdge && menuRoute && (
        <EdgeMenu
          key={menuEdge.id}
          at={worldToScreen(routeMidpoint(menuRoute), camera)}
          viewport={viewport}
          current={edgeOwnColor(menuEdge)}
          effective={edgeColors.get(menuEdge.id) ?? null}
          onPick={(color) => setEdgeColor(doc, menuEdge.id, color, 'user')}
          onDelete={() => {
            removeEdge(doc, menuEdge.id, 'user')
            setSelectedEdge(null)
          }}
        />
      )}
      {exportOpen && (
        <ExportDialog
          initial={exportOptions}
          selectionSize={selection.size}
          onClose={() => setExportOpen(false)}
          onExport={async (options) => {
            setExportOptions(options)
            const content = exportContent(nodes, edges, options.scope, selection)
            const stored = metaMap(doc).get('title')
            await exportBoard(
              { ...content, edgeColors, nodeColors, kind: edgeStyleKind },
              options,
              boardTitle ?? (typeof stored === 'string' ? stored : 'board'),
            )
          }}
        />
      )}
      {picker && (
        <CreatePicker at={picker.client} onPick={onPick} onCancel={() => setPicker(null)} />
      )}
      <input
        ref={mediaInput}
        data-testid="media-input"
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])]
          // Cleared so choosing the same file again still fires a change.
          e.currentTarget.value = ''
          const at = mediaAt.current ?? viewportCentre()
          mediaAt.current = null
          if (files.length > 0) void addMedia(files, at)
        }}
      />
      {notice && (
        <div
          role="status"
          data-testid="notice"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 24,
            translate: '-50% 0',
            zIndex: 40,
            padding: '9px 14px',
            background: '#1a1a1a',
            color: '#fdfcf9',
            borderRadius: 8,
            font: '500 13px system-ui, sans-serif',
            maxWidth: 'min(520px, calc(100vw - 32px))',
          }}
        >
          {notice}
        </div>
      )}
      {status === 'offline' && (
        <div
          role="status"
          data-testid="sync-offline"
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            zIndex: 40,
            padding: '6px 10px',
            background: '#1a1a1a',
            color: '#fdfcf9',
            borderRadius: 8,
            font: '500 12px system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          Offline — changes are kept on this device and will sync when you reconnect.
        </div>
      )}
    </div>
  )
}

/** A copy of the node map with the in-flight drag offset applied to the dragged nodes. */
function offsetNodes(
  byId: Map<NodeId, Node>,
  drag: { ids: ReadonlySet<NodeId>; dx: number; dy: number },
): Map<NodeId, Node> {
  const out = new Map(byId)
  for (const id of drag.ids) {
    const n = out.get(id)
    if (n) out.set(id, { ...n, x: n.x + drag.dx, y: n.y + drag.dy })
  }
  return out
}

/** A copy of the node map with the in-flight resize applied. */
function resizedNodes(
  byId: Map<NodeId, Node>,
  r: { id: NodeId; w: number; h: number },
): Map<NodeId, Node> {
  const n = byId.get(r.id)
  if (!n) return byId
  const out = new Map(byId)
  out.set(r.id, { ...n, w: r.w, h: r.h })
  return out
}
