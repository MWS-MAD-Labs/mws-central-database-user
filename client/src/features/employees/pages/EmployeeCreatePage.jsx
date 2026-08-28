import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { showErrorToast } from '../../../lib/toast.js'
import { employeesApi } from '../api/employeesApi.js'
import { loadEmployeeFormOptions } from '../api/employeeFormOptions.js'
import { EmployeeForm } from '../components/EmployeeForm.jsx'

export function EmployeeCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const optionsQuery = useQuery({
    queryKey: ['employee-form-options'],
    queryFn: loadEmployeeFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: async ({ payload, photoBlob }) => {
      const employee = await employeesApi.create(payload)
      if (photoBlob) {
        // Photo failure shouldn't block landing on the new employee record -
        // the employee was already created successfully at this point.
        try {
          await employeesApi.uploadPhoto(employee.id, photoBlob)
        } catch (error) {
          showErrorToast(error, 'Employee was created, but the photo upload failed.')
        }
      }
      return employee
    },
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
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
          <Button asChild variant="secondary">
            <Link to="/employees">
              <ArrowLeft size={16} />
              Back
            </Link>
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
    </div>
  )
}
