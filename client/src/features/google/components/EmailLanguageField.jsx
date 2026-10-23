import { Field } from '../../../components/ui/FormControls.jsx'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.jsx'

const EMAIL_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa Indonesia' },
]

// Which language the email that carries the first password is written in: a two-way toggle, English unless the admin
// switches to Indonesian.
export function EmailLanguageField({ value, onChange, name = 'email_language', className }) {
  return (
    <Field label="Email Language" name={name} className={className}>
      <SegmentedControl label="Email language" options={EMAIL_LANGUAGES} value={value} onChange={onChange} />
    </Field>
  )
}
