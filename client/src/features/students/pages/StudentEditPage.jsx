import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { formatStatus } from '../../../lib/format.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import { StudentForm } from '../components/StudentForm.jsx'

// Statuses that auto-close the student's active enrollment on save (mirrors
// TERMINAL_STUDENT_STATUS_TO_ENROLLMENT_STATUS in student-service.ts).
const TERMINAL_STATUSES = new Set(['GRADUATED', 'TRANSFERRED', 'WITHDRAWN'])

export function StudentEditPage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Set to the pending payload when a status change needs confirmation
  // before it's actually submitted - null means no dialog is open.
  const [pendingPayload, setPendingPayload] = useState(null)

  const studentQuery = useQuery({
    queryKey: ['students', studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  })

  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  const updateMutation = useMutation({
    mutationFn: (payload) => studentsApi.update(studentId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      navigate(`/students/${studentId}`)
    },
  })

  // Some status changes silently close/free up an enrollment - give the
  // admin a heads-up before it happens rather than after, since there's no
  // undo for the class-relation side effect itself (only for the status).
  const enrollmentImpact = describeEnrollmentImpact(
    pendingPayload,
    studentQuery.data,
  )

  function handleSubmit(payload) {
    if (describeEnrollmentImpact(payload, studentQuery.data)) {
      setPendingPayload(payload)
      return
    }
    updateMutation.mutate(payload)
  }

  function confirmPendingSubmit() {
    updateMutation.mutate(pendingPayload, {
      onSuccess: () => setPendingPayload(null),
    })
  }

  const isLoading = studentQuery.isLoading || optionsQuery.isLoading
  const error = studentQuery.error || optionsQuery.error

  return (
    <div className="min-w-0">
      <PageHeader
        title="Edit Student"
        description={
          studentQuery.data
            ? studentQuery.data.identity.full_name
            : 'Update student identity and academic data.'
        }
        actions={
          <Button asChild variant="secondary">
            <Link to={`/students/${studentId}`}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <PanelMessage>Loading student...</PanelMessage>
      ) : error ? (
        <PanelMessage>Student data is unavailable.</PanelMessage>
      ) : (
        <StudentForm
          mode="edit"
          student={studentQuery.data}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onSubmit={handleSubmit}
        />
      )}

      {pendingPayload && enrollmentImpact ? (
        <CrudDialog
          title="Confirm Status Change"
          onClose={() => setPendingPayload(null)}
          footer={
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={updateMutation.isPending}
                onClick={() => setPendingPayload(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={updateMutation.isPending}
                onClick={confirmPendingSubmit}
              >
                {updateMutation.isPending ? 'Saving...' : 'Confirm change'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 rounded-lg bg-[var(--mws-soft)] p-4 text-sm text-[var(--mws-charcoal)]">
            <p>{enrollmentImpact.description}</p>
            <p className="flex items-start gap-2 font-semibold text-red-600">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {enrollmentImpact.warning}
            </p>
          </div>
        </CrudDialog>
      ) : null}
    </div>
  )
}

// Returns { description, warning } when this status change needs a
// confirmation dialog, or null when it can just be saved directly.
function describeEnrollmentImpact(payload, student) {
  if (!student || !payload?.status || payload.status === student.status) {
    return null
  }

  const fullName = student.identity.full_name
  const currentClass = student.academic?.current_class

  if (TERMINAL_STATUSES.has(payload.status) && currentClass) {
    return {
      description: `${fullName} is currently enrolled in ${currentClass}.`,
      warning: `Setting their status to ${formatStatus(payload.status)} will close that enrollment and remove them from the class.`,
    }
  }

  if (student.status === 'GRADUATED' && payload.status !== 'GRADUATED') {
    const grade = student.academic?.graduation_grade
    const year = student.academic?.leave_year
    return {
      description: `${fullName} graduated from ${grade || 'their previous grade'}${year ? ` (${year})` : ''}.`,
      warning: `Moving them to ${formatStatus(payload.status)} will clear this graduation record and free up their enrollment for this academic year so they can be re-enrolled.`,
    }
  }

  return null
}
