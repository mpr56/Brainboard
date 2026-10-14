import { YServer } from 'y-partyserver'
import * as Y from 'yjs'

/** Under the 2 MB row limit of a Durable Object's SQLite, with room to spare. */
const CHUNK_BYTES = 1_000_000

function ensureTable(sql: SqlStorage): void {
  sql.exec('create table if not exists doc_chunks (seq integer primary key, data blob not null)')
}

/** The board's merged Yjs state, or null for a room that has never saved. */
export function readState(sql: SqlStorage): Uint8Array | null {
  ensureTable(sql)
  const rows = sql.exec<{ data: ArrayBuffer }>('select data from doc_chunks order by seq').toArray()
  if (rows.length === 0) return null
  const out = new Uint8Array(rows.reduce((n, r) => n + r.data.byteLength, 0))
  let at = 0
  for (const r of rows) {
    out.set(new Uint8Array(r.data), at)
    at += r.data.byteLength
  }
  return out
}

/**
 * Replaces the stored state. The whole merged document is written each time,
 * not appended updates, so storage tracks the board's size rather than its
 * history.
 */
export function writeState(storage: DurableObjectStorage, state: Uint8Array): void {
  storage.transactionSync(() => {
    ensureTable(storage.sql)
    storage.sql.exec('delete from doc_chunks')
    for (let at = 0, seq = 0; at < state.length; at += CHUNK_BYTES, seq++) {
      storage.sql.exec('insert into doc_chunks (seq, data) values (?, ?)', seq, state.slice(at, at + CHUNK_BYTES).buffer)
    }
  })
}

/**
 * One board's live document. Today exactly one user ever connects (the
 * owner), from one or more tabs or devices; live collaboration is this same
 * room with a wider gate.
 */
export class BoardRoom extends YServer {
  static options = { hibernate: true }
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 }

  #wiped = false

  async onLoad(): Promise<void> {
    const state = readState(this.ctx.storage.sql)
    if (state) Y.applyUpdate(this.document, state)
  }

  async onSave(): Promise<void> {
    if (this.#wiped) return
    writeState(this.ctx.storage, Y.encodeStateAsUpdate(this.document))
  }

  /** The board was deleted: drop every connection and everything stored. */
  async wipe(): Promise<void> {
    this.#wiped = true
    for (const conn of this.getConnections()) conn.close(4404, 'Board deleted')
    await this.ctx.storage.deleteAll()
  }
}
