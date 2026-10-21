import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Baby } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { CheckboxField, Field, NumberInput } from '../../../components/ui/FormControls.jsx'
import { showErrorToast, showSuccessToast } from '../../../lib/toast.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { childrenAllowanceApi } from '../../employees/api/childrenAllowanceApi.js'
import { CHILDREN_ALLOWANCE_KEY } from '../../employees/hooks/useChildrenAllowance.js'
import { DEFAULT_ALLOWANCE_RULE, MAX_CHILDREN } from '../../employees/utils/childrenRules.js'
import { PanelFrame } from './PanelFrame.jsx'

const toText = (value) => (value == null ? '' : String(value))

function problemsOf(form) {
  const problems = {}
  if (form.max_children !== '' && (Number(form.max_children) < 1 || Number(form.max_children) > MAX_CHILDREN)) {
    problems.max_children = `Use a number from 1 to ${MAX_CHILDREN}, or leave it empty.`
  }
  if (form.age_limit === '' || Number(form.age_limit) < 1 || Number(form.age_limit) > 60) {
    problems.age_limit = 'Use an age from 1 to 60.'
  }
  if (!form.count_biological && !form.count_adopted && !form.count_step) {
    problems.kinds = 'Pick at least one kind of child.'
  }
  return problems
}

const toPayload = (form) => ({
  max_children: form.max_children === '' ? null : Number(form.max_children),
  age_limit: Number(form.age_limit),
  count_biological: form.count_biological,
  count_adopted: form.count_adopted,
  count_step: form.count_step,
})

function AllowanceForm({ rule, canEdit }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    max_children: toText(rule.max_children),
    age_limit: toText(rule.age_limit),
    count_biological: rule.count_biological,
    count_adopted: rule.count_adopted,
    count_step: rule.count_step,
  })
  const problems = problemsOf(form)
  const changed = JSON.stringify(toPayload(form)) !== JSON.stringify(rule)
  const patch = (next) => setForm((current) => ({ ...current, ...next }))

  const save = useMutation({
    mutationFn: () => childrenAllowanceApi.update(toPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHILDREN_ALLOWANCE_KEY })
      showSuccessToast('Allowance rule saved.')
    },
    onError: (error) => showErrorToast(error, 'Allowance rule was not saved.'),
  })

  return (
    <div className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Maximum Children" hint="Leave empty for no limit." error={problems.max_children}>
          <NumberInput
            value={form.max_children}
            max={MAX_CHILDREN}
            disabled={!canEdit}
            invalid={Boolean(problems.max_children)}
            placeholder="No limit"
            onChange={(text) => patch({ max_children: text })}
          />
        </Field>
        <Field label="Age Limit" hint="A child counts until this age." error={problems.age_limit}>
          <NumberInput
            value={form.age_limit}
            max={60}
            disabled={!canEdit}
            invalid={Boolean(problems.age_limit)}
            onChange={(text) => patch({ age_limit: text })}
          />
        </Field>
      </div>

      <Field label="Kinds of Children That Count" error={problems.kinds}>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['count_biological', 'Biological'],
            ['count_adopted', 'Adopted'],
            ['count_step', 'Step'],
          ].map(([field, label]) => (
            <CheckboxField
              key={field}
              label={label}
              checked={form[field]}
              disabled={!canEdit}
              onChange={(event) => patch({ [field]: event.target.checked })}
            />
          ))}
        </div>
      </Field>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-(--mws-muted)">
          {canEdit ? 'A change applies to every employee at once.' : 'Only a Super Admin can change this.'}
        </p>
        {canEdit ? (
          <Button
            type="button"
            loading={save.isPending}
            disabled={!changed || Object.keys(problems).length > 0}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        ) : null}
      </div>
    </div>
  )
}

// Which children count for the allowance. One rule for the whole organization.
export function ChildrenAllowanceCard() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: CHILDREN_ALLOWANCE_KEY, queryFn: childrenAllowanceApi.get })
  const rule = typeof query.data?.age_limit === 'number' ? query.data : DEFAULT_ALLOWANCE_RULE

  return (
    <PanelFrame
      title="Children Allowance"
      description="Which children of an employee count for the allowance."
      icon={Baby}
      isFetching={query.isFetching}
    >
      {query.isLoading ? (
        <p className="p-5 text-sm text-(--mws-muted)">Loading...</p>
      ) : (
        <AllowanceForm key={JSON.stringify(rule)} rule={rule} canEdit={user?.role === 'SUPER_ADMIN'} />
      )}
    </PanelFrame>
  )
}
