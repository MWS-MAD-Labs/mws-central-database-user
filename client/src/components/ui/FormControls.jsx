import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn.js'

const inputClasses =
  'h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] disabled:bg-[var(--mws-soft)] disabled:text-[#8d7b7d]'

export function Field({ label, children, hint, className }) {
  return (
    <div className={cn('block space-y-1.5', className)}>
      <span className="font-display text-sm font-semibold text-[var(--mws-charcoal)]">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-5 text-[var(--mws-muted)]">{hint}</span> : null}
    </div>
  )
}

export function TextInput({ className, ...props }) {
  return <input className={cn(inputClasses, className)} {...props} />
}

export function SelectInput({ className, children, ...props }) {
  return (
    <select className={cn(inputClasses, className)} {...props}>
      {children}
    </select>
  )
}

export function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = 'Select',
  searchPlaceholder = 'Search',
  emptyLabel = 'No options found',
  disabled = false,
  required = false,
  className,
  buttonClassName,
  searchableThreshold = 10,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const wrapperRef = useRef(null)
  const searchInputRef = useRef(null)
  const shouldSearch = options.length >= searchableThreshold
  const selectedOption = options.find((option) => option.value === value)
  const filteredOptions = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    if (!normalized) return options
    return options.filter((option) =>
      [option.label, option.description, option.searchText, option.badge]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    )
  }, [options, searchTerm])

  useEffect(() => {
    if (!isOpen) return undefined

    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && shouldSearch) searchInputRef.current?.focus()
  }, [isOpen, shouldSearch])

  function selectOption(option) {
    if (option.disabled) return
    onChange(option.value)
    setSearchTerm('')
    setIsOpen(false)
  }

  return (
    <div ref={wrapperRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          inputClasses,
          'flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed',
          required && !value ? 'border-[#c75f64]' : null,
          buttonClassName,
        )}
      >
        <span className="min-w-0 flex-1">
          {selectedOption ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.badge ? (
                <span
                  className={cn(
                    'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                    badgeToneClass(selectedOption.tone),
                  )}
                >
                  {selectedOption.badge}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[var(--mws-muted)]">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={16} className="shrink-0 text-[var(--mws-muted)]" />
      </button>

      {isOpen ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-28px_rgba(36,23,24,0.5)]">
          {shouldSearch ? (
            <label className="relative block border-b border-[var(--mws-line)]">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                placeholder={searchPlaceholder}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-10 w-full bg-white pl-9 pr-3 text-sm outline-none"
              />
            </label>
          ) : null}
          <div role="listbox" className="max-h-64 overflow-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[var(--mws-muted)]">
                {emptyLabel}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onClick={() => selectOption(option)}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm transition',
                    option.value === value ? 'bg-[var(--mws-soft)]' : 'hover:bg-[var(--mws-soft)]',
                    option.disabled ? 'cursor-not-allowed opacity-60' : null,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-[var(--mws-charcoal)]">
                      {option.label}
                    </span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs text-[var(--mws-muted)]">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {option.badge ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                        badgeToneClass(option.tone),
                      )}
                    >
                      {option.badge}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function badgeToneClass(tone = 'neutral') {
  const tones = {
    green: 'bg-[#edf4eb] text-[#476b43]',
    amber: 'bg-[#fff4d8] text-[#8a6419]',
    red: 'bg-[#fff0f1] text-[#a43c41]',
    neutral: 'bg-[#eef3fb] text-[var(--mws-navy)]',
  }
  return tones[tone] || tones.neutral
}

export function TextAreaInput({ className, ...props }) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] disabled:bg-[var(--mws-soft)] disabled:text-[#8d7b7d]',
        className,
      )}
      {...props}
    />
  )
}

export function CheckboxField({ label, description, className, ...props }) {
  return (
    <label
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2.5 text-sm text-[var(--mws-charcoal)] transition hover:border-[var(--mws-burgundy)]',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-[var(--mws-burgundy)]"
        {...props}
      />
      <span>
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="block text-xs text-[var(--mws-muted)]">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
