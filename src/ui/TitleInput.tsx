import { useRef, useState } from 'react'

type Props = {
  initial: string
  /** The new text on Enter or blur; null on Escape. */
  onDone: (title: string | null) => void
  testId?: string
  style?: React.CSSProperties
}

/**
 * A board title being edited. Reports once and never twice: committing
 * unmounts it, and some browsers deliver a blur on the way out.
 */
export function TitleInput({ initial, onDone, testId, style }: Props) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  return (
    <input
      data-testid={testId}
      aria-label="Board title"
      autoFocus
      value={value}
      maxLength={120}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
      style={{
        minWidth: 0,
        padding: '5px 7px',
        border: '2px solid #1a1a1a',
        borderRadius: 6,
        font: '600 13px system-ui, sans-serif',
        color: '#1a1a1a',
        background: '#fff',
        ...style,
      }}
    />
  )
}
