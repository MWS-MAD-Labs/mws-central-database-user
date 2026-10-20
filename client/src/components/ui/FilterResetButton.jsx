import { Button } from './Button.jsx'

export function FilterResetButton({ visible, onReset, className }) {
  if (!visible) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      onClick={onReset}
    >
      Clear filters
    </Button>
  )
}
