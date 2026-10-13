import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BoardRecord } from '../account/types'
import { BoardMenu } from './BoardMenu'

const board = (id: string, title: string): BoardRecord => ({ id, ownerId: 'u', title, createdAt: 0, openedAt: 0 })

const menu = (over: Partial<React.ComponentProps<typeof BoardMenu>> = {}) => {
  const props = {
    boards: [board('a', 'Alpha'), board('b', 'Beta')],
    currentId: 'a',
    onOpen: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(board('c', 'Untitled board')),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
  const view = render(<BoardMenu {...props} />)
  return { props, view }
}

const open = () => fireEvent.click(screen.getByTestId('board-menu-toggle'))
const row = (id: string) => screen.getAllByTestId('board-row').find((r) => r.dataset.boardId === id)!

describe('BoardMenu', () => {
  it('shows the open board and lists the rest on demand', () => {
    menu()
    expect(screen.getByTestId('board-menu-toggle').textContent).toContain('Alpha')
    expect(screen.queryByTestId('board-menu')).toBeNull()
    open()
    expect(screen.getAllByTestId('board-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
    ])
    expect(row('a').getAttribute('aria-current')).toBe('true')
  })

  it('opens a board and closes', () => {
    const { props } = menu()
    open()
    fireEvent.click(within(row('b')).getByTestId('board-open'))
    expect(props.onOpen).toHaveBeenCalledWith('b')
    expect(screen.queryByTestId('board-menu')).toBeNull()
  })

  it('does not reopen the board already open', () => {
    const { props } = menu()
    open()
    fireEvent.click(within(row('a')).getByTestId('board-open'))
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('names a new board straight away', async () => {
    const { props, view } = menu()
    open()
    fireEvent.click(screen.getByTestId('board-new'))
    await waitFor(() => expect(props.onCreate).toHaveBeenCalled())
    // The parent hands back the list with the new board in it.
    view.rerender(<BoardMenu {...props} boards={[...props.boards, board('c', 'Untitled board')]} currentId="c" />)
    const input = await screen.findByTestId('board-rename-input')
    fireEvent.change(input, { target: { value: 'Gamma' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('c', 'Gamma')
    // Naming it was the last step of making it; the board is what comes next.
    expect(screen.queryByTestId('board-menu')).toBeNull()
  })

  it('renames on Enter and leaves the title alone on Escape', () => {
    const { props } = menu()
    open()
    fireEvent.click(within(row('b')).getByTestId('board-rename'))
    const input = screen.getByTestId('board-rename-input')
    fireEvent.change(input, { target: { value: 'Nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(props.onRename).not.toHaveBeenCalled()
    // Escape left the rename, not the menu.
    expect(screen.getByTestId('board-menu')).toBeTruthy()

    fireEvent.click(within(row('b')).getByTestId('board-rename'))
    const again = screen.getByTestId('board-rename-input')
    fireEvent.change(again, { target: { value: 'Bravo' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('b', 'Bravo')
  })

  it('asks before deleting', () => {
    const { props } = menu()
    open()
    fireEvent.click(within(row('b')).getByTestId('board-delete'))
    expect(props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('board-delete-cancel'))
    expect(props.onDelete).not.toHaveBeenCalled()

    fireEvent.click(within(row('b')).getByTestId('board-delete'))
    fireEvent.click(screen.getByTestId('board-delete-confirm'))
    expect(props.onDelete).toHaveBeenCalledWith('b')
  })

  it('keeps its keys away from the board behind it', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      menu()
      open()
      fireEvent.click(within(row('b')).getByTestId('board-rename'))
      // Backspace in the title field must not delete selected nodes.
      fireEvent.keyDown(screen.getByTestId('board-rename-input'), { key: 'Backspace' })
      expect(onKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })

  it('closes on Escape and on a press outside it', () => {
    menu()
    open()
    fireEvent.keyDown(screen.getByTestId('board-menu'), { key: 'Escape' })
    expect(screen.queryByTestId('board-menu')).toBeNull()
    open()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('board-menu')).toBeNull()
    // Escape with focus out on the page closes it too.
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('board-menu')).toBeNull()
  })
})
