import { Field } from '../../../components/ui/FormControls.jsx'

const EMAIL_LANGUAGES = [
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'en', label: 'English' },
]

// Which language the email that carries the first password is written in. Indonesian unless the admin picks English.
export function EmailLanguageField({ value, onChange, name = 'email_language', className }) {
  return (
    <Field label="Email Language" name={name} className={className} hint="The language of the email that carries the password.">
      <div role="radiogroup" aria-label="Email language" className="flex flex-wrap gap-3">
        {EMAIL_LANGUAGES.map((language) => (
          <label
            key={language.id}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-(--mws-line) px-4 py-2.5 text-sm text-(--mws-charcoal)"
          >
            <input
              type="radio"
              name={`${name}-choice`}
              className="accent-(--mws-burgundy)"
              checked={value === language.id}
              onChange={() => onChange(language.id)}
            />
            {language.label}
          </label>
        ))}
      </div>
    </Field>
  )
}
