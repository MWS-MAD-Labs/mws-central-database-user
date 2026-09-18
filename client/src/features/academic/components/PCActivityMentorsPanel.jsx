import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Puzzle } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { formatDate } from '../../../lib/format.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { gradesApi } from '../api/academicApi.js'
import { defaultPaging } from '../../master-data/utils/params.js'
import { distinctGradeUnits } from '../../master-data/utils/pcActivityUnits.js'
import { pcActivitiesApi, pcActivityDefaultMentorsApi } from '../../master-data/api/masterDataApi.js'
import { HeaderCell } from '../../master-data/components/HeaderCell.jsx'
import { LoadingRows } from '../../master-data/components/LoadingRows.jsx'
import { PanelFrame } from '../../master-data/components/PanelFrame.jsx'
import { PCActivityMentorsDialog } from '../../master-data/components/PCActivityMentorsDialog.jsx'
import { SearchBox } from '../../master-data/components/SearchBox.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'

export function PCActivityMentorsPanel() {
  const { user } = useAuth()
  const isSuperAdmin = user?.type === 'admin' && user?.role === 'SUPER_ADMIN'
  const isDatabaseAdmin = user?.type === 'admin' && user?.role === 'DATABASE_ADMIN'
  const [searchParams] = useSearchParams()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: searchParams.get('search') || '',
    sort_by: 'name',
    sort_order: 'asc',
  })
  const [mentorsDialogFor, setMentorsDialogFor] = useState(null)

  const query = useQuery({
    queryKey: ['academic', 'pc-activities', params],
    queryFn: () => pcActivitiesApi.list(params),
  })
  const items = query.data?.data || []
  const paging = query.data?.paging || defaultPaging(params)

  const gradesQuery = useQuery({
    queryKey: ['master-data', 'grades', 'all'],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
  })
  const units = distinctGradeUnits(gradesQuery.data?.data || [])
  const dbAdminUnit = isDatabaseAdmin
    ? units.find((unit) => unit.id === user?.unit_id) || null
    : null
  const canWrite = isSuperAdmin || (isDatabaseAdmin && Boolean(dbAdminUnit))
  const comparisonUnits = isDatabaseAdmin ? (dbAdminUnit ? [dbAdminUnit] : []) : units

  const itemIds = items.map((item) => item.id)
  const defaultMentorsBatchQuery = useQuery({
    queryKey: ['pc-activity-default-mentors', 'batch', itemIds],
    queryFn: () => pcActivityDefaultMentorsApi.listBatch(itemIds),
    enabled: itemIds.length > 0,
  })
  const defaultMentorRows = defaultMentorsBatchQuery.data || []

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  return (
    <PanelFrame
      title="PC Activity Mentors"
      description="Default mentor per unit for each Passion Connection activity. Add or rename activities from Master Data."
      icon={Puzzle}
      isFetching={query.isFetching}
      onRefresh={() => {
        query.refetch()
        gradesQuery.refetch()
        defaultMentorsBatchQuery.refetch()
      }}
      toolbar={
        <SearchBox
          value={params.search}
          placeholder="Search PC activities"
          onChange={(value) => resetPageAndUpdate({ search: value })}
        />
      }
      notice={
        !isSuperAdmin && !isDatabaseAdmin
          ? "Only Super Admin or your unit's Database Admin can change default mentors."
          : isDatabaseAdmin && !dbAdminUnit
            ? "PC Activity mentors don't apply to your unit."
            : null
      }
    >
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Mentor</th>
            <HeaderCell
              label="Created"
              column="created_at"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={query.isLoading}
            isEmpty={items.length === 0}
            colSpan={4}
            label="PC activities"
          />
          {!query.isLoading
            ? items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                >
                  <td className="px-4 py-3 font-semibold">
                    <button
                      type="button"
                      className="cursor-pointer text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
                      onClick={() => setMentorsDialogFor(item)}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-(--mws-muted)">
                    {(() => {
                      const rows = defaultMentorRows.filter(
                        (row) => row.activity_id === item.id,
                      )
                      const itemUnitIds = item.units?.length
                        ? new Set(item.units.map((unit) => unit.id))
                        : null
                      const itemComparisonUnits = itemUnitIds
                        ? comparisonUnits.filter((unit) => itemUnitIds.has(unit.id))
                        : comparisonUnits
                      if (rows.length === 0) return 'No default mentor'
                      const uniqueMentorIds = new Set(rows.map((row) => row.mentor_id))
                      if (
                        itemComparisonUnits.length > 0 &&
                        rows.length === itemComparisonUnits.length &&
                        uniqueMentorIds.size === 1
                      ) {
                        return (
                          <span className="text-(--mws-charcoal)">
                            {rows[0].mentor_name}
                          </span>
                        )
                      }
                      return `Per unit (${rows.length}/${itemComparisonUnits.length})`
                    })()}
                  </td>
                  <td className="px-4 py-3 text-(--mws-muted)">
                    {formatDate(item.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setMentorsDialogFor(item)}
                    >
                      Manage Mentors
                    </Button>
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="PC activities"
        isLoading={query.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {mentorsDialogFor ? (
        <PCActivityMentorsDialog
          activity={mentorsDialogFor}
          canWrite={canWrite}
          restrictToUnitId={isDatabaseAdmin ? user?.unit_id : undefined}
          onClose={() => setMentorsDialogFor(null)}
        />
      ) : null}
    </PanelFrame>
  )
}
