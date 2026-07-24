import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi, studentStatuses } from '../api/studentsApi.js'
import { StudentsTable } from '../components/StudentsTable.jsx'
import { useStudentsSearchParams } from '../hooks/useStudentsSearchParams.js'

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

  const handleRestore = useCallback((studentId) => {
    restoreMutation.mutate(studentId)
  }, [restoreMutation])

  function handleSort(column, nextOrder) {
    resetPageAndUpdate({ sort_by: column, sort_order: nextOrder })
  }

  return (
    <div>
      <PageHeader
        title="Students"
        description="Maintain active, transferred, graduated, and archived student records."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/students/new">
                <Plus size={16} />
                New Student
              </Link>
            </Button>
          ) : (
            <Button type="button" disabled>
              <Plus size={16} />
              New Student
            </Button>
          )
        }
      />

      <div className="rounded-md border border-[#deded7] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#e7e4dc] p-4 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full max-w-md">
            <Search
              size={17}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7f83]"
            />
            <input
              type="search"
              placeholder="Search students"
              value={params.search}
              onChange={(event) =>
                resetPageAndUpdate({ search: event.target.value })
              }
              className="h-10 w-full rounded-md border border-[#d8d6cf] bg-white pl-10 pr-3 text-sm outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={params.status}
              onChange={(event) =>
                resetPageAndUpdate({ status: event.target.value })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">All statuses</option>
              {studentStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={params.current_grade_id}
              onChange={(event) =>
                resetPageAndUpdate({ current_grade_id: event.target.value })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">All grades</option>
              {(optionsQuery.data?.grades || []).map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </select>
            <select
              value={params.join_academic_year_id}
              onChange={(event) =>
                resetPageAndUpdate({
                  join_academic_year_id: event.target.value,
                })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">All join years</option>
              {(optionsQuery.data?.academicYears || []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
            <select
              value={params.is_deleted}
              onChange={(event) =>
                resetPageAndUpdate({ is_deleted: event.target.value })
              }
              className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
            >
              <option value="">Active records</option>
              <option value="true">Trash bin</option>
            </select>
            <StatusBadge tone={studentsQuery.isFetching ? 'amber' : 'green'}>
              {studentsQuery.isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>

        {studentsQuery.isError ? (
          <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
            {studentsQuery.error.message || 'Failed to load students.'}
          </div>
        ) : null}
        {restoreMutation.isError ? (
          <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
            {restoreMutation.error.message || 'Failed to restore student.'}
          </div>
        ) : null}

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
        />
      </div>
    </div>
  )
}
