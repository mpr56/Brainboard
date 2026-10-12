import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CreatePicker, SWIPE_PX } from './CreatePicker'

const at = { x: 400, y: 300 }
const picker = () => {
  const props = { at, onPick: vi.fn(), onCancel: vi.fn() }
  render(<CreatePicker {...props} />)
  return props
}
const move = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
  })

describe('CreatePicker', () => {
  it('picks text on a swipe to the left', () => {
    const { onPick } = picker()
    move(at.x - 10, at.y)
    move(at.x - SWIPE_PX - 1, at.y + 4)
    expect(onPick).toHaveBeenCalledWith('text')
  })

  it('picks media on a swipe to the right', () => {
    const { onPick } = picker()
    move(at.x + SWIPE_PX + 1, at.y)
    expect(onPick).toHaveBeenCalledWith('media')
  })

  it('lights up the side being leaned towards before picking it', () => {
    const { onPick } = picker()
    move(at.x + 12, at.y)
    expect(screen.getByTestId('create-media').getAttribute('data-lean')).toBe('true')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does not pick on a small or mostly vertical movement', () => {
    const { onPick } = picker()
    move(at.x + 5, at.y + 3)
    move(at.x + 30, at.y + 60)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes when the pointer wanders off without swiping', () => {
    const { onPick, onCancel } = picker()
    move(at.x + 20, at.y + 200)
    expect(onCancel).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks a side that is pressed', () => {
    const { onPick } = picker()
    fireEvent.pointerDown(screen.getByTestId('create-media'))
    expect(onPick).toHaveBeenCalledWith('media')
  })

  it('closes on a press anywhere else', () => {
    const { onCancel } = picker()
    fireEvent.pointerDown(document.body)
    expect(onCancel).toHaveBeenCalled()
  })

  it('answers to the arrow keys and Esc', () => {
    const { onPick } = picker()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onPick).toHaveBeenCalledWith('text')
  })

  it('closes on Esc', () => {
    const { onCancel } = picker()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('picks only once, however far the swipe goes', () => {
    const { onPick } = picker()
    move(at.x - 50, at.y)
    move(at.x - 80, at.y)
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
