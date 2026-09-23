import { RotateCcw } from 'lucide-react'
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
      <RotateCcw size={14} />
      Clear filters
    </Button>
  )
}
