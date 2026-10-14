/**
 * The files in a drop, with any dropped folders opened up. `folder` names the
 * folder when exactly one was dropped, so a board started from it can take its
 * name.
 *
 * `dataTransfer.files` lists a folder as one unreadable entry; only the File
 * System Entries API walks into it. Its entries must be taken synchronously,
 * inside the drop event — the DataTransfer is emptied once the handler
 * returns — so call this before awaiting anything else.
 */
export function droppedFiles(dt: DataTransfer): Promise<{ files: File[]; folder: string | null }> {
  const entries = [...dt.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.() ?? null)
  if (entries.length === 0 || entries.some((e) => e === null)) {
    return Promise.resolve({ files: [...dt.files], folder: null })
  }
  const roots = entries as FileSystemEntry[]
  const dirs = roots.filter((e) => e.isDirectory)
  return Promise.all(roots.map(walk)).then((lists) => ({
    files: lists.flat().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    folder: dirs.length === 1 && roots.length === 1 ? dirs[0]!.name : null,
  }))
}

async function walk(entry: FileSystemEntry): Promise<File[]> {
  // Dotfiles (.DS_Store and friends) are never what was meant.
  if (entry.name.startsWith('.')) return []
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([])))
  }
  if (!entry.isDirectory) return []
  const reader = (entry as FileSystemDirectoryEntry).createReader()
  const children: FileSystemEntry[] = []
  // readEntries hands a directory back in batches (100 at a time in Chrome)
  // and signals the end with an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
    if (batch.length === 0) break
    children.push(...batch)
  }
  return (await Promise.all(children.map(walk))).flat()
}
