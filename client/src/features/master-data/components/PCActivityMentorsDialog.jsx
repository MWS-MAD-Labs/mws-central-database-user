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
export function PCActivityMentorsDialog({
  activity,
  canWrite,
  onClose,
  // A unit-scoped DATABASE_ADMIN's own unit - restricts this dialog to
  // just that one unit's row and hides "one mentor for all units" (a
  // cross-unit action). Undefined/null for a Super Admin, who manages
  // every unit.
  restrictToUnitId,
}) {
  const [mode, setMode] = useState(restrictToUnitId ? 'per-unit' : 'all')
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

  const allUnits = distinctGradeUnits(gradesQuery.data?.data || [])
  const units = restrictToUnitId
    ? allUnits.filter((unit) => unit.id === restrictToUnitId)
    : allUnits
  const defaultMentors = defaultMentorsQuery.data || []
  const isLoading =
    gradesQuery.isLoading || defaultMentorsQuery.isLoading || mentorOptionsQuery.isLoading
  // A DATABASE_ADMIN whose own unit isn't one with any grades (e.g. a
  // support unit like BRIDGE, not Kindergarten/Elementary/Junior High) -
  // PC activity mentors genuinely don't apply to them, not an empty state
  // worth a form.
  const outOfScope = Boolean(restrictToUnitId) && !isLoading && units.length === 0
  const currentMentorId = (unitId) =>
    defaultMentors.find((row) => row.unit_id === unitId)?.mentor_id || ''
  // A DATABASE_ADMIN's mentor picker only offers their own unit's teaching
  // staff (useMentorOptions relies on employeesApi.list(), which the
  // backend itself always scopes to the requester's unit for a non-Super-
  // Admin) - so a mentor from a different unit (e.g. a Kindergarten teacher
  // set as a Junior High activity's mentor by a Super Admin) never shows up
  // as a selectable option here. Read-only in that case, not an editable
  // dropdown that would otherwise render blank for a value it can't find -
  // only a Super Admin (who sees every unit's staff) can change it.
  const readOnlyMentorInfo = (unitId) => {
    const row = defaultMentors.find((r) => r.unit_id === unitId)
    if (!row) return null
    if (teachingEmployees.some((employee) => employee.id === row.mentor_id)) return null
    return { name: row.mentor_name, unitName: row.mentor_unit_name }
  }

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

  // Blank (not a guess) unless every unit currently agrees on the same
  // mentor - showing one specific person when units actually differ would
  // look like they'd already been unified.
  const allCurrentMentorId =
    units.length > 0 && units.every((unit) => currentMentorId(unit.id))
      ? [...new Set(units.map((unit) => currentMentorId(unit.id)))].length === 1
        ? currentMentorId(units[0].id)
        : ''
      : ''

  const changedCount =
    mode === 'all'
      // Re-picking the same person already set everywhere isn't a change -
      // Save should stay disabled instead of writing a no-op mutation (and
      // a fresh history row) for it.
      ? allDraft !== null && allDraft !== allCurrentMentorId
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

  return (
    <CrudDialog
      title={`${activity.name} Mentors`}
      onClose={onClose}
      panelClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={outOfScope || !canWrite || !hasChanges || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <p className="py-6 text-center text-sm text-[var(--mws-muted)]">Loading...</p>
      ) : outOfScope ? (
        <p className="py-6 text-center text-sm text-[var(--mws-muted)]">
          PC Activity mentors don&apos;t apply to your unit - only Kindergarten,
          Elementary, and Junior High have grades.
        </p>
      ) : (
        <MentorModeFields
          mode={mode}
          onModeChange={switchMode}
          units={units}
          teachingEmployees={teachingEmployees}
          disabled={!canWrite || saveMutation.isPending}
          allowAllUnitsMode={!restrictToUnitId}
          readOnlyMentorInfo={readOnlyMentorInfo}
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
