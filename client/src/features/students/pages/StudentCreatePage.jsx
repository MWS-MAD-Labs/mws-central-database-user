import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import { StudentForm } from '../components/StudentForm.jsx'

export function StudentCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: studentsApi.create,
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      navigate(`/students/${student.id}`)
    },
  })

  return (
    <div>
      <PageHeader
        title="New Student"
        description="Create the student identity and baseline academic record."
        actions={
          <Button asChild variant="secondary">
            <Link to="/students">
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />

      {optionsQuery.isLoading ? (
        <PanelMessage>Loading student form options...</PanelMessage>
      ) : optionsQuery.isError ? (
        <PanelMessage tone="error">
          {optionsQuery.error.message || 'Failed to load form options.'}
        </PanelMessage>
      ) : (
        <StudentForm
          mode="create"
          options={optionsQuery.data}
          error={createMutation.error}
          isSubmitting={createMutation.isPending}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
