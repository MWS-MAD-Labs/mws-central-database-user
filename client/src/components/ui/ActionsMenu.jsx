import { Check, MoreVertical } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button.jsx'

const MENU_GAP = 8
// Rough upper-bound height for a menu with a handful of items - used only to
// decide whether to flip the menu above the trigger when there isn't enough
// room below, not as a hard clamp.
const ESTIMATED_MENU_HEIGHT = 220

// Renders its dropdown into a portal at document.body, positioned with
// `fixed` from the trigger button's own rect - not `absolute` inside the
// trigger's own DOM position. A row-level menu inside a horizontally
// scrollable table (overflow-x-auto) would otherwise get counted as part of
// that container's scrollable content, which makes the browser grow an ugly
// vertical scrollbar on the table wrapper just to fit the open menu.
export function ActionsMenu({ label, disabled, children }) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const openUpward =
      window.innerHeight - rect.bottom < ESTIMATED_MENU_HEIGHT &&
      rect.top > window.innerHeight - rect.bottom
    setPosition({
      top: openUpward ? undefined : rect.bottom + MENU_GAP,
      bottom: openUpward
        ? window.innerHeight - rect.top + MENU_GAP
        : undefined,
      right: Math.max(window.innerWidth - rect.right, 8),
    })
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event) {
      if (
        triggerRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
      ) {
        return
      }
      setIsOpen(false)
    }
    function handleDismiss() {
      setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    // Capture phase so scrolling any nested scroll container (e.g. the
    // table's own horizontal scroll) closes the menu too, not just window
    // scroll - scroll events don't bubble, but capturing listeners on window
    // still see them on the way down.
    window.addEventListener('scroll', handleDismiss, true)
    window.addEventListener('resize', handleDismiss)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleDismiss, true)
      window.removeEventListener('resize', handleDismiss)
    }
  }, [isOpen])

  return (
    <div ref={triggerRef} className="relative inline-block">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={label}
      >
        <MoreVertical size={15} />
      </Button>
      {isOpen && position
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                top: position.top,
                bottom: position.bottom,
                right: position.right,
              }}
              className="z-50 w-56 rounded-2xl border border-[var(--mws-line)] bg-white p-1.5 shadow-[0_18px_40px_-24px_rgba(36,23,24,0.5)]"
            >
              {children(() => setIsOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function ActionsMenuItem({
  children,
  checked,
  tone,
  disabled,
  title,
  onClick,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'danger'
          ? 'text-[#9f3d41] hover:bg-[#fff5f5]'
          : 'text-[var(--mws-charcoal)] hover:bg-[var(--mws-soft)]',
      ].join(' ')}
    >
      <span>{children}</span>
      {checked ? <Check size={15} className="shrink-0 text-[var(--mws-burgundy)]" /> : null}
    </button>
  )
}
