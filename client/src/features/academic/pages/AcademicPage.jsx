import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDays,
  Edit,
  GraduationCap,
  History,
  Layers3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SearchableSelect,
  SelectInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
import { jobLevelsApi } from '../../master-data/api/masterDataApi.js'
import { studentsApi } from '../../students/api/studentsApi.js'
import {
  academicYearStatuses,
  academicYearsApi,
  classesApi,
  classStatuses,
  enrollmentCloseStatuses,
  enrollmentStatuses,
  enrollmentsApi,
  gradesApi,
} from '../api/academicApi.js'
import {
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  optionalNumber,
  trimmedOrUndefined,
} from '../../../lib/form.js'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'

const tabs = [
  'years',
  'grades',
  'classes',
  'enrollments',
]

export function AcademicPage() {
  const [searchParams] = useSearchParams()
  const activeTab = tabs.includes(searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'years'

  return (
    <div>
      <PageHeader
        title="Academic"
        description="Manage school years, grade levels, classes, homerooms, and student class history."
      />

      {activeTab === 'years' ? <AcademicYearsPanel /> : null}
      {activeTab === 'grades' ? <GradesPanel /> : null}
      {activeTab === 'classes' ? <ClassesPanel /> : null}
      {activeTab === 'enrollments' ? <EnrollmentsPanel /> : null}
    </div>
  )
}

function AcademicYearsPanel() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: '',
    status: '',
    sort_by: 'start_date',
    sort_order: 'desc',
  })
  const [dialog, setDialog] = useState(null)

  const yearsQuery = useQuery({
    queryKey: ['academic-years', params],
    queryFn: () => academicYearsApi.list(params),
  })

  const createMutation = useMutation({
    mutationFn: academicYearsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
      setDialog(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => academicYearsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
      setDialog(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: academicYearsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academic-years'] })
    },
  })

  const canWrite = user?.role === 'SUPER_ADMIN'
  const paging = yearsQuery.data?.paging || defaultPaging(params)

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  function handleDelete(year) {
    if (window.confirm(`Delete academic year "${year.name}"?`)) {
      deleteMutation.mutate(year.id)
    }
  }

  return (
    <PanelFrame
      title="Academic Years"
      icon={CalendarDays}
      isFetching={yearsQuery.isFetching}
      action={
        <Button type="button" disabled={!canWrite} onClick={() => setDialog({ mode: 'create' })}>
          <Plus size={16} />
          New Year
        </Button>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search years"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {academicYearStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
        </>
      }
      error={yearsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell label="Name" column="name" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="Start" column="start_date" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="End" column="end_date" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="Status" column="status" params={params} onSort={resetPageAndUpdate} />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={yearsQuery.isLoading}
            isEmpty={(yearsQuery.data?.data || []).length === 0}
            colSpan={5}
            label="academic years"
          />
          {!yearsQuery.isLoading
            ? (yearsQuery.data?.data || []).map((year) => (
                <tr key={year.id} className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]">
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">{year.name}</td>
                  <td className="px-4 py-3">{formatDate(year.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(year.end_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(year.status)}>
                      {formatStatus(year.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: 'edit', record: year })}
                      onDelete={() => handleDelete(year)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="years"
        isLoading={yearsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <AcademicYearDialog
          dialog={dialog}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            else updateMutation.mutate({ id: dialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function GradesPanel() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: '',
    sort_by: 'level',
    sort_order: 'asc',
  })
  const [dialog, setDialog] = useState(null)

  const gradesQuery = useQuery({
    queryKey: ['grades', params],
    queryFn: () => gradesApi.list(params),
  })

  const createMutation = useMutation({
    mutationFn: gradesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
      setDialog(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => gradesApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
      setDialog(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: gradesApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grades'] })
      queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
    },
  })

  const canWrite = user?.role === 'SUPER_ADMIN'
  const paging = gradesQuery.data?.paging || defaultPaging(params)

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  function handleDelete(grade) {
    if (window.confirm(`Delete grade "${grade.name}"?`)) {
      deleteMutation.mutate(grade.id)
    }
  }

  return (
    <PanelFrame
      title="Grades"
      icon={Layers3}
      isFetching={gradesQuery.isFetching}
      action={
        <Button type="button" disabled={!canWrite} onClick={() => setDialog({ mode: 'create' })}>
          <Plus size={16} />
          New Grade
        </Button>
      }
      toolbar={
        <SearchBox
          value={params.search}
          placeholder="Search grades"
          onChange={(value) => resetPageAndUpdate({ search: value })}
        />
      }
      error={gradesQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell label="Name" column="name" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="Level" column="level" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="Created" column="created_at" params={params} onSort={resetPageAndUpdate} />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={gradesQuery.isLoading}
            isEmpty={(gradesQuery.data?.data || []).length === 0}
            colSpan={4}
            label="grades"
          />
          {!gradesQuery.isLoading
            ? (gradesQuery.data?.data || []).map((grade) => (
                <tr key={grade.id} className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]">
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">{grade.name}</td>
                  <td className="px-4 py-3">{grade.level}</td>
                  <td className="px-4 py-3">{formatDate(grade.created_at)}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: 'edit', record: grade })}
                      onDelete={() => handleDelete(grade)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="grades"
        isLoading={gradesQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <GradeDialog
          dialog={dialog}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            else updateMutation.mutate({ id: dialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function ClassesPanel() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: '',
    grade_id: '',
    academic_year_id: '',
    status: '',
    sort_by: 'created_at',
    sort_order: 'desc',
  })
  const [dialog, setDialog] = useState(null)
  const [historyClass, setHistoryClass] = useState(null)

  const classesQuery = useQuery({
    queryKey: ['classes', params],
    queryFn: () => classesApi.list(params),
  })
  const optionsQuery = useClassOptionsQuery()
  const homeroomHistoryQuery = useQuery({
    queryKey: ['classes', historyClass?.id, 'homeroom-history'],
    queryFn: () => classesApi.homeroomHistory(historyClass.id),
    enabled: Boolean(historyClass?.id),
  })

  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: () => {
      invalidateClassData(queryClient)
      setDialog(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => classesApi.update(id, payload),
    onSuccess: () => {
      invalidateClassData(queryClient)
      setDialog(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  })

  const canWrite = user?.role === 'SUPER_ADMIN'
  const paging = classesQuery.data?.paging || defaultPaging(params)
  const teacherById = useMemo(() => {
    return Object.fromEntries(
      (optionsQuery.data?.employees || []).map((employee) => [
        employee.id,
        employee.identity.full_name,
      ]),
    )
  }, [optionsQuery.data?.employees])

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  function handleDelete(klass) {
    if (window.confirm(`Delete class "${klass.name}"?`)) {
      deleteMutation.mutate(klass.id)
    }
  }

  return (
    <PanelFrame
      title="Classes"
      icon={BookOpen}
      isFetching={classesQuery.isFetching || optionsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite || optionsQuery.isLoading}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={16} />
          New Class
        </Button>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search classes"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SelectFilter
            value={params.academic_year_id}
            onChange={(value) => resetPageAndUpdate({ academic_year_id: value })}
            options={[
              { value: '', label: 'All years' },
              ...academicYearSelectOptions(optionsQuery.data?.academicYears || []),
            ]}
            placeholder="All years"
          />
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: '', label: 'All grades' },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
            placeholder="All grades"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
        </>
      }
      error={classesQuery.error || optionsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell label="Name" column="name" params={params} onSort={resetPageAndUpdate} />
            <HeaderCell label="Grade" column="grade_level" params={params} onSort={resetPageAndUpdate} />
            <th className="px-4 py-3">Academic Year</th>
            <th className="px-4 py-3">Homeroom</th>
            <HeaderCell label="Status" column="status" params={params} onSort={resetPageAndUpdate} />
            <th className="px-4 py-3">Capacity</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={classesQuery.isLoading}
            isEmpty={(classesQuery.data?.data || []).length === 0}
            colSpan={7}
            label="classes"
          />
          {!classesQuery.isLoading
            ? (classesQuery.data?.data || []).map((klass) => (
                <tr key={klass.id} className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]">
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">{klass.name}</td>
                  <td className="px-4 py-3">{klass.grade.name}</td>
	                  <td className="px-4 py-3">{klass.academic_year.name}</td>
	                  <td className="px-4 py-3">{teacherById[klass.homeroom_teacher_id] || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(klass.status)}>
                      {formatStatus(klass.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    {klass.capacity ? (
                      <div>
                        <p className="font-semibold text-[var(--mws-charcoal)]">
                          {klass.active_enrollment_count ?? 0}/{klass.capacity} students
                        </p>
                        <p className="text-xs text-[var(--mws-muted)]">
                          {Math.max(klass.capacity - (klass.active_enrollment_count ?? 0), 0)} seats left
                        </p>
                      </div>
                    ) : (
                      '-'
                    )}
	                  </td>
	                  <td className="px-4 py-3">
	                    <RowActions
	                      disabled={!canWrite}
	                      onEdit={() => setDialog({ mode: 'edit', record: klass })}
	                      onDelete={() => handleDelete(klass)}
	                      onHistory={() => setHistoryClass(klass)}
	                    />
	                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="classes"
        isLoading={classesQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

        {dialog ? (
          <ClassDialog
            dialog={dialog}
            options={optionsQuery.data}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
              if (dialog.mode === 'create') createMutation.mutate(payload)
              else updateMutation.mutate({ id: dialog.record.id, payload })
            }}
          />
        ) : null}
        {historyClass ? (
          <HomeroomHistoryDialog
            klass={historyClass}
            history={homeroomHistoryQuery.data || []}
            isLoading={homeroomHistoryQuery.isLoading}
            error={homeroomHistoryQuery.error}
            onClose={() => setHistoryClass(null)}
          />
        ) : null}
      </PanelFrame>
    )
  }

function EnrollmentsPanel() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    student_id: '',
    class_id: '',
    academic_year_id: '',
    status: '',
    is_deleted: '',
    sort_by: 'created_at',
    sort_order: 'desc',
  })
  const [dialog, setDialog] = useState(null)

  const enrollmentsQuery = useQuery({
    queryKey: ['enrollments', params],
    queryFn: () => enrollmentsApi.list(params),
  })
  const optionsQuery = useEnrollmentOptionsQuery()

  const createMutation = useMutation({
    mutationFn: ({ studentId, payload }) =>
      enrollmentsApi.create(studentId, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient)
      setDialog(null)
    },
  })

  const transferMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.transfer(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient)
      setDialog(null)
    },
  })

  const promoteMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.promote(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient)
      setDialog(null)
    },
  })

  const closeMutation = useMutation({
    mutationFn: ({ enrollment, payload }) =>
      enrollmentsApi.close(enrollment.student.id, enrollment.id, payload),
    onSuccess: () => {
      invalidateEnrollmentData(queryClient)
      setDialog(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (enrollment) =>
      enrollmentsApi.remove(enrollment.student.id, enrollment.id),
    onSuccess: () => invalidateEnrollmentData(queryClient),
  })

  const restoreMutation = useMutation({
    mutationFn: (enrollment) =>
      enrollmentsApi.restore(enrollment.student.id, enrollment.id),
    onSuccess: () => invalidateEnrollmentData(queryClient),
  })

  const canWrite = user?.type === 'admin' && user?.role !== 'VIEWER'
  const canDelete = user?.role === 'SUPER_ADMIN'
  const paging = enrollmentsQuery.data?.paging || defaultPaging(params)
  const isTrash = params.is_deleted === 'true'

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }))
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 })
  }

  function handleDelete(enrollment) {
    if (
      window.confirm(
        `Move ${enrollment.student.full_name}'s enrollment to trash?`,
      )
    ) {
      deleteMutation.mutate(enrollment)
    }
  }

  return (
    <PanelFrame
      title="Enrollments"
      icon={GraduationCap}
      isFetching={enrollmentsQuery.isFetching || optionsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite || optionsQuery.isLoading}
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Plus size={16} />
          New Enrollment
        </Button>
      }
      toolbar={
        <>
          <SelectFilter
            value={params.academic_year_id}
            onChange={(value) => resetPageAndUpdate({ academic_year_id: value })}
            options={[
              { value: '', label: 'All years' },
              ...academicYearSelectOptions(optionsQuery.data?.academicYears || []),
            ]}
            placeholder="All years"
          />
          <SelectFilter
            value={params.class_id}
            onChange={(value) => resetPageAndUpdate({ class_id: value })}
            options={[
              { value: '', label: 'All classes' },
              ...classSelectOptions(optionsQuery.data?.classes || []),
            ]}
            placeholder="All classes"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {enrollmentStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            value={params.is_deleted}
            onChange={(value) => resetPageAndUpdate({ is_deleted: value })}
          >
            <option value="">Active records</option>
            <option value="true">Trash bin</option>
          </SelectFilter>
        </>
      }
      error={
        enrollmentsQuery.error ||
        optionsQuery.error ||
        createMutation.error ||
        transferMutation.error ||
        promoteMutation.error ||
        closeMutation.error ||
        deleteMutation.error ||
        restoreMutation.error
      }
    >
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <th className="px-4 py-3">Student</th>
            <th className="px-4 py-3">Class</th>
            <th className="px-4 py-3">Academic Year</th>
            <th className="px-4 py-3">Grade Snapshot</th>
            <HeaderCell label="Start" column="start_date" params={params} onSort={resetPageAndUpdate} />
            <th className="px-4 py-3">End</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={enrollmentsQuery.isLoading}
            isEmpty={(enrollmentsQuery.data?.data || []).length === 0}
            colSpan={8}
            label="enrollments"
          />
          {!enrollmentsQuery.isLoading
            ? (enrollmentsQuery.data?.data || []).map((enrollment) => (
                <tr key={enrollment.id} className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--mws-charcoal)]">
                      {enrollment.student.full_name}
                    </p>
                    <p className="text-xs text-[var(--mws-muted)]">{enrollment.student.nis}</p>
                  </td>
                  <td className="px-4 py-3">{enrollment.class.name}</td>
                  <td className="px-4 py-3">{enrollment.academic_year.name}</td>
                  <td className="px-4 py-3">{enrollment.grade_level}</td>
                  <td className="px-4 py-3">{formatDate(enrollment.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(enrollment.end_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(enrollment.enrollment_status)}>
                      {formatStatus(enrollment.enrollment_status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <EnrollmentRowActions
                      enrollment={enrollment}
                      isTrash={isTrash}
                      canWrite={canWrite}
                      canDelete={canDelete}
                      restoringId={restoreMutation.variables?.id}
                      onTransfer={() => setDialog({ mode: 'transfer', record: enrollment })}
                      onPromote={() => setDialog({ mode: 'promote', record: enrollment })}
                      onClose={() => setDialog({ mode: 'close', record: enrollment })}
                      onDelete={() => handleDelete(enrollment)}
                      onRestore={() => restoreMutation.mutate(enrollment)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="enrollments"
        isLoading={enrollmentsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <EnrollmentDialog
          dialog={dialog}
          options={optionsQuery.data}
          isSubmitting={
            createMutation.isPending ||
            transferMutation.isPending ||
            promoteMutation.isPending ||
            closeMutation.isPending
          }
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            if (dialog.mode === 'transfer') {
              transferMutation.mutate({ enrollment: dialog.record, payload })
            }
            if (dialog.mode === 'promote') {
              promoteMutation.mutate({ enrollment: dialog.record, payload })
            }
            if (dialog.mode === 'close') {
              closeMutation.mutate({ enrollment: dialog.record, payload })
            }
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function AcademicYearDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || '',
    start_date: dateInputFromIso(dialog.record?.start_date),
    end_date: dateInputFromIso(dialog.record?.end_date),
    status: dialog.record?.status || 'UPCOMING',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        start_date: isoFromDateInput(values.start_date),
        end_date: isoFromDateInput(values.end_date),
        status: values.status,
      }),
    )
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Academic Year' : 'Edit Academic Year'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="academic-year-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="academic-year-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">
          <TextInput
            required
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field label="Start date">
          <TextInput
            type="date"
            value={values.start_date}
            onChange={(event) => setValues({ ...values, start_date: event.target.value })}
          />
        </Field>
        <Field label="End date">
          <TextInput
            type="date"
            value={values.end_date}
            onChange={(event) => setValues({ ...values, end_date: event.target.value })}
          />
        </Field>
        <Field label="Status" className="md:col-span-2">
          <SelectInput
            value={values.status}
            onChange={(event) => setValues({ ...values, status: event.target.value })}
          >
            {academicYearStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </CrudDialog>
  )
}

function GradeDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    name: dialog.record?.name || '',
    level: dialog.record?.level ?? '',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        level: optionalNumber(values.level),
      }),
    )
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Grade' : 'Edit Grade'}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="grade-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="grade-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <TextInput
            required
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field label="Level">
          <TextInput
            required
            type="number"
            value={values.level}
            onChange={(event) => setValues({ ...values, level: event.target.value })}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function ClassDialog({ dialog, options, isSubmitting, onClose, onSubmit }) {
  const record = dialog.record
  const [values, setValues] = useState(() => ({
    name: record?.name || '',
    grade_id: record?.grade?.id || '',
    academic_year_id: record?.academic_year?.id || '',
    homeroom_teacher_id: record?.homeroom_teacher_id || '',
    status: record?.status || 'ACTIVE',
    capacity: record?.capacity ?? '',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        grade_id: values.grade_id,
        academic_year_id: values.academic_year_id,
        homeroom_teacher_id:
          values.homeroom_teacher_id === '__clear__'
            ? null
            : values.homeroom_teacher_id,
        status: values.status,
        capacity:
          values.capacity === '__clear__' ? null : optionalNumber(values.capacity),
      }),
    )
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Class' : 'Edit Class'}
      description="Homeroom teacher must be active and have a teaching job level."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="class-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="class-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">
          <TextInput
            required
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field label="Grade">
          <SearchableSelect
            required
            value={values.grade_id}
            onChange={(value) => setValues({ ...values, grade_id: value })}
            options={gradeSelectOptions(options?.grades || [])}
            placeholder="Select grade"
            searchPlaceholder="Search grades"
          />
        </Field>
        <Field label="Academic year">
          <SearchableSelect
            required
            value={values.academic_year_id}
            onChange={(value) => setValues({ ...values, academic_year_id: value })}
            options={academicYearSelectOptions(options?.academicYears || [])}
            placeholder="Select year"
            searchPlaceholder="Search years"
          />
        </Field>
        <Field label="Homeroom teacher">
          <SearchableSelect
            value={values.homeroom_teacher_id}
            onChange={(value) => setValues({ ...values, homeroom_teacher_id: value })}
            options={[
              { value: '', label: 'No teacher' },
              ...(dialog.mode === 'edit' ? [{ value: '__clear__', label: 'Clear teacher' }] : []),
              ...employeeSelectOptions(options?.teachingEmployees || []),
            ]}
            placeholder="No teacher"
            searchPlaceholder="Search teachers"
            emptyLabel="No active teaching employees found"
          />
        </Field>
        <Field label="Status">
          <SelectInput
            value={values.status}
            onChange={(event) => setValues({ ...values, status: event.target.value })}
          >
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Capacity">
          <TextInput
            type="number"
            min="1"
            value={values.capacity}
            onChange={(event) => setValues({ ...values, capacity: event.target.value })}
          />
        </Field>
      </form>
    </CrudDialog>
  )
}

function EnrollmentDialog({ dialog, options, isSubmitting, onClose, onSubmit }) {
  const record = dialog.record
  const [values, setValues] = useState(() => ({
    student_id: record?.student?.id || '',
    class_id: record?.class?.id || '',
    start_date: '',
    effective_date: '',
    end_date: '',
    status: 'TRANSFERRED',
    force: false,
  }))

  const selectedClass = (options?.classes || []).find(
    (klass) => klass.id === values.class_id,
  )

  function submit(event) {
    event.preventDefault()
    if (dialog.mode === 'create') {
      onSubmit({
        studentId: values.student_id,
        payload: cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          start_date: isoFromDateInput(values.start_date),
          force: values.force,
        }),
      })
      return
    }

    if (dialog.mode === 'transfer') {
      onSubmit(cleanPayload({ class_id: values.class_id, force: values.force }))
      return
    }

    if (dialog.mode === 'promote') {
      onSubmit(
        cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          grade_id: selectedClass?.grade?.id,
          effective_date: isoFromDateInput(values.effective_date),
          force: values.force,
        }),
      )
      return
    }

    onSubmit(
      cleanPayload({
        status: values.status,
        end_date: isoFromDateInput(values.end_date),
      }),
    )
  }

  return (
    <CrudDialog
      title={getEnrollmentDialogTitle(dialog.mode)}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="enrollment-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form id="enrollment-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        {dialog.mode === 'create' ? (
          <Field label="Student" className="md:col-span-2">
            <SearchableSelect
              required
              value={values.student_id}
              onChange={(value) => setValues({ ...values, student_id: value })}
              options={studentSelectOptions(options?.students || [])}
              placeholder="Select student"
              searchPlaceholder="Search name or NIS"
            />
          </Field>
        ) : null}

        {dialog.mode !== 'close' ? (
          <Field label="Class" className="md:col-span-2">
            <SearchableSelect
              required
              value={values.class_id}
              onChange={(value) => setValues({ ...values, class_id: value })}
              options={classSelectOptions(options?.classes || [])}
              placeholder="Select class"
              searchPlaceholder="Search classes"
            />
          </Field>
        ) : null}

        {dialog.mode === 'create' ? (
          <Field label="Start date">
            <TextInput
              type="date"
              value={values.start_date}
              onChange={(event) => setValues({ ...values, start_date: event.target.value })}
            />
          </Field>
        ) : null}

        {dialog.mode === 'promote' ? (
          <Field label="Effective date">
            <TextInput
              type="date"
              value={values.effective_date}
              onChange={(event) =>
                setValues({ ...values, effective_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === 'close' ? (
          <>
            <Field label="Close status">
              <SelectInput
                value={values.status}
                onChange={(event) => setValues({ ...values, status: event.target.value })}
              >
                {enrollmentCloseStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatus(status)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="End date">
              <TextInput
                type="date"
                value={values.end_date}
                onChange={(event) => setValues({ ...values, end_date: event.target.value })}
              />
            </Field>
          </>
        ) : null}

        {dialog.mode === 'create' ||
        dialog.mode === 'transfer' ||
        dialog.mode === 'promote' ? (
          <CheckboxField
            className="md:col-span-2"
            label="Force capacity override"
            description="Only Super Admin can override a full class."
            checked={values.force}
            onChange={(event) => setValues({ ...values, force: event.target.checked })}
          />
        ) : null}
      </form>
    </CrudDialog>
  )
}

function PanelFrame({
  title,
  icon: Icon,
  action,
  toolbar,
  isFetching,
  children,
}) {
  return (
    <section className="rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]">
      <div className="flex flex-col gap-3 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] text-[#8a6419]">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--mws-charcoal)]">{title}</h2>
            <StatusBadge tone={isFetching ? 'amber' : 'green'}>
              {isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      </div>
      {toolbar ? (
        <div className="flex flex-col gap-2 border-b border-[var(--mws-line)] p-4 lg:flex-row lg:items-center">
          {toolbar}
        </div>
      ) : null}
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function SearchBox({ value, placeholder, onChange }) {
  return (
    <label className="relative block w-full max-w-md">
      <Search
        size={17}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mws-muted)]"
      />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
      />
    </label>
  )
}

function SelectFilter({ value, onChange, options, placeholder, children }) {
  if (options) {
    return (
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        searchPlaceholder="Search"
        className="min-w-44"
      />
    )
  }

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 rounded-xl border border-[var(--mws-line)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
    >
      {children}
    </select>
  )
}

function HeaderCell({ label, column, params, onSort }) {
  return (
    <th className="px-4 py-3">
      <SortableHeader
        label={label}
        column={column}
        sortBy={params.sort_by}
        sortOrder={params.sort_order}
        onSort={(nextColumn, nextOrder) =>
          onSort({ sort_by: nextColumn, sort_order: nextOrder })
        }
      />
    </th>
  )
}

function RowActions({ disabled, onEdit, onDelete, onHistory }) {
  return (
    <div className="flex justify-end gap-1">
      {onHistory ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onHistory}
        >
          <History size={15} />
          Teacher History
        </Button>
      ) : null}
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

function HomeroomHistoryDialog({ klass, history, isLoading, error, onClose }) {
  return (
	    <CrudDialog
	      title="Homeroom Log"
      description={`${klass.name} / ${klass.academic_year.name}`}
      onClose={onClose}
      footer={
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      }
    >
      {isLoading ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
	          Loading homeroom log...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#f2c8cb] bg-[#fff6f7] px-4 py-3 text-sm font-semibold text-[#9f3d41]">
	          Homeroom log is unavailable.
        </div>
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          No homeroom assignment has been recorded for this class.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--mws-line)]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Employee ID</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
              </tr>
            </thead>
            <tbody>
              {history.map((assignment) => (
                <tr key={assignment.id} className="border-t border-[var(--mws-line)]">
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {assignment.employee.full_name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {assignment.employee.employee_id}
                  </td>
                  <td className="px-4 py-3">{formatDate(assignment.start_date)}</td>
                  <td className="px-4 py-3">
                    {assignment.end_date ? formatDate(assignment.end_date) : 'Current'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CrudDialog>
  )
}

function EnrollmentRowActions({
  enrollment,
  isTrash,
  canWrite,
  canDelete,
  restoringId,
  onTransfer,
  onPromote,
  onClose,
  onDelete,
  onRestore,
}) {
  if (isTrash) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canDelete || restoringId === enrollment.id}
        onClick={onRestore}
      >
        <RotateCcw size={15} />
        Restore
      </Button>
    )
  }

  const isActive = enrollment.enrollment_status === 'ACTIVE'

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onTransfer}
      >
        Transfer
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onPromote}
      >
        Promote
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canWrite || !isActive}
        onClick={onClose}
      >
        Close
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </Button>
    </div>
  )
}

