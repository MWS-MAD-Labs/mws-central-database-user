import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { LoadingRows } from './LoadingRows.jsx'
import { defaultPaging } from '../utils/params'

// Shown instead of a blocking "N employee(s)" toast when narrowing a Job
// Position/Job Level's units would leave existing employees outside the
// new selection - lists exactly who, paginated, linked to their detail
// page, since the admin can't act on a bare count.
export function ReassignmentImpactDialog({ resource, record, unitIds, onClose }) {
  const [params, setParams] = useState({ page: 1, size: 10 })

  const query = useQuery({
    queryKey: [
      'master-data-reassignment-preview',
      resource.id,
      record.id,
      unitIds,
      params,
    ],
    queryFn: () =>
      resource.api.previewReassignmentImpact(record.id, unitIds, params),
  })

  const items = query.data?.data || []
  const paging = query.data?.paging || defaultPaging(params)

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  return (
    <CrudDialog
      title={`Can't narrow this ${resource.singular.toLowerCase()}'s units yet`}
      description={`These employees are currently on "${record.name}" but in a unit outside the selection you just picked. Reassign them to a matching unit (or a different ${resource.singular.toLowerCase()}) first, then try saving again.`}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <th className="px-4 py-3">Employee</th>
            <th className="px-4 py-3">Current Unit</th>
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={items.length === 0}
            colSpan={2}
            label="employees"
          />
          {!query.isLoading
            ? items.map((item) => (
                <tr
                  key={item.employee_id}
                  className="border-t border-[var(--mws-line)] bg-white"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/employees/${item.employee_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[var(--mws-burgundy)] hover:underline"
                    >
                      {item.full_name}
                    </Link>
                    <div className="mt-0.5 text-xs text-[var(--mws-muted)]">
                      {item.employee_number}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
                    {item.unit_name}
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="employees"
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />
    </CrudDialog>
  )
}
