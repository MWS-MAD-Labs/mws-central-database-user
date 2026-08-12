import { Edit, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'

export function RowActions({ disabled, onEdit, onDelete }) {
  return (
    <div className="flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onEdit}
      >
        <Edit size={15} />
        Edit
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  )
}
