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
import { internsApi } from '../api/internsApi.js'
import { loadInternFormOptions } from '../api/internFormOptions.js'
import { InternForm } from '../components/InternForm.jsx'

export function InternCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Set when a Google account was made, so the person can be told how to get in before the page moves on.
  const [ready, setReady] = useState(null)

  const optionsQuery = useQuery({
    queryKey: ['intern-form-options'],
    queryFn: loadInternFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: (payload) => internsApi.create(payload),
    onSuccess: (intern, payload) => {
      clearCreateFormDraft('intern')
      queryClient.invalidateQueries({ queryKey: ['interns'] })
      const google = intern.google
      if (google?.outcome === 'failed') {
        showErrorToast(
          new Error(google.message),
          'Intern saved, but the Google account was not made. Try again from the Google account row.',
        )
      } else {
        showSuccessToast('Intern created.')
      }
      if (google && google.outcome !== 'failed') {
        setReady({ id: intern.id, name: intern.identity?.full_name, email: intern.identity?.email, recovery: payload.recovery_email, password: google.temporary_password })
        return
      }
      navigate(`/interns/${intern.id}`)
    },
    onError: (error) => {
      showErrorToast(error, 'Failed to create intern.')
    },
  })

  return (
    <div className="min-w-0">
      <PageHeader
        title="New Intern"
        description="Create an intern profile and assign unit, position, and building."
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
            <Link to="/interns"><ArrowLeft size={16} /></Link>
          </Button>
        }
      />

      {optionsQuery.isLoading ? (
        <PanelMessage>Loading intern form options...</PanelMessage>
      ) : optionsQuery.isError ? (
        <PanelMessage>Intern form options are unavailable.</PanelMessage>
      ) : (
        <InternForm
          mode="create"
          options={optionsQuery.data}
          isSubmitting={createMutation.isPending}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}
      {ready ? (
        ready.password ? (
          <GoogleShareDialog
            resource="interns"
            id={ready.id}
            name={ready.name}
            email={ready.email}
            password={ready.password}
            onClose={() => navigate(`/interns/${ready.id}`)}
          />
        ) : (
          <GoogleInstructionsDialog
            email={ready.email}
            maskedRecovery={maskEmail(ready.recovery)}
            onClose={() => navigate(`/interns/${ready.id}`)}
          />
        )
      ) : null}
    </div>
  )
}
