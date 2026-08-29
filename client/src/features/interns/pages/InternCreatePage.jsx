import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { showErrorToast } from '../../../lib/toast.js'
import { internsApi } from '../api/internsApi.js'
import { loadInternFormOptions } from '../api/internFormOptions.js'
import { InternForm } from '../components/InternForm.jsx'

export function InternCreatePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const optionsQuery = useQuery({
    queryKey: ['intern-form-options'],
    queryFn: loadInternFormOptions,
  })

  const createMutation = useMutation({
    mutationFn: (payload) => internsApi.create(payload),
    onSuccess: (intern) => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
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
          <Button asChild variant="secondary">
            <Link to="/interns">
              <ArrowLeft size={16} />
              Back
            </Link>
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
    </div>
  )
}
