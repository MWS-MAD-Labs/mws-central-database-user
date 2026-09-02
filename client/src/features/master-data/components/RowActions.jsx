import { Edit, Eye, Trash2, Users } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'

export function RowActions({
  disabled,
  disableEdit,
  disableDelete,
  deleteTitle,
  onView,
  onManageMentors,
  onEdit,
  onDelete,
}) {
  return (
    <div className="flex justify-end gap-1">
      {onView ? (
        <Button type="button" variant="ghost" size="sm" onClick={onView}>
          <Eye size={15} />
          View
        </Button>
      ) : null}
      {onManageMentors ? (
        <Button type="button" variant="ghost" size="sm" onClick={onManageMentors}>
          <Users size={15} />
          Mentors
        </Button>
      ) : null}
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disableEdit ?? disabled}
          onClick={onEdit}
        >
          <Edit size={15} />
          Edit
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disableDelete ?? disabled}
        title={disableDelete ? deleteTitle : undefined}
        onClick={onDelete}
      >
        <Trash2 size={15} />
        Delete
      </Button>
    </div>
  )
}