function LoadingRows({ isLoading, isEmpty, colSpan, label }) {
  if (isLoading) {
    return (
      <tr>
        <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={colSpan}>
          Loading {label}...
        </td>
      </tr>
    )
  }

  if (isEmpty) {
    return (
      <tr>
        <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={colSpan}>
          No {label} found.
        </td>
      </tr>
    )
  }

  return null
}

function useClassOptionsQuery() {
  return useQuery({
    queryKey: ['class-form-options'],
    queryFn: async () => {
      const [grades, academicYears, employees, jobLevels] = await Promise.all([
        gradesApi.list({ page: 1, size: 100, sort_by: 'level', sort_order: 'asc' }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: 'start_date',
          sort_order: 'desc',
        }),
        employeesApi.list({ page: 1, size: 100, status: 'ACTIVE' }),
        jobLevelsApi.list({ page: 1, size: 100, sort_by: 'name', sort_order: 'asc' }),
      ])
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      )
      const activeEmployees = employees.data || []

      return {
        grades: grades.data || [],
        academicYears: academicYears.data || [],
        employees: activeEmployees,
        teachingEmployees: activeEmployees.filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
      }
    },
  })
}

function useEnrollmentOptionsQuery() {
  return useQuery({
    queryKey: ['enrollment-form-options'],
    queryFn: async () => {
      const [classes, students, academicYears] = await Promise.all([
        classesApi.list({ page: 1, size: 100, status: 'ACTIVE' }),
        studentsApi.list({ page: 1, size: 100 }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: 'start_date',
          sort_order: 'desc',
        }),
      ])

      return {
        classes: classes.data || [],
        students: students.data || [],
        academicYears: academicYears.data || [],
      }
    },
  })
}

