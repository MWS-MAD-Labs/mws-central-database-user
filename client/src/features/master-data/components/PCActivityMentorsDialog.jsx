import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { gradesApi } from '../../academic/api/academicApi.js'
import { pcActivityDefaultMentorsApi } from '../api/masterDataApi.js'
import { useMentorOptions } from '../hooks/useMentorOptions.js'
import { showSuccessToast } from '../../../lib/toast.js'
import { distinctGradeUnits } from '../utils/pcActivityUnits.js'
import { MentorModeFields } from './MentorModeFields.jsx'
import { PCActivityMentorHistoryPanel } from './PCActivityMentorHistoryPanel.jsx'

// Master Data > PC Activities > Mentors - per-unit default mentor for this
// activity (or none). A mentor is strictly scoped to their own unit (see
// assertMentorIsEligible on the backend), so this is always one row per
// unit the activity applies to - never a single "same person everywhere"
// field, since no one person can validly cover more than their own unit.
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
  // just that one unit's row. Undefined/null for a Super Admin, who
  // manages every unit.
  restrictToUnitId,
}) {
  const [perUnitDraft, setPerUnitDraft] = useState({})
  const queryClient = useQueryClient()
  const confirm = useConfirm()
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
  const eligibleForUnit = mentorOptionsQuery.data?.eligibleForUnit || (() => [])

  const academicUnits = distinctGradeUnits(gradesQuery.data?.data || [])
  // Further narrowed to the activity's own unit scope (Master Data >
  // PC Activities' Units checkbox) - an empty list there means "any unit",
  // so it doesn't narrow anything.
  const activityUnitIds = activity.units?.length
    ? new Set(activity.units.map((unit) => unit.id))
    : null
  const scopedUnits = activityUnitIds
    ? academicUnits.filter((unit) => activityUnitIds.has(unit.id))
    : academicUnits
  const units = restrictToUnitId
    ? scopedUnits.filter((unit) => unit.id === restrictToUnitId)
    : scopedUnits
  const defaultMentors = defaultMentorsQuery.data || []
  const isLoading =
    gradesQuery.isLoading || defaultMentorsQuery.isLoading || mentorOptionsQuery.isLoading
  // Either a DATABASE_ADMIN whose own unit isn't one with any grades (e.g.
  // a support unit like BRIDGE), or one whose unit isn't in this
  // activity's own unit scope - PC activity mentors genuinely don't apply
  // here, not an empty state worth a form.
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
  // Prefers the row already loaded for this unit (covers a cross-unit
  // mentor readOnlyMentorInfo above can't resolve from teachingEmployees),
  // falls back to the freshly-picked draft's own name otherwise.
  const mentorName = (mentorId, unitId) => {
    if (!mentorId) return 'No mentor'
    const currentRow = unitId && defaultMentors.find((row) => row.unit_id === unitId)
    if (currentRow && currentRow.mentor_id === mentorId) return currentRow.mentor_name
    const employee = teachingEmployees.find((candidate) => candidate.id === mentorId)
    return employee?.identity.full_name || 'Unknown'
  }

  // One call per changed unit (set or clear) - there's no bulk endpoint.
  const saveMutation = useMutation({
    mutationFn: async () => {
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
      setPerUnitDraft({})
    },
  })

  const changedCount = Object.keys(perUnitDraft).filter(
    (unitId) => perUnitDraft[unitId] !== currentMentorId(unitId),
  ).length
  const hasChanges = changedCount > 0

  // One line per unit actually changing (old mentor -> new mentor), so
  // Save's confirmation says exactly who's being replaced instead of a
  // blind "are you sure" - this changes which teacher pre-fills for every
  // student assigned this activity in that unit.
  function buildChangeLines() {
    return Object.keys(perUnitDraft)
      .filter((unitId) => perUnitDraft[unitId] !== currentMentorId(unitId))
      .map((unitId) => {
        const unit = units.find((candidate) => candidate.id === unitId)
        return {
          unitName: unit?.name || unitId,
          from: mentorName(currentMentorId(unitId), unitId),
          to: mentorName(perUnitDraft[unitId]),
        }
      })
  }

  async function handleSave() {
    const changeLines = buildChangeLines()
    const confirmed = await confirm({
      title: 'Confirm mentor change',
      wide: true,
      description: (
        <div className="w-full overflow-x-auto rounded-xl border border-[var(--mws-line)]">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
              <tr>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Current mentor</th>
                <th className="px-3 py-2">New mentor</th>
              </tr>
            </thead>
            <tbody>
              {changeLines.map((line) => (
                <tr key={line.unitName} className="border-t border-[var(--mws-line)]">
                  <td className="px-3 py-2 font-semibold text-[var(--mws-charcoal)]">
                    {line.unitName}
                  </td>
                  <td className="px-3 py-2">{line.from}</td>
                  <td className="px-3 py-2">{line.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
      confirmLabel: 'Save',
    })
    if (confirmed) {
      saveMutation.mutate()
    }
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
            onClick={handleSave}
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
          {activityUnitIds
            ? "PC Activity mentors don't apply to your unit - this activity is scoped to " +
              `${activity.units.map((unit) => unit.name).join(', ')}.`
            : "PC Activity mentors don't apply to your unit - only Kindergarten, Elementary, and Junior High have grades."}
        </p>
      ) : (
        <MentorModeFields
          units={units}
          eligibleForUnit={eligibleForUnit}
          disabled={!canWrite || saveMutation.isPending}
          readOnlyMentorInfo={readOnlyMentorInfo}
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
