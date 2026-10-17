import 'fake-indexeddb/auto'

// jsdom 25 ships no `CSS` object at all, so `CSS.escape` — which NodeLayer
// uses to build the selector that focuses a node entering edit mode — throws
// under test while working fine in every real browser. Minimal stand-in: it
// escapes anything outside the identifier-safe set, plus a leading digit,
// which is the whole of what an id can contain here.
if (!(globalThis as { CSS?: unknown }).CSS) {
  ;(globalThis as { CSS?: unknown }).CSS = {
    escape: (value: string) =>
      String(value).replace(/[^a-zA-Z0-9_-]|^[0-9]|^-[0-9]/g, (m) =>
        m.split('').map((c) => `\\${c}`).join(''),
      ),
  }
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom 25's Blob has no arrayBuffer(), which every browser has had since 2020.
// FileReader is the one route to its bytes that jsdom does implement.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}
