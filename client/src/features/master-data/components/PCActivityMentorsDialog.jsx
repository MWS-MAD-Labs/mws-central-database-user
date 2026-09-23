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
import { workforceTargetValue } from '../../academic/utils/selectOptions.js'

export function PCActivityMentorsDialog({
  activity,
  canWrite,
  onClose,
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
  const outOfScope = Boolean(restrictToUnitId) && !isLoading && units.length === 0
  const currentMentorId = (unitId) =>
    (() => {
      const row = defaultMentors.find((entry) => entry.unit_id === unitId)
      return row?.workforce_member
        ? workforceTargetValue(row.workforce_member.type, row.workforce_member.id)
        : ''
    })()
  const readOnlyMentorInfo = (unitId) => {
    const row = defaultMentors.find((r) => r.unit_id === unitId)
    if (!row) return null
    if (teachingEmployees.some((employee) => workforceTargetValue(employee.workforce_type || 'EMPLOYEE', employee.id) === currentMentorId(unitId))) return null
    return {
      name: row.mentor_name,
      unitName: row.mentor_unit_name,
      id: row.workforce_member.id,
      type: row.workforce_member.type,
    }
  }
  const mentorName = (mentorId, unitId) => {
    if (!mentorId) return 'No mentor'
    const currentRow = unitId && defaultMentors.find((row) => row.unit_id === unitId)
    if (currentRow && currentRow.mentor_id === mentorId) return currentRow.mentor_name
    const employee = teachingEmployees.find(
      (candidate) =>
        workforceTargetValue(candidate.workforce_type || 'EMPLOYEE', candidate.id) === mentorId,
    )
    return employee?.identity.full_name || 'Unknown'
  }

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
        <div className="w-full overflow-x-auto rounded-xl border border-(--mws-line)">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
              <tr>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Current mentor</th>
                <th className="px-3 py-2">New mentor</th>
              </tr>
            </thead>
            <tbody>
              {changeLines.map((line) => (
                <tr key={line.unitName} className="border-t border-(--mws-line)">
                  <td className="px-3 py-2 font-semibold text-(--mws-charcoal)">
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
        <p className="py-6 text-center text-sm text-(--mws-muted)">Loading...</p>
      ) : outOfScope ? (
        <p className="py-6 text-center text-sm text-(--mws-muted)">
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
