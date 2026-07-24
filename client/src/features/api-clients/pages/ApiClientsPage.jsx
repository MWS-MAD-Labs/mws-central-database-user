import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Clipboard,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  TextAreaInput,
  TextInput,
} from '../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { cleanPayload, trimmedOrUndefined } from '../../../lib/form.js'
import { formatDate, formatStatus } from '../../../lib/format.js'
import { apiClientsApi, apiScopes } from '../api/apiClientsApi.js'

export function ApiClientsPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [tokenDialog, setTokenDialog] = useState(null)

  const clientsQuery = useQuery({
    queryKey: ['api-clients'],
    queryFn: apiClientsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: apiClientsApi.create,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ['api-clients'] })
      setCreateOpen(false)
      setTokenDialog({ title: 'Client Token', client })
    },
  })

  const rotateMutation = useMutation({
    mutationFn: apiClientsApi.rotate,
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ['api-clients'] })
      setTokenDialog({ title: 'Rotated Token', client })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: apiClientsApi.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-clients'] })
    },
  })

  function handleRevoke(client) {
    if (window.confirm(`Revoke API client "${client.name}"?`)) {
      revokeMutation.mutate(client.id)
    }
  }

  return (
    <div>
      <PageHeader
        title="API Clients"
        description="Create and manage scoped access for internal MWS applications."
        actions={
          <Button type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
            New Client
          </Button>
        }
      />

      <section className="rounded-md border border-[#deded7] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#e7e4dc] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#e8f1ed] text-[#24463f]">
              <KeyRound size={19} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#202326]">
                Token Management
              </h2>
              <StatusBadge tone={clientsQuery.isFetching ? 'amber' : 'green'}>
                {clientsQuery.isFetching ? 'Syncing' : 'Live'}
              </StatusBadge>
            </div>
          </div>
          <StatusBadge tone="neutral">SUPER_ADMIN</StatusBadge>
        </div>

        {clientsQuery.isError ||
        createMutation.isError ||
        rotateMutation.isError ||
        revokeMutation.isError ? (
          <div className="border-b border-[#e7e4dc] bg-[#fff4f2] px-4 py-3 text-sm text-[#8f2f2f]">
            {clientsQuery.error?.message ||
              createMutation.error?.message ||
              rotateMutation.error?.message ||
              revokeMutation.error?.message ||
              'Request failed.'}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Token Prefix</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Last Used</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clientsQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                    Loading API clients...
                  </td>
                </tr>
              ) : (clientsQuery.data || []).length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-center text-[#77736a]" colSpan={6}>
                    No API clients found.
                  </td>
                </tr>
              ) : (
                clientsQuery.data.map((client) => (
                  <tr
                    key={client.id}
                    className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#202326]">
                        {client.name}
                      </p>
                      <p className="max-w-xs truncate text-xs text-[#676c70]">
                        {client.description || '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#34383c]">
                      {client.token_prefix}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex max-w-md flex-wrap gap-1">
                        {client.scopes.map((scope) => (
                          <StatusBadge key={scope} tone="neutral">
                            {scope}
                          </StatusBadge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">{formatDate(client.last_used_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={client.is_active ? 'green' : 'red'}>
                        {client.is_active ? 'Active' : 'Revoked'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            !client.is_active ||
                            rotateMutation.variables === client.id
                          }
                          onClick={() => rotateMutation.mutate(client.id)}
                        >
                          <RefreshCw size={15} />
                          Rotate
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            !client.is_active ||
                            revokeMutation.variables === client.id
                          }
                          onClick={() => handleRevoke(client)}
                        >
                          <Ban size={15} />
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen ? (
        <ApiClientDialog
          error={createMutation.error}
          isSubmitting={createMutation.isPending}
          onClose={() => setCreateOpen(false)}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      ) : null}

      {tokenDialog ? (
        <TokenDialog
          title={tokenDialog.title}
          client={tokenDialog.client}
          onClose={() => setTokenDialog(null)}
        />
      ) : null}
    </div>
  )
}

function ApiClientDialog({ error, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState({
    name: '',
    description: '',
    scopes: [],
  })
  const [localError, setLocalError] = useState('')

  function toggleScope(scope, checked) {
    setValues((current) => ({
      ...current,
      scopes: checked
        ? [...current.scopes, scope]
        : current.scopes.filter((item) => item !== scope),
    }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    if (values.scopes.length === 0) {
      setLocalError('At least one scope is required.')
      return
    }
    setLocalError('')
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        description: trimmedOrUndefined(values.description),
        scope_names: values.scopes,
      }),
    )
  }

  return (
    <CrudDialog
      title="New API Client"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="api-client-form" type="submit" disabled={isSubmitting}>
            Create
          </Button>
        </>
      }
    >
      {error || localError ? (
        <PanelMessage tone="error">
          {localError || error.message || 'Failed to create API client.'}
        </PanelMessage>
      ) : null}
      <form id="api-client-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          <TextInput
            required
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field label="Description">
          <TextAreaInput
            value={values.description}
            onChange={(event) =>
              setValues({ ...values, description: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {apiScopes.map((scope) => (
            <CheckboxField
              key={scope}
              label={scope}
              checked={values.scopes.includes(scope)}
              onChange={(event) => toggleScope(scope, event.target.checked)}
            />
          ))}
        </div>
      </form>
    </CrudDialog>
  )
}

function TokenDialog({ title, client, onClose }) {
  const [copied, setCopied] = useState(false)

  async function copyToken() {
    await navigator.clipboard.writeText(client.token)
    setCopied(true)
  }

  return (
    <CrudDialog
      title={title}
      description={client.name}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={copyToken}>
            <Clipboard size={16} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border border-[#d8d6cf] bg-[#f8faf8] p-3">
          <ShieldCheck size={18} className="text-[#24463f]" />
          <div>
            <p className="text-sm font-semibold text-[#202326]">
              {client.token_prefix}
            </p>
            <p className="text-xs text-[#676c70]">
              {client.scopes.map(formatStatus).join(', ')}
            </p>
          </div>
        </div>
        <textarea
          readOnly
          value={client.token}
          className="min-h-28 w-full rounded-md border border-[#d8d6cf] bg-white px-3 py-2 font-mono text-sm text-[#202326] outline-none"
        />
      </div>
    </CrudDialog>
  )
}
