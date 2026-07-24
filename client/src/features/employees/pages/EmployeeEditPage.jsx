import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { employeesApi } from '../api/employeesApi.js'
import { loadEmployeeFormOptions } from '../api/employeeFormOptions.js'
import { EmployeeForm } from '../components/EmployeeForm.jsx'

export function EmployeeEditPage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const employeeQuery = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Boolean(employeeId),
  })

  const optionsQuery = useQuery({
    queryKey: ['employee-form-options'],
    queryFn: loadEmployeeFormOptions,
  })

  const updateMutation = useMutation({
    mutationFn: (payload) => employeesApi.update(employeeId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/employees/${employeeId}`)
    },
  })

  const isLoading = employeeQuery.isLoading || optionsQuery.isLoading
  const error = employeeQuery.error || optionsQuery.error

  return (
    <div>
      <PageHeader
        title="Edit Employee"
        description={
          employeeQuery.data
            ? employeeQuery.data.identity.full_name
            : 'Update employee identity and employment data.'
        }
        actions={
          <Button asChild variant="secondary">
            <Link to={`/employees/${employeeId}`}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <PanelMessage>Loading employee...</PanelMessage>
      ) : error ? (
        <PanelMessage tone="error">
          {error.message || 'Failed to load employee.'}
        </PanelMessage>
      ) : (
        <EmployeeForm
          mode="edit"
          employee={employeeQuery.data}
          options={optionsQuery.data}
          error={updateMutation.error}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
