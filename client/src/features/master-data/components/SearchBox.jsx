import { DebouncedSearchInput } from "../../../components/ui/FormControls"

export function SearchBox({ value, placeholder, onChange }) {
  return (
    <DebouncedSearchInput
      value={value}
      placeholder={placeholder}
      className="lg:max-w-lg"
      onChange={onChange}
    />
  )
}
