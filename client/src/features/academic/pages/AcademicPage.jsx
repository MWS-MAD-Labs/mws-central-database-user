import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDays,
  Edit,
  GraduationCap,
  Layers3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  SelectInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PaginationBar } from '../../../components/ui/PaginationBar.jsx'
import { SortableHeader } from '../../../components/ui/SortableHeader.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { employeesApi } from '../../employees/api/employeesApi.js'
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
import { cn } from '../../../lib/cn.js'

const tabs = [
  { id: 'years', label: 'Academic Years', icon: CalendarDays },
  { id: 'grades', label: 'Grades', icon: Layers3 },
  { id: 'classes', label: 'Classes', icon: BookOpen },
  { id: 'enrollments', label: 'Enrollments', icon: UsersRound },
]

export function AcademicPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = tabs.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'years'

  function setActiveTab(tabId) {
    setSearchParams({ tab: tabId })
  }

  return (
    <div>
      <PageHeader
        title="Academic"
        description="Manage school years, grade levels, classes, homerooms, and student class history."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium',
                activeTab === tab.id
                  ? 'border-[#24463f] bg-[#e8f1ed] text-[#24463f]'
                  : 'border-[#d8d6cf] bg-white text-[#4b5055] hover:bg-[#f1f1ec]',
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          )
        })}
      </div>

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
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
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
                <tr key={year.id} className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]">
                  <td className="px-4 py-3 font-semibold text-[#202326]">{year.name}</td>
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
      />

      {dialog ? (
        <AcademicYearDialog
          dialog={dialog}
          error={createMutation.error || updateMutation.error}
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
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
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
                <tr key={grade.id} className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]">
                  <td className="px-4 py-3 font-semibold text-[#202326]">{grade.name}</td>
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
      />

      {dialog ? (
        <GradeDialog
          dialog={dialog}
          error={createMutation.error || updateMutation.error}
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

  const classesQuery = useQuery({
    queryKey: ['classes', params],
    queryFn: () => classesApi.list(params),
  })
  const optionsQuery = useClassOptionsQuery()

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
          >
            <option value="">All years</option>
            {(optionsQuery.data?.academicYears || []).map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
          >
            <option value="">All grades</option>
            {(optionsQuery.data?.grades || []).map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </SelectFilter>
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
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
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
                <tr key={klass.id} className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]">
                  <td className="px-4 py-3 font-semibold text-[#202326]">{klass.name}</td>
                  <td className="px-4 py-3">{klass.grade.name}</td>
                  <td className="px-4 py-3">{klass.academic_year.name}</td>
                  <td className="px-4 py-3">{teacherById[klass.homeroom_teacher_id] || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(klass.status)}>
                      {formatStatus(klass.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">{klass.capacity || '-'}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: 'edit', record: klass })}
                      onDelete={() => handleDelete(klass)}
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
      />

      {dialog ? (
        <ClassDialog
          dialog={dialog}
          options={optionsQuery.data}
          error={createMutation.error || updateMutation.error}
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
          >
            <option value="">All years</option>
            {(optionsQuery.data?.academicYears || []).map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter
            value={params.class_id}
            onChange={(value) => resetPageAndUpdate({ class_id: value })}
          >
            <option value="">All classes</option>
            {(optionsQuery.data?.classes || []).map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </SelectFilter>
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
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
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
                <tr key={enrollment.id} className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#202326]">
                      {enrollment.student.full_name}
                    </p>
                    <p className="text-xs text-[#676c70]">{enrollment.student.nis}</p>
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

function AcademicYearDialog({ dialog, error, isSubmitting, onClose, onSubmit }) {
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
      <InlineError error={error} />
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

function GradeDialog({ dialog, error, isSubmitting, onClose, onSubmit }) {
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
      <InlineError error={error} />
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

function ClassDialog({ dialog, options, error, isSubmitting, onClose, onSubmit }) {
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
      <InlineError error={error} />
      <form id="class-form" onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Name" className="md:col-span-2">
          <TextInput
            required
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </Field>
        <Field label="Grade">
          <SelectInput
            required
            value={values.grade_id}
            onChange={(event) => setValues({ ...values, grade_id: event.target.value })}
          >
            <option value="">Select grade</option>
            {(options?.grades || []).map((grade) => (
              <option key={grade.id} value={grade.id}>
                {grade.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Academic year">
          <SelectInput
            required
            value={values.academic_year_id}
            onChange={(event) =>
              setValues({ ...values, academic_year_id: event.target.value })
            }
          >
            <option value="">Select year</option>
            {(options?.academicYears || []).map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Homeroom teacher">
          <SelectInput
            value={values.homeroom_teacher_id}
            onChange={(event) =>
              setValues({ ...values, homeroom_teacher_id: event.target.value })
            }
          >
            <option value="">No teacher</option>
            {dialog.mode === 'edit' ? <option value="__clear__">Clear teacher</option> : null}
            {(options?.employees || []).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.identity.full_name}
              </option>
            ))}
          </SelectInput>
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
            <SelectInput
              required
              value={values.student_id}
              onChange={(event) => setValues({ ...values, student_id: event.target.value })}
            >
              <option value="">Select student</option>
              {(options?.students || []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.identity.full_name} ({student.academic.nis},{' '}
                  {formatStatus(student.status)})
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}

        {dialog.mode !== 'close' ? (
          <Field label="Class" className="md:col-span-2">
            <SelectInput
              required
              value={values.class_id}
              onChange={(event) => setValues({ ...values, class_id: event.target.value })}
            >
              <option value="">Select class</option>
              {(options?.classes || []).map((klass) => (
                <option key={klass.id} value={klass.id}>
                  {klass.name} / {klass.grade.name} / {klass.academic_year.name}
                </option>
              ))}
            </SelectInput>
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
  error,
  children,
}) {
  return (
    <section className="rounded-md border border-[#deded7] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#e7e4dc] p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e8f1ed] text-[#24463f]">
            <Icon size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#202326]">{title}</h2>
            <StatusBadge tone={isFetching ? 'amber' : 'green'}>
              {isFetching ? 'Syncing' : 'Live'}
            </StatusBadge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      </div>
      {toolbar ? (
        <div className="flex flex-col gap-2 border-b border-[#e7e4dc] p-4 lg:flex-row lg:items-center">
          {toolbar}
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
          {error.message || 'Request failed.'}
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a7f83]"
      />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-[#d8d6cf] bg-white pl-10 pr-3 text-sm outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
      />
    </label>
  )
}

function SelectFilter({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-md border border-[#d8d6cf] bg-white px-3 text-sm text-[#34383c] outline-none focus:border-[#48635d] focus:ring-2 focus:ring-[#d7e7df]"
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

function RowActions({ disabled, onEdit, onDelete }) {
  return (
    <div className="flex justify-end gap-1">
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
        <td className="px-4 py-10 text-center text-[#77736a]" colSpan={colSpan}>
          Loading {label}...
        </td>
      </tr>
    )
  }

  if (isEmpty) {
    return (
      <tr>
        <td className="px-4 py-10 text-center text-[#77736a]" colSpan={colSpan}>
          No {label} found.
        </td>
      </tr>
    )
  }

  return null
}

function InlineError({ error }) {
  if (!error) return null
  return (
    <div className="mb-4 rounded-md border border-[#e8c7c2] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
      {error.message || 'Request failed.'}
    </div>
  )
}

function useClassOptionsQuery() {
  return useQuery({
    queryKey: ['class-form-options'],
    queryFn: async () => {
      const [grades, academicYears, employees] = await Promise.all([
        gradesApi.list({ page: 1, size: 100, sort_by: 'level', sort_order: 'asc' }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: 'start_date',
          sort_order: 'desc',
        }),
        employeesApi.list({ page: 1, size: 100, status: 'ACTIVE' }),
      ])

      return {
        grades: grades.data || [],
        academicYears: academicYears.data || [],
        employees: employees.data || [],
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
