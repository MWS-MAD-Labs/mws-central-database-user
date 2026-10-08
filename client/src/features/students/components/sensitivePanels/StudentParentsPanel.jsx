import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeOff, Plus, RotateCcw, Trash2, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../components/ui/Button.jsx'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import {
  CheckboxField,
  Field,
  LimitedField,
  PhoneField,
  SearchableSelect,
  ToggleChip,
} from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { capitalizeWords, cleanPayload, trimmedOrUndefined } from '../../../../lib/form.js'
import { enumOptions, formatStatus } from '../../../../lib/format.js'
import { parentTypes, studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame, SensitiveDataReveal } from './panelPrimitives.jsx'
import { invalidateStudentRelation } from './panelHelpers.js'
import { isPendingFor } from "../../../../lib/mutationState.js";

export function StudentParentsPanel({ studentId, canWrite, revealed = true, onReveal, onHide }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const parentsQuery = useQuery({
    queryKey: ['students', studentId, 'parents', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listParents(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId) && revealed,
  })
  // Active parents feed the "same as Father" shortcuts. Same key as the list
  // above when the trash is off, so it is not fetched twice.
  const activeParentsQuery = useQuery({
    queryKey: ['students', studentId, 'parents', false],
    queryFn: () => studentSensitiveApi.listParents(studentId, { is_deleted: false }),
    enabled: Boolean(studentId) && revealed,
  })

  const createMutation = useMutation({
    meta: { successMessage: "Parent added." },
    mutationFn: (payload) => studentSensitiveApi.createParent(studentId, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'parents')
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    meta: { successMessage: "Parent updated." },
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updateParent(studentId, id, payload),
    onSuccess: () => {
      invalidateStudentRelation(queryClient, studentId, 'parents')
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    meta: { successMessage: "Parent removed." },
    mutationFn: (id) => studentSensitiveApi.removeParent(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'parents'),
  })
  const restoreMutation = useMutation({
    meta: { successMessage: "Parent restored." },
    mutationFn: (id) => studentSensitiveApi.restoreParent(studentId, id),
    onSuccess: () => invalidateStudentRelation(queryClient, studentId, 'parents'),
  })

  if (!revealed) {
    return (
      <SensitiveDataReveal icon={UsersRound} title="Parents & Guardians" onReveal={onReveal} />
    )
  }

  return (
    <PanelFrame
      title="Parents & Guardians"
      icon={UsersRound}
      isFetching={parentsQuery.isFetching}
      action={
        <>
          {onHide ? (
            <Button type="button" variant="ghost" size="sm" onClick={onHide}>
              <EyeOff size={15} />
              Hide
            </Button>
          ) : null}
          <ToggleChip checked={showDeleted} onChange={setShowDeleted}>
            Show Deleted
          </ToggleChip>
          <Button
            type="button"
            size="sm"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: 'create' })}
          >
            <Plus size={15} />
            Parent
          </Button>
        </>
      }
    >
      {(parentsQuery.data || []).length === 0 ? (
        <PanelMessage>No parent or guardian records yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(parentsQuery.data || []).map((parent) => (
            <article key={parent.id} className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">
                      {parent.full_name}
                    </h3>
                    <StatusBadge tone="neutral">{formatStatus(parent.type)}</StatusBadge>
                    {parent.is_primary ? <StatusBadge tone="green">Primary</StatusBadge> : null}
                    {parent.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-sm text-(--mws-muted)">
                    {[parent.phone, parent.email].filter(Boolean).join(' / ') || '-'}
                  </p>
                  {parent.address ? (
                    <p className="mt-2 text-sm leading-6 text-(--mws-charcoal)">
                      {parent.address}
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-1">
                  {parent.deleted_at ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!canWrite || isPendingFor(restoreMutation, parent.id)}
                      onClick={() => restoreMutation.mutate(parent.id)}
                    >
                      <RotateCcw size={15} />
                      Restore
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite}
                        onClick={() => setDialog({ mode: 'edit', record: parent })}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canWrite || isPendingFor(deleteMutation, parent.id)}
                        onClick={() => deleteMutation.mutate(parent.id)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog ? (
        <ParentDialog
          dialog={dialog}
          siblings={activeParentsQuery.data || []}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === 'create') createMutation.mutate(payload)
            else updateMutation.mutate({ id: dialog.record.id, payload })
          }}
        />
      ) : null}
    </PanelFrame>
  )
}

function ParentDialog({ dialog, siblings = [], isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    type: dialog.record?.type || 'FATHER',
    full_name: dialog.record?.full_name || '',
    phone: dialog.record?.phone || '',
    email: dialog.record?.email || '',
    address: dialog.record?.address || '',
    is_primary: Boolean(dialog.record?.is_primary),
  }))
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [sameAddress, setSameAddress] = useState(false)
  const [samePhone, setSamePhone] = useState(false)
  // Shortcuts copy from the Father; they only make sense for another parent.
  const father = siblings.find(
    (parent) => parent.type === 'FATHER' && !parent.deleted_at && parent.id !== dialog.record?.id,
  )
  const showFatherShortcuts = values.type !== 'FATHER' && Boolean(father)

  function toggleSame(field, checked) {
    if (field === 'address') setSameAddress(checked)
    else setSamePhone(checked)
    if (checked) setValues((current) => ({ ...current, [field]: father?.[field] || '' }))
  }

  function changeType(type) {
    setValues((current) => ({ ...current, type }))
    if (type === 'FATHER') {
      setSameAddress(false)
      setSamePhone(false)
    }
  }
  const fullNameError =
    hasAttemptedSubmit && !values.full_name.trim() ? 'Full name is required.' : undefined

  function submit(event) {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    if (!values.full_name.trim()) return
    onSubmit(cleanPayload({
      type: values.type,
      full_name: trimmedOrUndefined(values.full_name),
      phone: trimmedOrUndefined(values.phone),
      email: trimmedOrUndefined(values.email),
      address: trimmedOrUndefined(values.address),
      is_primary: values.is_primary,
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Parent / Guardian' : 'Edit Parent / Guardian'}
      onClose={onClose}
      footer={<DialogFooter form="parent-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="parent-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Type">
          <SearchableSelect
            value={values.type}
            onChange={changeType}
            options={enumOptions(parentTypes)}
            placeholder="Select Type"
            searchPlaceholder="Search Type"
          />
        </Field>
        <LimitedField
          label="Full Name"
          field="full_name"
          max={100}
          required
          transform={capitalizeWords}
          values={values}
          errors={{ full_name: fullNameError }}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        <PhoneField
          label="Phone"
          field="phone"
          disabled={samePhone}
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        <LimitedField
          label="Email"
          field="email"
          max={100}
          type="email"
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        <LimitedField
          label="Address"
          field="address"
          max={200}
          as="textarea"
          className="md:col-span-2"
          disabled={sameAddress}
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        {showFatherShortcuts ? (
          <>
            <CheckboxField
              label="Same phone as Father"
              description={father.phone ? undefined : 'The Father has no phone number saved.'}
              checked={samePhone}
              disabled={!father.phone}
              onChange={(event) => toggleSame('phone', event.target.checked)}
            />
            <CheckboxField
              label="Same address as Father"
              description={father.address ? undefined : 'The Father has no address saved.'}
              checked={sameAddress}
              disabled={!father.address}
              onChange={(event) => toggleSame('address', event.target.checked)}
            />
          </>
        ) : null}
        <CheckboxField
          label="Primary Contact"
          checked={values.is_primary}
          onChange={(event) => setValues({ ...values, is_primary: event.target.checked })}
          className="md:col-span-2"
        />
      </form>
    </CrudDialog>
  )
}
