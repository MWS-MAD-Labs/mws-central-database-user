import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { LoadingRows } from './LoadingRows.jsx'
import { defaultPaging } from '../utils/params'

const DEFAULT_REASSIGNMENT_PREVIEW_CONFIG = {
  entityLabel: 'employee',
  columnLabel: 'Employee',
  itemLabel: 'employees',
  idField: 'employee_id',
  nameField: 'full_name',
  secondaryField: 'employee_number',
  linkTo: (item) => `/employees/${item.employee_id}`,
}

export function ReassignmentImpactDialog({ resource, record, unitIds, onClose }) {
  const [params, setParams] = useState({ page: 1, size: 10 })
  const previewConfig = resource.reassignmentPreview || DEFAULT_REASSIGNMENT_PREVIEW_CONFIG

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
      description={`These ${previewConfig.itemLabel} are currently on "${record.name}" but in a unit outside the selection you just picked. Reassign them to a matching unit (or a different ${resource.singular.toLowerCase()}) first, then try saving again.`}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            <th className="px-4 py-3">{previewConfig.columnLabel}</th>
            <th className="px-4 py-3">Current Unit</th>
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={items.length === 0}
            colSpan={2}
            label={previewConfig.itemLabel}
          />
          {!query.isLoading
            ? items.map((item) => (
                <tr
                  key={item[previewConfig.idField]}
                  className="border-t border-(--mws-line) bg-white"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={previewConfig.linkTo(item)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-(--mws-burgundy) hover:underline"
                    >
                      {item[previewConfig.nameField]}
                    </Link>
                    {previewConfig.secondaryField ? (
                      <div className="mt-0.5 text-xs text-(--mws-muted)">
                        {item[previewConfig.secondaryField]}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-(--mws-muted)">
                    {item.unit_name}
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel={previewConfig.itemLabel}
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />
    </CrudDialog>
  )
}
