import { Check, MoreVertical } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button.jsx'

const MENU_GAP = 8
const ESTIMATED_MENU_HEIGHT = 220

export function ActionsMenu({ label, disabled, children, renderTrigger }) {
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
      {renderTrigger ? (
        renderTrigger({
          onClick: () => setIsOpen((current) => !current),
          isOpen,
        })
      ) : (
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
      )}
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
              className="z-50 w-56 rounded-2xl border border-(--mws-line) bg-white p-1.5 shadow-[0_18px_40px_-24px_rgba(36,23,24,0.5)]"
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
          : tone === 'success'
            ? 'text-[#476b43] hover:bg-[#edf4eb]'
            : tone === 'warning'
              ? 'text-[#8a6419] hover:bg-[#fff4d8]'
              : 'text-(--mws-charcoal) hover:bg-(--mws-soft)',
      ].join(' ')}
    >
      <span>{children}</span>
      {checked ? <Check size={15} className="shrink-0 text-(--mws-burgundy)" /> : null}
    </button>
  )
}
