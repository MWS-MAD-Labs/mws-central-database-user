import { Eye, RotateCcw } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatStatus, statusTone } from '../../../lib/format.js'

export function StudentsTable({
  students,
  yearsById,
  sortBy,
  sortOrder,
  onSort,
  isLoading,
  isTrash,
  canRestore,
  restoringId,
  onRestore,
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
          <tr>
            <th className="px-4 py-3">
              <SortableHeader
                label="Name"
                column="full_name"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="NIS"
                column="nis"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Grade"
                column="grade"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Join Year"
                column="join_year"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3">
              <SortableHeader
                label="Status"
                column="status"
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                Loading students...
              </td>
            </tr>
          ) : students.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                No students found.
              </td>
            </tr>
          ) : (
            students.map((student) => (
              <tr
                key={student.id}
                className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]"
              >
                <td className="px-4 py-3">
                  <p className="font-semibold text-[#202326]">
                    {student.identity.full_name}
                  </p>
                  <p className="text-xs text-[#676c70]">
                    {student.identity.email}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-[#34383c]">
                    {student.academic.nis}
                  </p>
                  <p className="text-xs text-[#676c70]">
                    {student.academic.nisn || '-'}
                  </p>
                </td>
                <td className="px-4 py-3">{student.academic.current_grade}</td>
                <td className="px-4 py-3">
                  {yearsById[student.academic.join_academic_year_id] || '-'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge tone={statusTone(student.status)}>
                    {formatStatus(student.status)}
                  </StatusBadge>
                </td>
                <td className="px-4 py-3 text-right">
                  {isTrash ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canRestore || restoringId === student.id}
                      onClick={() => onRestore?.(student.id)}
                    >
                      <RotateCcw size={15} />
                      Restore
                    </Button>
                  ) : (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/students/${student.id}`}>
                        <Eye size={15} />
                        View
                      </Link>
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
