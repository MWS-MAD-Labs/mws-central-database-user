import { useEffect, useMemo, useState } from 'react'

const VERSION = 1

function storageKey(entity) {
  return `mws:create-draft:${entity}`
}

function readDraft(entity) {
  try {
    const raw = window.sessionStorage.getItem(storageKey(entity))
    if (!raw) return null
    const draft = JSON.parse(raw)
    return draft?.version === VERSION && draft.values ? draft : null
  } catch {
    return null
  }
}

export function clearCreateFormDraft(entity) {
  window.sessionStorage.removeItem(storageKey(entity))
}

export function useCreateFormDraft({ entity, values, enabled = true }) {
  const [savedDraft, setSavedDraft] = useState(() => (enabled ? readDraft(entity) : null))
  const [draftHandled, setDraftHandled] = useState(false)

  useEffect(() => {
    if (!enabled || (savedDraft && !draftHandled)) return
    const timer = window.setTimeout(() => {
      try {
        const filledFieldCount = Object.values(values).filter(Boolean).length
        if (filledFieldCount === 0) {
          clearCreateFormDraft(entity)
          return
        }
        const draft = {
          version: VERSION,
          saved_at: new Date().toISOString(),
          filled_field_count: filledFieldCount,
          values,
        }
        window.sessionStorage.setItem(storageKey(entity), JSON.stringify(draft))
      } catch {
        // Storage may be disabled or full. Form use must continue normally.
      }
    }, 400)
    return () => window.clearTimeout(timer)
  }, [entity, enabled, savedDraft, draftHandled, values])

  return useMemo(
    () => ({
      savedDraft,
      restoreChecked: true,
      draftHandled,
      markDraftHandled: () => setDraftHandled(true),
      clearDraft: () => {
        clearCreateFormDraft(entity)
        setSavedDraft(null)
        setDraftHandled(true)
      },
    }),
    [entity, draftHandled, savedDraft],
  )
}
