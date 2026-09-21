import { useRef, useState, type ReactNode } from 'react'
import { useSwipeable } from 'react-swipeable'

const actionWidth = 88

/** Owns the mobile gesture and revealed action; the note button remains its child. */
export function SwipeableNoteRow({ children, deleteLabel, mobile, open, onOpenChange, onDelete }: {
  children: ReactNode; deleteLabel: string; mobile: boolean; open: boolean;
  onOpenChange(open: boolean): void; onDelete(): void
}) {
  const [dragX, setDragX] = useState<number | null>(null)
  const suppressClickUntil = useRef(0)
  const gestureAxis = useRef<'horizontal' | 'vertical' | null>(null)
  const offset = (deltaX: number) => Math.max(-actionWidth, Math.min(0, (open ? -actionWidth : 0) + deltaX))
  const swipe = useSwipeable({
    delta: 8,
    trackTouch: mobile,
    trackMouse: false,
    onTouchStartOrOnMouseDown: () => { suppressClickUntil.current = 0; gestureAxis.current = null },
    onSwiping: ({ dir, deltaX, absX, absY }) => {
      if (!mobile) return
      if (!gestureAxis.current) {
        if (absY >= 10 && absY >= absX) gestureAxis.current = 'vertical'
        else if (absX >= 18 && absX > absY * 1.5) gestureAxis.current = 'horizontal'
      }
      if (gestureAxis.current === 'horizontal' && (dir === 'Left' || dir === 'Right'))
        setDragX(offset(deltaX))
    },
    onSwiped: ({ deltaX }) => {
      setDragX(null)
      if (!mobile || gestureAxis.current !== 'horizontal') return
      onOpenChange(offset(deltaX) <= -actionWidth / 2)
      suppressClickUntil.current = Date.now() + 350
    },
    onTouchEndOrOnMouseUp: () => { setDragX(null); gestureAxis.current = null },
  })

  return <div {...swipe} className={`result-swipe ${open || (dragX !== null && dragX < 0) ? 'is-revealed' : ''}`}
    onTouchCancel={() => { setDragX(null); gestureAxis.current = null }} onClickCapture={event => {
    if (Date.now() < suppressClickUntil.current) {
      event.preventDefault()
      event.stopPropagation()
      suppressClickUntil.current = 0
    }
  }}>
    <div className="result-front" style={mobile ? { transform: `translate3d(${dragX ?? (open ? -actionWidth : 0)}px, 0, 0)`, transition: dragX === null ? undefined : 'none' } : undefined}>
      {children}
    </div>
    <button className="result-delete" type="button" aria-label={deleteLabel} tabIndex={open && mobile ? 0 : -1}
      onClick={onDelete}>Delete</button>
  </div>
}
