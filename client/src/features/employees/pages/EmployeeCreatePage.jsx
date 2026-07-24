import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
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
    mutationFn: employeesApi.create,
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/employees/${employee.id}`)
    },
  })

  return (
    <div>
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
        <PanelMessage tone="error">
          {optionsQuery.error.message || 'Failed to load form options.'}
        </PanelMessage>
      ) : (
        <EmployeeForm
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
