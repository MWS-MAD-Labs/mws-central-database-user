import { useSyncExternalStore } from 'react'

// Runs a chunked bulk-photo upload outside any single dialog's lifecycle,
// so it keeps going (and stays visible via BulkPhotoUploadStatusBar) even
// if the admin closes the dialog, navigates elsewhere, or has the app open
// in another tab. Only one job can be active app-wide at a time - matches
// there only ever being one bulk-upload dialog open at once anyway.
//
// The tab that calls startBulkPhotoUpload() "owns" the job and does the
// real fetch calls; every other tab just mirrors the broadcasted progress.
// Files never cross the BroadcastChannel, only plain progress numbers -
// there'd be no way for a second tab to actually perform someone else's
// upload anyway, it only needs to know how it's going.
const CHANNEL_NAME = 'mws-bulk-photo-upload'
let channel = null
function getChannel() {
  if (channel === null && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
  }
  return channel
}

let state = null
let isOwner = false
const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

function setState(patch) {
  state = state && patch ? { ...state, ...patch } : patch
  notify()
  if (isOwner) getChannel()?.postMessage({ type: 'state', payload: state })
}

export function subscribeBulkPhotoUpload(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBulkPhotoUploadState() {
  return state
}

// Call once near the app root. Lets a freshly-opened tab pick up an
// upload that's already running in another tab, and keeps every tab's
// mirrored state in sync as it progresses.
export function initBulkPhotoUploadSync() {
  const ch = getChannel()
  if (!ch) return () => {}

  function handleMessage(event) {
    const { type, payload } = event.data || {}
    if (type === 'state' && !isOwner) {
      state = payload
      notify()
    } else if (type === 'request-state' && isOwner && state) {
      ch.postMessage({ type: 'state', payload: state })
    }
  }

  ch.addEventListener('message', handleMessage)
  ch.postMessage({ type: 'request-state' })
  return () => ch.removeEventListener('message', handleMessage)
}

export function useBulkPhotoUploadState() {
  return useSyncExternalStore(subscribeBulkPhotoUpload, getBulkPhotoUploadState)
}

// entries: [{ mapping, file, size }]
// commitFn(mappings, files) -> Promise<{ success_count, failed_count, items }>
// chunkFn(entries) -> entries[][], each chunk kept under the server's
// per-request size/count limits (see fileSize.js's chunkBulkUploadEntries).
export async function startBulkPhotoUpload({ kind, label, entries, commitFn, chunkFn }) {
  if (state && state.status === 'running') {
    throw new Error('An upload is already in progress. Wait for it to finish first.')
  }

  isOwner = true
  const chunks = chunkFn(entries)
  setState({
    kind,
    label,
    total: entries.length,
    completed: 0,
    failed: 0,
    currentBatch: 0,
    totalBatches: chunks.length,
    status: 'running',
    result: null,
  })

  const combined = { success_count: 0, failed_count: 0, items: [] }
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    setState({ currentBatch: i + 1 })
    try {
      const chunkResult = await commitFn(
        chunk.map((entry) => entry.mapping),
        chunk.map((entry) => entry.file),
      )
      combined.success_count += chunkResult.success_count
      combined.failed_count += chunkResult.failed_count
      combined.items.push(...chunkResult.items)
    } catch (error) {
      // This batch's whole request failed (network error, server down
      // mid-way, etc.) - count every file in it as failed instead of
      // losing track of them, and keep going with the rest.
      combined.failed_count += chunk.length
      combined.items.push(
        ...chunk.map((entry) => ({
          id: entry.mapping.file_name,
          status: 'FAILED',
          error: error?.message || 'Upload failed',
        })),
      )
    }
    setState({ completed: combined.success_count + combined.failed_count })
  }

  setState({ status: combined.failed_count > 0 && combined.success_count === 0 ? 'error' : 'done', result: combined })
  isOwner = false
  return combined
}

export function clearBulkPhotoUpload() {
  if (state?.status === 'running') return
  setState(null)
}
