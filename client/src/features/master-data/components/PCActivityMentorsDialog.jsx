import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { gradesApi } from '../../academic/api/academicApi.js'
import { pcActivityDefaultMentorsApi } from '../api/masterDataApi.js'
import { useMentorOptions } from '../hooks/useMentorOptions.js'
import { showSuccessToast } from '../../../lib/toast.js'
import { distinctGradeUnits } from '../utils/pcActivityUnits.js'
import { MentorModeFields } from './MentorModeFields.jsx'
import { PCActivityMentorHistoryPanel } from './PCActivityMentorHistoryPanel.jsx'

// Master Data > PC Activities > Mentors - per-unit default mentor for this
// activity (or none). The same activity name can suggest a different
// mentor per unit (e.g. Elementary's Chess Club coach isn't Junior
// High's), so this isn't a single field on the activity - see
// PCActivityDefaultMentor on the backend. Most schools just want one
// person everywhere though, so "one mentor for all units" is the default
// view here - "Per unit" is there for the cases that actually need it.
//
// Picks staged here, not applied until Save - this changes which teacher
// pre-fills for every student assigned this activity in a unit, so a
// stray click on the dropdown shouldn't be able to reassign that on its
// own the way an instant-apply-on-select would.
export function PCActivityMentorsDialog({ activity, canWrite, onClose }) {
  const [mode, setMode] = useState('all')
  // null = untouched this session (mode-scoped - switching mode discards
  // the other mode's draft, since they're different actions).
  const [allDraft, setAllDraft] = useState(null)
  const [perUnitDraft, setPerUnitDraft] = useState({})
  const queryClient = useQueryClient()
  const queryKey = ['pc-activity-default-mentors', activity.id]

  const gradesQuery = useQuery({
    queryKey: ['master-data', 'grades', 'all'],
    queryFn: () => gradesApi.list({ page: 1, size: 100 }),
  })
  const defaultMentorsQuery = useQuery({
    queryKey,
    queryFn: () => pcActivityDefaultMentorsApi.list(activity.id),
  })
  const mentorOptionsQuery = useMentorOptions(true)
  const teachingEmployees = mentorOptionsQuery.data?.teachingEmployees || []

  const units = distinctGradeUnits(gradesQuery.data?.data || [])
  const defaultMentors = defaultMentorsQuery.data || []
  const isLoading = gradesQuery.isLoading || defaultMentorsQuery.isLoading
  const currentMentorId = (unitId) =>
    defaultMentors.find((row) => row.unit_id === unitId)?.mentor_id || ''

  // One call per changed unit (set or clear) - there's no bulk endpoint.
  // Skips a clear() for a unit that's already unset in either mode -
  // calling clear() there just 404s (nothing to delete) and would surface
  // as a confusing error toast for doing nothing.
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'all') {
        if (allDraft) {
          await Promise.all(
            units.map((unit) =>
              pcActivityDefaultMentorsApi.set(activity.id, unit.id, allDraft),
            ),
          )
        } else {
          const unitsWithDefault = units.filter((unit) => currentMentorId(unit.id))
          await Promise.all(
            unitsWithDefault.map((unit) =>
              pcActivityDefaultMentorsApi.clear(activity.id, unit.id),
            ),
          )
        }
        return
      }

      const changedUnitIds = Object.keys(perUnitDraft).filter(
        (unitId) => perUnitDraft[unitId] !== currentMentorId(unitId),
      )
      await Promise.all(
        changedUnitIds.map((unitId) => {
          const mentorId = perUnitDraft[unitId]
          return mentorId
            ? pcActivityDefaultMentorsApi.set(activity.id, unitId, mentorId)
            : pcActivityDefaultMentorsApi.clear(activity.id, unitId)
        }),
      )
    },
    onSuccess: () => {
      // Broader than queryKey itself - also catches the Master Data
      // table's batch query (['pc-activity-default-mentors', 'batch', ...]),
      // so its "Mentor" column reflects this save too.
      queryClient.invalidateQueries({ queryKey: ['pc-activity-default-mentors'] })
      queryClient.invalidateQueries({
        queryKey: ['pc-activity-mentor-history', activity.id],
      })
      showSuccessToast('Mentors saved.')
      setAllDraft(null)
      setPerUnitDraft({})
    },
  })

  const changedCount =
    mode === 'all'
      ? allDraft !== null
        ? 1
        : 0
      : Object.keys(perUnitDraft).filter(
          (unitId) => perUnitDraft[unitId] !== currentMentorId(unitId),
        ).length
  const hasChanges = changedCount > 0

  function switchMode(nextMode) {
    setMode(nextMode)
    setAllDraft(null)
    setPerUnitDraft({})
  }

  // Blank (not a guess) unless every unit currently agrees on the same
  // mentor - showing one specific person when units actually differ would
  // look like they'd already been unified.
  const allCurrentMentorId =
    units.length > 0 && units.every((unit) => currentMentorId(unit.id))
      ? [...new Set(units.map((unit) => currentMentorId(unit.id)))].length === 1
        ? currentMentorId(units[0].id)
        : ''
      : ''

  return (
    <CrudDialog
      title={`Mentors - ${activity.name}`}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canWrite || !hasChanges || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <p className="py-6 text-center text-sm text-[var(--mws-muted)]">Loading...</p>
      ) : (
        <MentorModeFields
          mode={mode}
          onModeChange={switchMode}
          units={units}
          teachingEmployees={teachingEmployees}
          disabled={!canWrite || saveMutation.isPending}
          allValue={allDraft !== null ? allDraft : allCurrentMentorId}
          onAllChange={setAllDraft}
          perUnitValue={(unitId) =>
            perUnitDraft[unitId] !== undefined ? perUnitDraft[unitId] : currentMentorId(unitId)
          }
          onPerUnitChange={(unitId, mentorId) =>
            setPerUnitDraft((current) => ({ ...current, [unitId]: mentorId }))
          }
        />
      )}
      <PCActivityMentorHistoryPanel activityId={activity.id} canWrite={canWrite} />
    </CrudDialog>
  )
}
