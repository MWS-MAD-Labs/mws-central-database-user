import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { employeesApi } from '../api/employeesApi.js'
import { loadEmployeeFormOptions } from '../api/employeeFormOptions.js'
import { EmployeeForm } from '../components/EmployeeForm.jsx'
import { hasRecentReveal, rememberReveal } from '../../../lib/piiRevealMemory.js'

const employeePiiScope = (employeeId) => `employee:${employeeId}`

export function EmployeeEditPage() {
  const { employeeId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const employeeQuery = useQuery({
    queryKey: ['employees', employeeId],
    queryFn: () => employeesApi.get(employeeId),
    enabled: Boolean(employeeId),
  })

  // The edit form pre-fills NIK/NPWP/bank account/BPJS with the real value
  // (needed to actually edit it) without going through the detail page's
  // "Reveal" click - so without this, opening Edit shows someone else's PII
  // with no audit trail at all. Fires once the record's loaded, same
  // endpoint the Detail page's Reveal button uses (no-ops server-side for
  // your own record, and dedupes within a short window like every other
  // PII-access log).
  //
  // Only when the response actually carries PII (is_self is a boolean only
  // on EmployeeService.get()'s detailed response - the basic one a viewer
  // without can_view_employee_pii gets back has no identity.nik/etc at
  // all) - otherwise this call would 403 and log a false "unauthorized
  // access" entry for an admin who's allowed to edit non-sensitive fields
  // but just can't see PII, which isn't what happened.
  const recordedAccessForRef = useRef(null)
  useEffect(() => {
    const identity = employeeQuery.data?.identity
    if (!employeeId || typeof identity?.is_self !== 'boolean') return
    if (recordedAccessForRef.current === employeeId) return
    recordedAccessForRef.current = employeeId
    // Skip the call entirely if the Detail page (or a previous visit here)
    // already logged this recently - the backend would just silently
    // dedupe it anyway, this just saves the round trip.
    if (hasRecentReveal(employeePiiScope(employeeId))) return
    employeesApi
      .recordSensitiveFieldsAccess(employeeId)
      .then(() => rememberReveal(employeePiiScope(employeeId)))
      .catch(() => {
        // Best-effort - a failed audit call shouldn't block editing.
      })
  }, [employeeId, employeeQuery.data])

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
          employee={employeeQuery.data}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
