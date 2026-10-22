import { Field } from '../../../components/ui/FormControls.jsx'
import { cn } from '../../../lib/cn.js'

const EMAIL_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'id', label: 'Bahasa Indonesia' },
]

// Which language the email that carries the first password is written in: a two-way toggle, English unless the admin
// switches to Indonesian.
export function EmailLanguageField({ value, onChange, name = 'email_language', className }) {
  return (
    <Field label="Email Language" name={name} className={className}>
      <div
        role="radiogroup"
        aria-label="Email language"
        className="inline-flex rounded-xl border border-(--mws-line) bg-(--mws-soft) p-1"
      >
        {EMAIL_LANGUAGES.map((language) => {
          const selected = value === language.id
          return (
            <button
              key={language.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(language.id)}
              className={cn(
                'cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                selected ? 'bg-(--mws-burgundy) text-white shadow-sm' : 'text-(--mws-muted) hover:text-(--mws-charcoal)',
              )}
            >
              {language.label}
            </button>
          )
        })}
      </div>
    </Field>
  )
}
