import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { showErrorToast } from '../../../lib/toast.js'
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
    mutationFn: async ({ payload, photoBlob }) => {
      const student = await studentsApi.create(payload)
      if (photoBlob) {
        // Photo failure shouldn't block landing on the new student record -
        // the student was already created successfully at this point.
        try {
          await studentsApi.uploadPhoto(student.id, photoBlob)
        } catch (error) {
          showErrorToast(error, 'Student was created, but the photo upload failed.')
        }
      }
      return student
    },
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      navigate(`/students/${student.id}`)
    },
    onError: (error) => {
      showErrorToast(error, 'Failed to create student.')
    },
  })

  return (
    <div className="min-w-0">
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
        <PanelMessage>Student form options are unavailable.</PanelMessage>
      ) : (
        <StudentForm
          mode="create"
          options={optionsQuery.data}
          isSubmitting={createMutation.isPending}
          onSubmit={(payload, photoBlob) => createMutation.mutate({ payload, photoBlob })}
        />
      )}
    </div>
  )
}
