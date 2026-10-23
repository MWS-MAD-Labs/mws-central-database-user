import { Field, TextInput } from '../../../components/ui/FormControls.jsx'
import { TextAction } from '../../../components/ui/TextAction.jsx'
import { sanitizeEmail, sanitizeEmailLocalPart, suggestEmailDomain } from '../../../lib/form.js'
import { COMMON_EMAIL_DOMAINS, domainOf, localOf } from '../utils/emailDomains.js'

// Under a hint: a likely misspelling of a popular domain, with one click to take the fix.
export function EmailSuggestion({ email, onUse }) {
  const suggestion = suggestEmailDomain(email)
  if (!suggestion) return null
  return (
    <span className="ml-1">
      Did you mean <span className="font-semibold">{suggestion}</span>? <TextAction onClick={() => onUse(suggestion)}>Use it</TextAction>
    </span>
  )
}

// The same email typed a second time, so a slip is caught before a password is mailed to it. When the first one is on a
// common domain the domain is shown as fixed and only the name is typed again, since the domain was a pick. Pasting is
// blocked on purpose: pasting the first one in would check nothing. Off until the email above is filled in and valid:
// there is nothing to repeat before that.
export function ConfirmEmailField({ name, value, primary = '', error, onChange, disabled = false, label = 'Confirm Email' }) {
  const domain = domainOf(primary)
  const nameOnly = COMMON_EMAIL_DOMAINS.includes(domain)
  const invalid = !disabled && Boolean(error)
  return (
    <Field label={label} name={name} error={disabled ? undefined : error} required={!disabled}>
      {nameOnly ? (
        <div className="flex min-w-0 items-stretch">
          <TextInput
            className="rounded-r-none"
            maxLength={100}
            value={disabled ? '' : localOf(value)}
            disabled={disabled}
            invalid={invalid}
            placeholder="Email"
            autoComplete="off"
            onPaste={(event) => event.preventDefault()}
            onChange={(event) => onChange(sanitizeEmailLocalPart(event.target.value, { external: true }))}
          />
          <span className="flex shrink-0 items-center whitespace-nowrap rounded-r-xl border border-l-0 border-(--mws-line) bg-(--mws-soft) px-3 text-sm text-(--mws-muted)">
            @{domain}
          </span>
        </div>
      ) : (
        <TextInput
          type="email"
          maxLength={100}
          value={disabled ? '' : value}
          disabled={disabled}
          invalid={invalid}
          placeholder="name@company.com"
          autoComplete="off"
          onPaste={(event) => event.preventDefault()}
          onChange={(event) => onChange(sanitizeEmail(event.target.value))}
        />
      )}
    </Field>
  )
}
