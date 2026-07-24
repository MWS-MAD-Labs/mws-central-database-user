import { cn } from '../../lib/cn.js'

const inputClasses =
  'h-10 w-full rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#202326] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df] disabled:bg-[#f2f2ed] disabled:text-[#7a7f83]'

export function Field({ label, children, hint, className }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium text-[#42474c]">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-[#747a7e]">{hint}</span> : null}
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
        'min-h-24 w-full rounded-md border border-[#d8d6cf] bg-white px-3 py-2 text-sm text-[#202326] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df] disabled:bg-[#f2f2ed] disabled:text-[#7a7f83]',
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
        'flex min-h-10 items-start gap-3 rounded-md border border-[#e1dfd8] bg-white px-3 py-2 text-sm text-[#303438]',
        className,
      )}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-[#24463f]"
        {...props}
      />
      <span>
        <span className="block font-medium">{label}</span>
        {description ? (
          <span className="block text-xs text-[#747a7e]">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
