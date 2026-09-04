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

// Assigning a mentor is a "who does what" workflow, not catalog data - so
// it lives here under Academic (alongside Class Teacher Assignments),
// while the activity names themselves stay owned by Master Data > PC
// Activities (rename/delete only happen there). The name opens the same
// Manage Mentors dialog as the button - there's no separate detail page.
export function PCActivityMentorsPanel() {
  const { user } = useAuth()
  const isSuperAdmin = user?.type === 'admin' && user?.role === 'SUPER_ADMIN'
  const isDatabaseAdmin = user?.type === 'admin' && user?.role === 'DATABASE_ADMIN'
  // Seeds the search box from ?search= - lets a link from elsewhere (e.g. an
  // employee's PC Activity Mentorships) land here pre-filtered to one
  // activity, without needing to open a dialog by id.
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
  // A DATABASE_ADMIN's own unit - null if their unit doesn't have any
  // grades (e.g. a support unit like BRIDGE), meaning PC activity mentors
  // don't apply to them at all.
  const dbAdminUnit = isDatabaseAdmin
    ? units.find((unit) => unit.id === user?.unit_id) || null
    : null
  const canWrite = isSuperAdmin || (isDatabaseAdmin && Boolean(dbAdminUnit))
  // What "Mentor" column comparisons are made against - a Super Admin
  // compares across every unit, a DATABASE_ADMIN only ever has their own
  // one unit in scope (listBatch() below is already backend-scoped to
  // match).
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
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
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
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold">
                    <button
                      type="button"
                      className="cursor-pointer text-[var(--mws-charcoal)] hover:text-[var(--mws-burgundy)] hover:underline"
                      onClick={() => setMentorsDialogFor(item)}
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
                    {(() => {
                      const rows = defaultMentorRows.filter(
                        (row) => row.activity_id === item.id,
                      )
                      if (rows.length === 0) return 'No default mentor'
                      const uniqueMentorIds = new Set(rows.map((row) => row.mentor_id))
                      if (
                        comparisonUnits.length > 0 &&
                        rows.length === comparisonUnits.length &&
                        uniqueMentorIds.size === 1
                      ) {
                        return (
                          <span className="text-[var(--mws-charcoal)]">
                            {rows[0].mentor_name}
                          </span>
                        )
                      }
                      return `Per unit (${rows.length}/${comparisonUnits.length})`
                    })()}
                  </td>
                  <td className="px-4 py-3 text-[var(--mws-muted)]">
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
