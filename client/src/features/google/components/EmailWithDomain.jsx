import { useState } from 'react'
import { TextAction } from '../../../components/ui/TextAction.jsx'
import { SearchableSelect, TextInput } from '../../../components/ui/FormControls.jsx'
import { sanitizeEmail, sanitizeEmailLocalPart } from '../../../lib/form.js'

// The domains most people use, so the part after @ is one pick. Anything else (an organization's own mail) is typed.
const COMMON_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'yahoo.co.id', 'outlook.com', 'hotmail.com', 'icloud.com', 'proton.me']
const OTHER = '__other'
const DOMAIN_OPTIONS = [
  ...COMMON_EMAIL_DOMAINS.map((domain) => ({ value: domain, label: `@${domain}` })),
  { value: OTHER, label: 'Another Domain' },
]

const domainOf = (value) => (value.includes('@') ? value.slice(value.indexOf('@') + 1) : '')
const localOf = (value) => (value.includes('@') ? value.slice(0, value.indexOf('@')) : value)

// An email that is not the organization's: the name, and the domain as a pick (gmail.com first), with "Other" to type the
// whole address. The value stays one whole email, so a form and the server read it as before.
export function EmailWithDomain({ value, onChange, invalid = false, disabled = false, maxLength = 100 }) {
  const text = value || ''
  const [typing, setTyping] = useState(false)
  // The pick is kept while the name is still empty, since the value (name and domain) says nothing yet.
  const [chosen, setChosen] = useState(COMMON_EMAIL_DOMAINS[0])
  const domain = domainOf(text)
  // An address whose domain is not on the list is typed whole, however it got there (a draft, a suggestion).
  const whole = typing || (Boolean(domain) && !COMMON_EMAIL_DOMAINS.includes(domain))

  if (whole) {
    return (
      <div className="space-y-1.5">
        <TextInput
          type="email"
          maxLength={maxLength}
          value={text}
          invalid={invalid}
          disabled={disabled}
          placeholder="name@company.com"
          onChange={(event) => onChange(sanitizeEmail(event.target.value))}
        />
        {!disabled ? (
          <TextAction
            type="button"
            onClick={() => {
              setTyping(false)
              onChange(COMMON_EMAIL_DOMAINS.includes(domain) ? text : localOf(text) ? `${localOf(text)}@${chosen}` : '')
            }}
          >
            Pick a common domain
          </TextAction>
        ) : null}
      </div>
    )
  }

  const selected = COMMON_EMAIL_DOMAINS.includes(domain) ? domain : chosen
  return (
    <div className="flex min-w-0 items-stretch">
      <TextInput
        className="rounded-r-none"
        maxLength={maxLength}
        value={localOf(text)}
        invalid={invalid}
        disabled={disabled}
        placeholder="name"
        autoComplete="off"
        onChange={(event) => {
          const local = sanitizeEmailLocalPart(event.target.value, { external: true })
          onChange(local ? `${local}@${selected}` : '')
        }}
      />
      <SearchableSelect
        className="w-44 shrink-0"
        buttonClassName="rounded-l-none border-l-0"
        value={selected}
        disabled={disabled}
        options={DOMAIN_OPTIONS}
        placeholder="Domain"
        onChange={(next) => {
          if (next === OTHER) {
            setTyping(true)
            return
          }
          setChosen(next)
          onChange(localOf(text) ? `${localOf(text)}@${next}` : '')
        }}
      />
    </div>
  )
}
