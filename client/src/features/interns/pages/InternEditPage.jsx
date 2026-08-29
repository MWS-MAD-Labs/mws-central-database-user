import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { internsApi } from '../api/internsApi.js'
import { loadInternFormOptions } from '../api/internFormOptions.js'
import { InternForm } from '../components/InternForm.jsx'

export function InternEditPage() {
  const { internId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const internQuery = useQuery({
    queryKey: ['interns', internId],
    queryFn: () => internsApi.get(internId),
    enabled: Boolean(internId),
  })

  const optionsQuery = useQuery({
    queryKey: ['intern-form-options'],
    queryFn: loadInternFormOptions,
  })

  const updateMutation = useMutation({
    mutationFn: (payload) => internsApi.update(internId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interns'] })
      navigate(`/interns/${internId}`)
    },
  })

  const isLoading = internQuery.isLoading || optionsQuery.isLoading
  const error = internQuery.error || optionsQuery.error

  return (
    <div className="min-w-0">
      <PageHeader
        title="Edit Intern"
        description={
          internQuery.data
            ? internQuery.data.identity.full_name
            : 'Update intern identity and internship data.'
        }
        actions={
          <Button asChild variant="secondary">
            <Link to={`/interns/${internId}`}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <PanelMessage>Loading intern...</PanelMessage>
      ) : error ? (
        <PanelMessage>Intern data is unavailable.</PanelMessage>
      ) : (
        <InternForm
          mode="edit"
          intern={internQuery.data}
          options={optionsQuery.data}
          isSubmitting={updateMutation.isPending}
          onSubmit={(payload) => updateMutation.mutate(payload)}
        />
      )}
    </div>
  )
}
