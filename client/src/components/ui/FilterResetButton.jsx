import { RotateCcw } from 'lucide-react'
import { Button } from './Button.jsx'

export function FilterResetButton({ visible, onReset, className }) {
  if (!visible) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Clear filters"
      title="Clear filters"
      className={className}
      onClick={onReset}
    >
      <RotateCcw size={15} />
    </Button>
  )
}
