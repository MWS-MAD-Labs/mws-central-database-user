import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HeartHandshake } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { Field, NumberInput } from '../../../components/ui/FormControls.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { supportCaseloadApi } from '../../students/api/supportCaseloadApi.js'
import { DEFAULT_SUPPORT_CASELOAD, SUPPORT_CASELOAD_KEY } from '../../students/hooks/useSupportCaseloadLimit.js'
import { PanelFrame } from './PanelFrame.jsx'

const MAX_LIMIT = 20

function CaseloadForm({ rule, canEdit }) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(String(rule.max_students))
  const number = Number(value)
  const problem = value === '' || !Number.isInteger(number) || number < 1 || number > MAX_LIMIT
    ? `Use a number from 1 to ${MAX_LIMIT}.`
    : undefined

  const save = useMutation({
    mutationFn: () => supportCaseloadApi.update({ max_students: number }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SUPPORT_CASELOAD_KEY })
      queryClient.invalidateQueries({ queryKey: ['support-assignment-candidates'] })
      showSuccessToast('Caseload limit saved.')
    },
    onError: (error) => showErrorToast(error, 'Caseload limit was not saved.'),
  })

  return (
    <div className="space-y-5 p-5">
      <Field
        label="Maximum Students Per Teacher"
        hint="Teachers who already have more keep their students. Only new assignments are refused."
        error={problem}
      >
        <NumberInput
          value={value}
          max={MAX_LIMIT}
          disabled={!canEdit}
          invalid={Boolean(problem)}
          onChange={setValue}
        />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-(--mws-muted)">
          {canEdit ? 'A change applies to every Special Education teacher at once.' : 'Only a Super Admin can change this.'}
        </p>
        {canEdit ? (
          <Button
            type="button"
            loading={save.isPending}
            disabled={Boolean(problem) || number === rule.max_students}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// How many students one Special Education teacher can support. One limit for the whole organization.
export function SupportCaseloadCard() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: SUPPORT_CASELOAD_KEY, queryFn: supportCaseloadApi.get })
  const rule = typeof query.data?.max_students === 'number' ? query.data : { max_students: DEFAULT_SUPPORT_CASELOAD }

  return (
    <PanelFrame
      title="Special Ed Caseload"
      description="The most students one Special Education teacher can support at once."
      icon={HeartHandshake}
      isFetching={query.isFetching}
    >
      {query.isLoading ? (
        <p className="p-5 text-sm text-(--mws-muted)">Loading...</p>
      ) : (
        <CaseloadForm key={rule.max_students} rule={rule} canEdit={user?.role === 'SUPER_ADMIN'} />
      )}
    </PanelFrame>
  )
}
