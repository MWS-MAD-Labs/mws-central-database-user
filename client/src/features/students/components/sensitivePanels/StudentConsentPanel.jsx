import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileSignature, Paperclip, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../components/ui/Button.jsx'
import { useConfirm } from '../../../../components/ui/useConfirm.js'
import { CrudDialog } from '../../../../components/ui/CrudDialog.jsx'
import {
  DateField,
  Field,
  LimitedField,
  SearchableSelect,
  ToggleChip,
} from '../../../../components/ui/FormControls.jsx'
import { PanelMessage } from '../../../../components/ui/PanelMessage.jsx'
import { StatusBadge } from '../../../../components/ui/StatusBadge.jsx'
import { env } from '../../../../config/env.js'
import { cleanPayload, dateInputFromIso, isoFromDateInput, trimmedOrUndefined } from '../../../../lib/form.js'
import { enumOptions, formatDate, formatStatus } from '../../../../lib/format.js'
import { MAX_ATTACHMENT_SIZE_BYTES, formatFileSize, validateFileSize } from '../../../../lib/fileSize.js'
import { showErrorToast } from '../../../../lib/toast.js'
import { consentStatuses, consentTypes, studentSensitiveApi } from '../../api/studentSensitiveApi.js'
import { DialogFooter, PanelFrame } from './panelPrimitives.jsx'
import { isPendingFor } from "../../../../lib/mutationState.js";

