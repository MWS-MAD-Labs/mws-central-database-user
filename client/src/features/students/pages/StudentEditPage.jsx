import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { studentSensitiveApi } from '../api/studentSensitiveApi.js'
import { StudentForm } from '../components/StudentForm.jsx'

export function StudentEditPage() {
  const { studentId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const canViewSensitive =
    user?.role === 'SUPER_ADMIN' || Boolean(user?.can_view_sensitive_data)

  const studentQuery = useQuery({
    queryKey: ['students', studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  })

  // Birth details are not part of the detail response. Opening the edit form
  // is the access, so it is released (and logged) here before the form fills.
  const piiQuery = useQuery({
    queryKey: ['students', studentId, 'pii'],
    queryFn: () => studentSensitiveApi.recordPiiAccess(studentId),
    enabled: Boolean(studentId) && canViewSensitive,
    staleTime: 0,
    gcTime: 0,
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

  const isLoading =
    studentQuery.isLoading ||
    optionsQuery.isLoading ||
    (canViewSensitive && piiQuery.isLoading)
  const error = studentQuery.error || optionsQuery.error || piiQuery.error
  const student = studentQuery.data
    ? {
        ...studentQuery.data,
        identity: { ...studentQuery.data.identity, ...(piiQuery.data || {}) },
      }
    : undefined

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
          student={student}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
