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
        <Button type="button" variant="ghost" onClick={onView} size="icon" aria-label="View" title="View">
          <Eye size={15} />
        </Button>
      ) : null}
      {onManageMentors ? (
        <Button type="button" variant="ghost" onClick={onManageMentors} size="icon" aria-label="Mentors" title="Mentors">
          <Users size={15} />
        </Button>
      ) : null}
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          disabled={disableEdit ?? disabled}
          onClick={onEdit}
          size="icon" aria-label="Edit" title="Edit"
        >
          <Edit size={15} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        disabled={disableDelete ?? disabled}
        title={disableDelete ? deleteTitle : "Delete"}
        onClick={onDelete}
        size="icon" aria-label="Delete"
      >
        <Trash2 size={15} />
      </Button>
    </div>
  )
}
