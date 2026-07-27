import { cn } from '../../lib/cn.js'

const inputClasses =
  'h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A] disabled:bg-[var(--mws-soft)] disabled:text-[#8d7b7d]'

export function Field({ label, children, hint, className }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="font-display text-sm font-semibold text-[var(--mws-charcoal)]">{label}</span>
      {children}
      {hint ? <span className="block text-xs leading-5 text-[var(--mws-muted)]">{hint}</span> : null}
    </label>
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
