import { Check, MoreVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from './Button.jsx'

export function ActionsMenu({ label, disabled, children }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
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
      {isOpen ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-2xl border border-[var(--mws-line)] bg-white p-1.5 shadow-[0_18px_40px_-24px_rgba(36,23,24,0.5)]">
          {children(() => setIsOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function ActionsMenuItem({ children, checked, tone, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
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
