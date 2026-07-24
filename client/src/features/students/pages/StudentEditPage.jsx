import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import { StudentForm } from '../components/StudentForm.jsx'

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

  const isLoading = studentQuery.isLoading || optionsQuery.isLoading
  const error = studentQuery.error || optionsQuery.error

  return (
    <div>
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
        <PanelMessage tone="error">
          {error.message || 'Failed to load student.'}
        </PanelMessage>
      ) : (
        <StudentForm
          mode="edit"
          student={studentQuery.data}
          options={optionsQuery.data}
          error={updateMutation.error}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
