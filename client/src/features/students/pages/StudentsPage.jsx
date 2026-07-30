import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RotateCcw, Search } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SearchableSelect } from '../../../components/ui/FormControls.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { DataTransferActions } from '../../import-export/components/DataTransferActions.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import {
  studentsApi,
  studentStatuses,
} from '../api/studentsApi.js'
import { StudentsTable } from '../components/StudentsTable.jsx'
import { useStudentsSearchParams } from '../hooks/useStudentsSearchParams.js'
import { formatStatus } from '../../../lib/format.js'

export function StudentsPage() {
  const { params, updateParams, resetPageAndUpdate } =
    useStudentsSearchParams()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const queryParams = useMemo(
    () => ({
      page: params.page,
      size: params.size,
      search: params.search,
      status: params.status,
      current_grade_id: params.current_grade_id,
      current_class_id: params.current_class_id,
      join_academic_year_id: params.join_academic_year_id,
      is_deleted: params.is_deleted,
      sort_by: params.sort_by,
      sort_order: params.sort_order,
    }),
    [params],
  )

  const studentsQuery = useQuery({
    queryKey: ['students', queryParams],
    queryFn: () => studentsApi.list(queryParams),
  })

  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  const restoreMutation = useMutation({
    mutationFn: studentsApi.restore,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
  })

  const paging = studentsQuery.data?.paging || {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }

  const yearsById = useMemo(() => {
    return Object.fromEntries(
      (optionsQuery.data?.academicYears || []).map((year) => [
        year.id,
        year.name,
      ]),
    )
  }, [optionsQuery.data?.academicYears])

  const isTrash = params.is_deleted === 'true'
  const canWrite = user?.type === 'admin' && user?.role !== 'VIEWER'
  const canRestore = user?.role === 'SUPER_ADMIN'
  const canImport = user?.role === 'SUPER_ADMIN'

  const handleRestore = useCallback((studentId) => {
    restoreMutation.mutate(studentId)
  }, [restoreMutation])

  function handleSort(column, nextOrder) {
    resetPageAndUpdate({ sort_by: column, sort_order: nextOrder })
  }

  function resetFilters() {
    resetPageAndUpdate({
      search: '',
      status: '',
      current_grade_id: '',
      current_class_id: '',
      join_academic_year_id: '',
      is_deleted: '',
      sort_by: '',
      sort_order: '',
    })
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Students"
        description="Maintain active, transferred, graduated, and archived student records."
        actions={
          <>
            <DataTransferActions
              entity="students"
              exportParams={queryParams}
              canImport={canImport}
              canExport={user?.type === 'admin'}
            />
            {canWrite ? (
              <Button asChild>
                <Link to="/students/new">
                  <Plus size={16} />
                  New student
                </Link>
              </Button>
            ) : (
              <Button type="button" disabled>
                <Plus size={16} />
                New student
              </Button>
            )}
          </>
        }
      />

      <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
        <div className="border-b border-[var(--mws-line)] p-4">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <label className="relative block w-full min-w-0 xl:max-w-lg">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
              />
              <input
                type="search"
                placeholder="Search name, email, NIS, or NISN"
                value={params.search}
                onChange={(event) =>
                  resetPageAndUpdate({ search: event.target.value })
                }
                className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
              />
            </label>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusBadge tone={studentsQuery.isFetching ? 'amber' : 'green'}>
                {studentsQuery.isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
              <Button type="button" variant="secondary" size="sm" onClick={resetFilters}>
                <RotateCcw size={15} />
                Reset
              </Button>
            </div>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-7">
            <FilterSelect
              label="Status"
              value={params.status}
              onChange={(value) => resetPageAndUpdate({ status: value })}
            >
              <option value="">All statuses</option>
              {studentStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Grade"
              value={params.current_grade_id}
              onChange={(value) =>
                resetPageAndUpdate({ current_grade_id: value })
              }
              options={[
                { value: '', label: 'All grades' },
                ...gradeOptions(optionsQuery.data?.grades || []),
              ]}
            />

            <FilterSelect
              label="Class"
              value={params.current_class_id}
              onChange={(value) =>
                resetPageAndUpdate({ current_class_id: value })
              }
              options={[
                { value: '', label: 'All classes' },
                ...classOptions(optionsQuery.data?.classes || []),
              ]}
            />

            <FilterSelect
              label="Join Year"
              value={params.join_academic_year_id}
              onChange={(value) =>
                resetPageAndUpdate({ join_academic_year_id: value })
              }
              options={[
                { value: '', label: 'All join years' },
                ...academicYearOptions(optionsQuery.data?.academicYears || []),
              ]}
            />

            <FilterSelect
              label="Records"
              value={params.is_deleted}
              onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
            >
              <option value="">Active records</option>
              <option value="true">Trash bin</option>
            </FilterSelect>
          </div>
        </div>

        <StudentsTable
          students={studentsQuery.data?.data || []}
          yearsById={yearsById}
          sortBy={params.sort_by}
          sortOrder={params.sort_order}
          onSort={handleSort}
          isLoading={studentsQuery.isLoading}
          isTrash={isTrash}
          canRestore={canRestore}
          restoringId={restoreMutation.variables}
          onRestore={handleRestore}
        />

        <PaginationBar
          paging={paging}
          itemLabel="students"
          isLoading={studentsQuery.isLoading}
          onPrevious={() => updateParams({ page: params.page - 1 })}
          onNext={() => updateParams({ page: params.page + 1 })}
          onPageSizeChange={(size) => updateParams({ page: 1, size })}
        />
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, children }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
        {label}
      </span>
      {options ? (
        <SearchableSelect
          value={value}
          onChange={onChange}
          options={options}
          placeholder={options[0]?.label || 'Select'}
          searchPlaceholder={`Search ${label.toLowerCase()}`}
        />
      ) : (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
      >
        {children}
      </select>
      )}
    </div>
  )
}

function gradeOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ''}`,
  }))
}

function classOptions(classes) {
  return classes.map((schoolClass) => ({
    value: schoolClass.id,
    label: schoolClass.name,
    description: [
      schoolClass.grade?.name,
      schoolClass.academic_year?.name,
    ].filter(Boolean).join(' / '),
    searchText: `${schoolClass.name} ${schoolClass.grade?.name || ''} ${schoolClass.academic_year?.name || ''}`,
  }))
}

function academicYearOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    badge: formatStatus(year.status),
    tone: year.status === 'ACTIVE' ? 'green' : year.status === 'UPCOMING' ? 'amber' : 'neutral',
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }))
}
