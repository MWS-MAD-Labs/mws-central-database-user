import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { GoogleInstructionsDialog } from '../../google/components/GoogleInstructionsDialog.jsx'
import { GoogleShareDialog } from '../../google/components/GoogleShareDialog.jsx'
import { maskEmail } from '../../google/utils/instructions.js'
import { clearCreateFormDraft } from '../../../lib/useCreateFormDraft.js'
import { employeesApi } from '../api/employeesApi.js'
import { loadEmployeeFormOptions } from '../api/employeeFormOptions.js'
import { EmployeeForm } from '../components/EmployeeForm.jsx'

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Set when a Google account was made, so the person can be told how to get in before the page moves on.
  const [ready, setReady] = useState(null)

  const optionsQuery = useQuery({
    queryKey: ['employee-form-options'],
    queryFn: loadEmployeeFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: async ({ payload, photoBlob }) => {
      const employee = await employeesApi.create(payload)
      if (photoBlob) {
        try {
          await employeesApi.uploadPhoto(employee.id, photoBlob)
        } catch (error) {
          showErrorToast(error, 'Employee was created, but the photo upload failed.')
        }
      }
      return employee
    },
    onSuccess: (employee, variables) => {
      clearCreateFormDraft('employee')
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      const google = employee.google
      if (google?.outcome === 'failed') {
        showErrorToast(
          new Error(google.message),
          'Employee saved, but the Google account was not made. Try again from the Google account row.',
        )
      } else {
        showSuccessToast('Employee created.')
      }
      if (google && google.outcome !== 'failed') {
        setReady({ id: employee.id, name: employee.identity?.full_name, email: employee.identity?.email, recovery: variables.payload.recovery_email, password: google.temporary_password })
        return
      }
      navigate(`/employees/${employee.id}`)
    },
    onError: (error) => {
      showErrorToast(error, 'Failed to create employee.')
    },
  })

  return (
    <div className="min-w-0">
      <PageHeader
        title="New Employee"
        description="Create an employee profile and assign unit, position, and job level."
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
            <Link to="/employees"><ArrowLeft size={16} /></Link>
          </Button>
        }
      />

      {optionsQuery.isLoading ? (
        <PanelMessage>Loading employee form options...</PanelMessage>
      ) : optionsQuery.isError ? (
        <PanelMessage>Employee form options are unavailable.</PanelMessage>
      ) : (
        <EmployeeForm
          mode="create"
          options={optionsQuery.data}
          isSubmitting={createMutation.isPending}
          onSubmit={(payload, photoBlob) => createMutation.mutate({ payload, photoBlob })}
        />
      )}
      {ready ? (
        ready.password ? (
          <GoogleShareDialog
            resource="employees"
            id={ready.id}
            name={ready.name}
            email={ready.email}
            password={ready.password}
            onClose={() => navigate(`/employees/${ready.id}`)}
          />
        ) : (
          <GoogleInstructionsDialog
            email={ready.email}
            maskedRecovery={maskEmail(ready.recovery)}
            onClose={() => navigate(`/employees/${ready.id}`)}
          />
        )
      ) : null}
    </div>
  )
}
