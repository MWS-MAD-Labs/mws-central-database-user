import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { googleAccountApi } from '../../google/api/googleAccountApi.js'
import { GoogleShareDialog } from '../../google/components/GoogleShareDialog.jsx'
import { clearCreateFormDraft } from '../../../lib/useCreateFormDraft.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import { StudentForm } from '../components/StudentForm.jsx'

export function StudentCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // The first sign-in details of the account made with the student, shown once.
  const [ready, setReady] = useState(null)

  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: async ({ payload, photoBlob }) => {
      const student = await studentsApi.create(payload)
      if (photoBlob) {
        try {
          await studentsApi.uploadPhoto(student.id, photoBlob)
        } catch (error) {
          showErrorToast(error, 'Student was created, but the photo upload failed.')
        }
      }
      // The details go to a parent or guardian Central holds, so the dialog needs to know who they are.
      let guardians = []
      if (student.google?.temporary_password) {
        try {
          guardians = (await googleAccountApi.status('students', student.id)).guardians ?? []
        } catch {
          guardians = []
        }
      }
      return { student, guardians }
    },
    onSuccess: ({ student, guardians }) => {
      clearCreateFormDraft('student')
      queryClient.invalidateQueries({ queryKey: ['students'] })
      const google = student.google
      if (google?.outcome === 'failed') {
        showErrorToast(
          new Error(google.message),
          'Student saved, but the Google account was not made. Try again from the Google account row.',
        )
      } else {
        showSuccessToast('Student created.')
      }
      if (google?.temporary_password) {
        setReady({ id: student.id, name: student.identity?.full_name, email: student.identity?.email, password: google.temporary_password, guardians })
        return
      }
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
          <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
            <Link to="/students"><ArrowLeft size={16} /></Link>
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
      {ready ? (
        <GoogleShareDialog
          resource="students"
          id={ready.id}
          name={ready.name}
          email={ready.email}
          password={ready.password}
          guardians={ready.guardians}
          onClose={() => navigate(`/students/${ready.id}`)}
        />
      ) : null}
    </div>
  )
}
