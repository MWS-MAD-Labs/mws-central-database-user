import { Field, TextInput } from '../../../components/ui/FormControls.jsx'
import { TextAction } from '../../../components/ui/TextAction.jsx'
import { sanitizeEmail, suggestEmailDomain } from '../../../lib/form.js'

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

// The same email typed a second time, so a slip is caught before a password is mailed to it. Pasting is blocked on
// purpose: pasting the first one in would check nothing.
// Off until the email above is filled in and valid: there is nothing to repeat before that.
export function ConfirmEmailField({ name, value, error, onChange, disabled = false }) {
  return (
    <Field
      label="Confirm Email"
      name={name}
      error={disabled ? undefined : error}
      required={!disabled}
      hint={disabled ? "Fill in the email above first." : "Type it again."}
    >
      <TextInput
        type="email"
        maxLength={100}
        value={disabled ? "" : value}
        disabled={disabled}
        invalid={!disabled && Boolean(error)}
        placeholder="name@gmail.com"
        autoComplete="off"
        onPaste={(event) => event.preventDefault()}
        onChange={(event) => onChange(sanitizeEmail(event.target.value))}
      />
    </Field>
  )
}
