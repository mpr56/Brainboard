import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardPreview, BoardRecord } from '../account/types'
import { Home } from './Home'

const board = (id: string, title: string, openedAt = 0): BoardRecord => ({ id, ownerId: 'u', title, createdAt: 0, openedAt })

const home = (over: Partial<React.ComponentProps<typeof Home>> = {}) => {
  const props = {
    boards: [board('a', 'Alpha', 1), board('b', 'Beta', 3), board('c', 'Gamma', 2)],
    loadPreview: vi.fn<(id: string) => Promise<BoardPreview | null>>().mockResolvedValue(null),
    onCreate: vi.fn(),
    onStartFromFiles: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
  const view = render(<Home {...props} />)
  return { props, view }
}

// jsdom has no object URLs; the test that needs them sets its own.
const { createObjectURL, revokeObjectURL } = URL
afterEach(() => {
  cleanup() // unmount first: unmounting revokes the URLs
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})

const titles = () => screen.getAllByTestId('board-card-title').map((t) => t.textContent)
const card = (id: string) => screen.getAllByTestId('board-card').find((c) => c.dataset.boardId === id)!

describe('Home', () => {
  it('puts the account slot in the sidebar', () => {
    home({ accountSlot: <span data-testid="slot">me</span> })
    expect(within(screen.getByRole('navigation', { name: 'Library' })).getByTestId('slot')).toBeTruthy()
  })

  it('lists boards most recently opened first, each linking to its board', () => {
    home()
    expect(titles()).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(within(card('a')).getByTestId('board-card-open').getAttribute('href')).toBe('#/b/a')
  })

  it('filters by title', () => {
    home()
    fireEvent.change(screen.getByTestId('home-search'), { target: { value: 'AL' } })
    expect(titles()).toEqual(['Alpha'])
    fireEvent.change(screen.getByTestId('home-search'), { target: { value: 'zzz' } })
    expect(screen.queryAllByTestId('board-card')).toHaveLength(0)
    expect(screen.getByTestId('home-no-results')).toBeTruthy()
  })

  it('shows a board’s picture and counts once its preview loads', async () => {
    const image = new Blob(['x'], { type: 'image/webp' })
    URL.createObjectURL = () => 'blob:thumb'
    URL.revokeObjectURL = () => {}
    home({
      loadPreview: vi.fn(async (id: string) => (id === 'a' ? { image, nodes: 30, media: 12, savedAt: 0 } : null)),
    })
    await waitFor(() => expect(within(card('a')).getByTestId('board-thumb').getAttribute('src')).toBe('blob:thumb'))
    expect(within(card('a')).getByTestId('board-card-meta').textContent).toContain('12 ▶ · 30 ▭')
    expect(within(card('b')).queryByTestId('board-thumb')).toBeNull()
  })

  it('calls a board with nothing on it empty', async () => {
    home({ loadPreview: vi.fn().mockResolvedValue({ image: null, nodes: 0, media: 0, savedAt: 0 }) })
    await waitFor(() => expect(within(card('a')).getByTestId('board-card-meta').textContent).toMatch(/^empty · /))
  })

  it('fetches a preview again when its revision moves on', async () => {
    const loadPreview = vi.fn().mockResolvedValue(null)
    const { props, view } = home({ loadPreview })
    await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(3))
    view.rerender(<Home {...props} loadPreview={loadPreview} previewRevs={{ b: 1 }} />)
    await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(4))
    expect(loadPreview).toHaveBeenLastCalledWith('b')
  })

  it('creates a board', () => {
    const { props } = home()
    fireEvent.click(screen.getByTestId('home-new'))
    expect(props.onCreate).toHaveBeenCalled()
  })

  it('renames from a card', () => {
    const { props } = home()
    fireEvent.click(within(card('c')).getByTestId('board-rename'))
    const input = screen.getByTestId('board-rename-input')
    fireEvent.change(input, { target: { value: 'Delta' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('c', 'Delta')
  })

  it('asks before deleting', () => {
    const { props } = home()
    fireEvent.click(within(card('b')).getByTestId('board-delete'))
    fireEvent.click(screen.getByTestId('board-delete-cancel'))
    expect(props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(within(card('b')).getByTestId('board-delete'))
    fireEvent.click(screen.getByTestId('board-delete-confirm'))
    expect(props.onDelete).toHaveBeenCalledWith('b')
  })

  it('starts a board from chosen files', () => {
    const { props } = home()
    const file = new File(['x'], 'cat.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('home-drop-input'), { target: { files: [file] } })
    expect(props.onStartFromFiles).toHaveBeenCalledWith([file], null)
  })

  it('says so when there are no boards', () => {
    home({ boards: [] })
    expect(screen.getByText(/No boards yet/)).toBeTruthy()
    expect(screen.getByTestId('home-drop')).toBeTruthy()
  })

  it('imports a chosen board file', async () => {
    const onImportFile = vi.fn().mockResolvedValue(undefined)
    home({ onImportFile })
    const file = new File(['{}'], 'plans.brainboard.json', { type: 'application/json' })
    fireEvent.change(screen.getByTestId('home-import-input'), { target: { files: [file] } })
    await waitFor(() => expect(onImportFile).toHaveBeenCalledWith(file))
    expect(screen.queryByTestId('home-import-error')).toBeNull()
  })

  it('says why a board file could not be imported', async () => {
    home({ onImportFile: vi.fn().mockRejectedValue(new Error('That file is not a board file.')) })
    fireEvent.change(screen.getByTestId('home-import-input'), { target: { files: [new File(['x'], 'x.json')] } })
    expect((await screen.findByTestId('home-import-error')).textContent).toContain('not a board file')
  })

  it('offers no import without a way to import', () => {
    home()
    expect(screen.queryByTestId('home-import')).toBeNull()
  })
})
