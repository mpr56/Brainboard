import { nanoid } from 'nanoid'
import { clearDocument } from 'y-indexeddb'
import { boardKey } from '../document/persistence'
import { BOARDS, META, getAllByIndex, getOne, write, type OpenDb } from './localDb'
import type { BoardId, BoardRecord, BoardRepository, UserId } from './types'

/** The one board that existed before accounts did, at `brainstorm-canvas/default`. */
export const LEGACY_BOARD_ID = 'default'
const LEGACY_ADOPTED = 'legacyAdopted'

type Options = {
  now?: () => number
  newId?: () => BoardId
  /** Deletes a board's contents. Defaults to dropping its y-indexeddb database. */
  clearContents?: (boardId: BoardId) => Promise<void>
}

/**
 * The board registry, in IndexedDB. A board's contents stay where they always
 * were — one y-indexeddb database per board id — so a record here is only
 * ownership and a title, and adopting the pre-accounts board moves no data.
 */
export function createLocalBoards(open: OpenDb, opts: Options = {}): BoardRepository {
  const now = opts.now ?? Date.now
  const newId = opts.newId ?? (() => nanoid(12))
  const clearContents = opts.clearContents ?? ((id: BoardId) => clearDocument(boardKey(id)))

  const owned = async (userId: UserId, boardId: BoardId): Promise<BoardRecord> => {
    const b = await getOne<BoardRecord>(open, BOARDS, boardId)
    if (!b || b.ownerId !== userId) throw new Error('No such board.')
    return b
  }

  const put = (b: BoardRecord) => write(open, BOARDS, (s) => s.put(b))

  return {
    async list(userId) {
      const mine = await getAllByIndex<BoardRecord>(open, BOARDS, 'ownerId', userId)
      if (mine.length === 0 && !(await getOne(open, META, LEGACY_ADOPTED))) {
        // The first user this browser ever sees takes over the board from
        // before accounts. On a fresh install that database does not exist
        // yet, and y-indexeddb simply creates it empty — no harm either way.
        await write(open, META, (s) => s.put(true, LEGACY_ADOPTED))
        const t = now()
        const legacy: BoardRecord = {
          id: LEGACY_BOARD_ID,
          ownerId: userId,
          title: 'Untitled board',
          createdAt: t,
          openedAt: t,
        }
        await put(legacy)
        return [legacy]
      }
      return mine.sort((a, b) => a.createdAt - b.createdAt)
    },

    async create(userId, title) {
      const t = now()
      const b: BoardRecord = { id: newId(), ownerId: userId, title, createdAt: t, openedAt: t }
      await put(b)
      return b
    },

    async rename(userId, boardId, title) {
      const b = await owned(userId, boardId)
      await put({ ...b, title: title.trim() || b.title })
    },

    async markOpened(userId, boardId) {
      const b = await owned(userId, boardId)
      await put({ ...b, openedAt: now() })
    },

    async remove(userId, boardId) {
      await owned(userId, boardId)
      await write(open, BOARDS, (s) => s.delete(boardId))
      // Not awaited: the database is still open while the board being deleted
      // is torn down, and deleteDatabase waits for that close rather than
      // failing. Media blobs stay, as they do for a deleted node.
      void clearContents(boardId).catch(() => {})
    },
  }
}