export function StudentConsentPanel({ studentId, canWrite, canViewSensitive }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState(null)

  const consentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listConsents(studentId, { is_deleted: showDeleted }),
    enabled: Boolean(studentId),
  })

  const createMutation = useMutation({
    meta: { successMessage: "Consent added." },
    mutationFn: (payload) => studentSensitiveApi.createConsent(studentId, payload),
    onSuccess: () => {
      invalidateConsents(queryClient, studentId)
      setDialog(null)
    },
  })
  const updateMutation = useMutation({
    meta: { successMessage: "Consent updated." },
    mutationFn: ({ id, payload }) =>
      studentSensitiveApi.updateConsent(studentId, id, payload),
    onSuccess: () => {
      invalidateConsents(queryClient, studentId)
      setDialog(null)
    },
  })
  const deleteMutation = useMutation({
    meta: { successMessage: "Consent deleted." },
    mutationFn: (id) => studentSensitiveApi.removeConsent(studentId, id),
    onSuccess: () => invalidateConsents(queryClient, studentId),
  })
  const restoreMutation = useMutation({
    meta: { successMessage: "Consent restored." },
    mutationFn: (id) => studentSensitiveApi.restoreConsent(studentId, id),
    onSuccess: () => invalidateConsents(queryClient, studentId),
  })

  async function handleDelete(consent) {
    if (
      await confirm({
        title: 'Delete consent',
        description: `Delete ${formatStatus(consent.consent_type)} consent?`,
        confirmLabel: 'Delete',
        tone: 'danger',
      })
    ) {
      deleteMutation.mutate(consent.id)
    }
  }

  return (
    <PanelFrame
      title="Consent"
      icon={FileSignature}
      isFetching={consentsQuery.isFetching}
      action={
        <>
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
            Consent
          </Button>
        </>
      }
    >
      {(consentsQuery.data || []).length === 0 ? (
        <PanelMessage>No consent records yet.</PanelMessage>
      ) : (
        <div className="space-y-3">
          {(consentsQuery.data || []).map((consent) => (
            <ConsentCard
              key={consent.id}
              studentId={studentId}
              consent={consent}
              canWrite={canWrite}
              canViewSensitive={canViewSensitive}
              onEdit={() => setDialog({ mode: 'edit', record: consent })}
              onDelete={() => handleDelete(consent)}
              onRestore={() => restoreMutation.mutate(consent.id)}
              isRestoring={isPendingFor(restoreMutation, consent.id)}
            />
          ))}
        </div>
      )}

      {dialog ? (
        <ConsentDialog
          dialog={dialog}
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

function ConsentCard({
  studentId,
  consent,
  canWrite,
  canViewSensitive,
  onEdit,
  onDelete,
  onRestore,
  isRestoring,
}) {
  return (
    <article className="min-w-0 rounded-2xl border border-(--mws-line) bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">
              {formatStatus(consent.consent_type)}
            </h3>
            <StatusBadge tone={consentStatusTone(consent.status)}>
              {formatStatus(consent.status)}
            </StatusBadge>
            {consent.deleted_at ? <StatusBadge tone="red">Deleted</StatusBadge> : null}
          </div>
          {consent.signed_by || consent.consent_date ? (
            <p className="mt-1 text-sm text-(--mws-muted)">
              {consent.signed_by ? `Signed by ${consent.signed_by}` : 'Signed'}
              {consent.consent_date ? ` on ${formatDate(consent.consent_date)}` : ''}
            </p>
          ) : null}
          {consent.notes ? (
            <p className="mt-2 text-sm leading-6 text-(--mws-charcoal)">
              {consent.notes}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          {consent.deleted_at ? (
            <Button type="button" variant="ghost" size="sm" disabled={!canWrite || isRestoring} onClick={onRestore}>
              <RotateCcw size={15} />
              Restore
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-8 px-0"
                title="Edit"
                aria-label="Edit"
                disabled={!canWrite}
                onClick={onEdit}
              >
                <Pencil size={15} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-8 px-0"
                title="Delete"
                aria-label="Delete"
                disabled={!canWrite}
                onClick={onDelete}
              >
                <Trash2 size={15} />
              </Button>
            </>
          )}
        </div>
      </div>
      <ConsentAttachments
        studentId={studentId}
        consentId={consent.id}
        canWrite={canWrite && !consent.deleted_at}
        canViewSensitive={canViewSensitive}
      />
    </article>
  )
}

function ConsentAttachments({ studentId, consentId, canWrite, canViewSensitive }) {
  const queryClient = useQueryClient()
  const [showDeleted, setShowDeleted] = useState(false)
  const attachmentsQuery = useQuery({
    queryKey: ['students', studentId, 'consents', consentId, 'attachments', showDeleted],
    queryFn: () =>
      studentSensitiveApi.listAttachments(studentId, consentId, {
        is_deleted: showDeleted,
      }),
    enabled: canViewSensitive,
  })
  const uploadMutation = useMutation({
    meta: { successMessage: "File uploaded." },
    mutationFn: (file) => studentSensitiveApi.uploadAttachment(studentId, consentId, file),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
      }),
  })
  const deleteMutation = useMutation({
    meta: { successMessage: "File deleted." },
    mutationFn: (attachmentId) =>
      studentSensitiveApi.removeAttachment(studentId, consentId, attachmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
      }),
  })
  const restoreMutation = useMutation({
    meta: { successMessage: "File restored." },
    mutationFn: (attachmentId) =>
      studentSensitiveApi.restoreAttachment(studentId, consentId, attachmentId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['students', studentId, 'consents', consentId, 'attachments'],
      }),
  })

  if (!canViewSensitive) {
    return (
      <div className="mt-4 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 text-sm text-(--mws-muted)">
        Attachments are restricted. You don't have permission to view sensitive data.
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-(--mws-charcoal)">
          <Paperclip size={15} />
          Attachments
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleChip checked={showDeleted} onChange={setShowDeleted}>
            Show Deleted
          </ToggleChip>
          <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-(--mws-line) bg-white px-3 font-display text-xs font-semibold text-(--mws-charcoal) hover:border-(--mws-burgundy)">
            Upload
            <input
              type="file"
              className="hidden"
              disabled={!canWrite || uploadMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                const sizeError = validateFileSize(file, MAX_ATTACHMENT_SIZE_BYTES)
                if (sizeError) {
                  showErrorToast(sizeError)
                  return
                }
                uploadMutation.mutate(file)
              }}
            />
          </label>
        </div>
      </div>
      {(attachmentsQuery.data || []).length === 0 ? (
        <p className="text-sm text-(--mws-muted)">No signed files uploaded.</p>
      ) : (
        <div className="space-y-2">
          {(attachmentsQuery.data || []).map((attachment) => (
            <div
              key={attachment.id}
              className="flex flex-col gap-2 rounded-xl border border-(--mws-line) bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                {attachment.mime_type?.startsWith('image/') ? (
                  <a href={attachment.preview_url} target="_blank" rel="noreferrer">
                    <img
                      src={attachment.preview_url}
                      alt={attachment.file_name}
                      className="h-12 w-12 shrink-0 rounded-lg border border-(--mws-line) object-cover"
                    />
                  </a>
                ) : (
                  <a
                    href={attachment.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-(--mws-line) bg-(--mws-soft) text-xs font-bold text-(--mws-muted)"
                  >
                    PDF
                  </a>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-(--mws-charcoal)">
                    {attachment.file_name}
                    {attachment.deleted_at ? (
                      <StatusBadge tone="red" className="ml-2">Deleted</StatusBadge>
                    ) : null}
                  </p>
                  <p className="text-xs text-(--mws-muted)">
                    {formatFileSize(attachment.file_size)} / {formatDate(attachment.uploaded_at)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button asChild variant="ghost" size="sm">
                  <a href={attachmentDownloadUrl(studentId, consentId, attachment.id)} target="_blank" rel="noreferrer">
                    <Download size={15} />
                  </a>
                </Button>
                {attachment.deleted_at ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canWrite || isPendingFor(restoreMutation, attachment.id)}
                    onClick={() => restoreMutation.mutate(attachment.id)}
                  >
                    <RotateCcw size={15} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canWrite || isPendingFor(deleteMutation, attachment.id)}
                    onClick={() => deleteMutation.mutate(attachment.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConsentDialog({ dialog, isSubmitting, onClose, onSubmit }) {
  const [values, setValues] = useState(() => ({
    consent_type: dialog.record?.consent_type || 'MEDIA_CONSENT',
    status: dialog.record?.status || 'PENDING',
    consent_date: dialog.record
      ? dateInputFromIso(dialog.record.consent_date)
      : new Date().toISOString().slice(0, 10),
    signed_by: dialog.record?.signed_by || '',
    validity_period: dateInputFromIso(dialog.record?.validity_period),
    notes: dialog.record?.notes || '',
  }))

  function submit(event) {
    event.preventDefault()
    onSubmit(cleanPayload({
      consent_type: dialog.mode === 'create' ? values.consent_type : undefined,
      status: values.status,
      consent_date: isoFromDateInput(values.consent_date),
      signed_by: trimmedOrUndefined(values.signed_by),
      validity_period: isoFromDateInput(values.validity_period),
      notes: trimmedOrUndefined(values.notes),
    }))
  }

  return (
    <CrudDialog
      title={dialog.mode === 'create' ? 'New Consent' : 'Edit Consent'}
      onClose={onClose}
      footer={<DialogFooter form="consent-form" isSubmitting={isSubmitting} onClose={onClose} />}
    >
      <form id="consent-form" className="grid gap-4 md:grid-cols-2" onSubmit={submit} noValidate>
        <Field label="Consent Type">
          <SearchableSelect
            disabled={dialog.mode !== 'create'}
            value={values.consent_type}
            onChange={(value) => setValues({ ...values, consent_type: value })}
            options={enumOptions(consentTypes)}
            placeholder="Select Consent Type"
            searchPlaceholder="Search Consent Type"
          />
        </Field>
        <Field label="Status">
          <SearchableSelect
            value={values.status}
            onChange={(value) => setValues({ ...values, status: value })}
            options={enumOptions(consentStatuses)}
            placeholder="Select Status"
            searchPlaceholder="Search Status"
          />
        </Field>
        <Field label="Consent Date">
          <DateField value={values.consent_date} onChange={(event) => setValues({ ...values, consent_date: event.target.value })} />
        </Field>
        <Field label="Valid Until">
          <DateField value={values.validity_period} onChange={(event) => setValues({ ...values, validity_period: event.target.value })} />
        </Field>
        <LimitedField
          label="Signed By"
          field="signed_by"
          max={50}
          className="md:col-span-2"
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
        <LimitedField
          label="Notes"
          field="notes"
          max={500}
          as="textarea"
          className="md:col-span-2"
          values={values}
          updateValue={(field, value) =>
            setValues((current) => ({ ...current, [field]: value }))
          }
        />
      </form>
    </CrudDialog>
  )
}

function consentStatusTone(status) {
  switch (status) {
    case 'SIGNED':
      return 'green'
    case 'DECLINED':
    case 'EXPIRED':
      return 'red'
    default:
      return 'amber'
  }
}

function attachmentDownloadUrl(studentId, consentId, attachmentId) {
  return `${env.apiBaseUrl}/api/admin/students/${studentId}/consents/${consentId}/attachments/${attachmentId}/download`
}

function invalidateConsents(queryClient, studentId) {
  queryClient.invalidateQueries({ queryKey: ['students', studentId, 'consents'] })
}