function invalidateClassData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['classes'] })
  queryClient.invalidateQueries({ queryKey: ['class-form-options'] })
  queryClient.invalidateQueries({ queryKey: ['student-form-options'] })
  queryClient.invalidateQueries({ queryKey: ['enrollment-form-options'] })
}

function invalidateEnrollmentData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ['enrollments'] })
  queryClient.invalidateQueries({ queryKey: ['students'] })
  queryClient.invalidateQueries({ queryKey: ['enrollment-form-options'] })
}

function academicYearSelectOptions(years) {
  return years.map((year) => ({
    value: year.id,
    label: year.name,
    badge: formatStatus(year.status),
    tone: statusTone(year.status),
    searchText: `${year.name} ${formatStatus(year.status)}`,
  }))
}

function gradeSelectOptions(grades) {
  return grades.map((grade) => ({
    value: grade.id,
    label: grade.name,
    searchText: `${grade.name} ${grade.level ?? ''}`,
  }))
}

function employeeSelectOptions(employees) {
  return employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: employee.employment.job_level,
    searchText: `${employee.identity.full_name} ${employee.employment.job_level}`,
  }))
}

function studentSelectOptions(students) {
  return students.map((student) => ({
    value: student.id,
    label: student.identity.full_name,
    description: [
      student.academic.nis ? `NIS ${student.academic.nis}` : null,
      student.academic.current_grade ? `Grade ${student.academic.current_grade}` : null,
    ].filter(Boolean).join(' / '),
    badge: formatStatus(student.status),
    tone: statusTone(student.status),
    searchText: `${student.identity.full_name} ${student.academic.nis || ''} ${student.academic.current_grade || ''} ${student.status}`,
  }))
}

function classSelectOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass)
    return {
      value: klass.id,
      label: klass.name,
      description: [
        klass.grade?.name,
        klass.academic_year?.name,
        capacity.description,
      ].filter(Boolean).join(' / '),
      badge: capacity.badge,
      tone: capacity.tone,
      searchText: `${klass.name} ${klass.grade?.name || ''} ${klass.academic_year?.name || ''} ${capacity.description}`,
    }
  })
}

function getClassCapacityLabel(klass) {
  if (klass.capacity === null || klass.capacity === undefined) {
    return { description: 'No capacity limit', badge: null, tone: 'neutral' }
  }

  const activeCount = klass.active_enrollment_count ?? 0
  const remaining = Math.max(klass.capacity - activeCount, 0)
  if (remaining === 0) {
    return {
      description: `${activeCount}/${klass.capacity} students`,
      badge: 'Full',
      tone: 'red',
    }
  }

  return {
    description: `${activeCount}/${klass.capacity} students, ${remaining} seats left`,
    badge: `${remaining} seats`,
    tone: remaining <= 3 ? 'amber' : 'green',
  }
}

function defaultPaging(params) {
  return {
    current_page: params.page,
    total_page: 1,
    total_item: 0,
    size: params.size,
  }
}

function getEnrollmentDialogTitle(mode) {
  switch (mode) {
    case 'create':
      return 'New Enrollment'
    case 'transfer':
      return 'Transfer Class'
    case 'promote':
      return 'Promote Student'
    case 'close':
      return 'Close Enrollment'
    default:
      return 'Enrollment'
  }
}
