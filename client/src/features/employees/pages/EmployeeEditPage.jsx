import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
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

  // Opening the edit form is the logged access: the hidden identifiers come
  // from the audited reveal call and are merged in before the form mounts.
  const canViewPii = Boolean(employeeQuery.data?.identity?.can_view_pii)
  const piiQuery = useQuery({
    queryKey: ['employees', employeeId, 'pii'],
    queryFn: () => employeesApi.recordSensitiveFieldsAccess(employeeId),
    enabled: canViewPii,
    staleTime: 0,
    gcTime: 0,
  })
  const employee = useMemo(
    () =>
      employeeQuery.data && piiQuery.data
        ? {
            ...employeeQuery.data,
            identity: { ...employeeQuery.data.identity, ...piiQuery.data },
          }
        : employeeQuery.data,
    [employeeQuery.data, piiQuery.data],
  )

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

  const isLoading =
    employeeQuery.isLoading ||
    optionsQuery.isLoading ||
    (canViewPii && piiQuery.isLoading)
  const error = employeeQuery.error || optionsQuery.error || piiQuery.error

  return (
    <div className="min-w-0">
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
        <PanelMessage>Employee data is unavailable.</PanelMessage>
      ) : (
        <EmployeeForm
          mode="edit"
          employee={employee}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
