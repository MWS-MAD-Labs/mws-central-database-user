import { useState } from 'react'
import { EmailLanguageField } from './EmailLanguageField.jsx'

// The language of the email that carries the first password, chosen where the admin is about to send it: in the review
// before creating. It keeps its own choice and reports it, since the dialog only answers yes or no.
export function ReviewEmailLanguage({ initial = 'en', onChange }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="mb-5 rounded-xl border border-(--mws-line) bg-(--mws-soft) px-5 py-4">
      <EmailLanguageField
        value={value}
        name="review_email_language"
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    </div>
  )
}
