import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
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
  function confirmEnrollmentImpact(payload) {
    const student = studentQuery.data
    if (!student || !payload.status || payload.status === student.status) {
      return true
    }

    const fullName = student.identity.full_name
    const currentClass = student.academic?.current_class

    if (TERMINAL_STATUSES.has(payload.status) && currentClass) {
      return window.confirm(
        `${fullName} is currently enrolled in ${currentClass}. Setting their status to ${formatStatus(payload.status)} will close that enrollment and remove them from the class. Continue?`,
      )
    }

    if (student.status === 'GRADUATED' && payload.status !== 'GRADUATED') {
      const grade = student.academic?.graduation_grade
      const year = student.academic?.leave_year
      return window.confirm(
        `${fullName} graduated from ${grade || 'their previous grade'}${year ? ` (${year})` : ''}. Moving them to ${formatStatus(payload.status)} will clear this graduation record and free up their enrollment for this academic year so they can be re-enrolled. Continue?`,
      )
    }

    return true
  }

  function handleSubmit(payload) {
    if (!confirmEnrollmentImpact(payload)) return
    updateMutation.mutate(payload)
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
    </div>
  )
}
