import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CrudDialog } from '../../../components/ui/CrudDialog.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { SearchableSelect } from '../../../components/ui/FormControls.jsx'
import { gradesApi } from '../../academic/api/academicApi.js'
import { pcActivityDefaultMentorsApi } from '../api/masterDataApi.js'
import { useMentorOptions } from '../hooks/useMentorOptions.js'

// Only units that actually have a grade (Kindergarten/Elementary/Junior
// High) can have students, so those are the only ones a PC activity's
// mentor can ever be relevant for - staff-only units (BRIDGE, Directorate,
// etc.) never show here. Derived from grades rather than listing units
// directly, since there's no "has students" flag on MasterUnit itself.
function distinctGradeUnits(grades) {
  const seen = new Map()
  for (const grade of grades) {
    if (grade.unit_id && !seen.has(grade.unit_id)) {
      seen.set(grade.unit_id, { id: grade.unit_id, name: grade.unit_name })
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Master Data > PC Activities > Mentors - one row per unit, each with its
// own default mentor for this activity (or none). The same activity name
// can suggest a different mentor per unit (e.g. Elementary's Chess Club
// coach isn't Junior High's), so this isn't a single field on the
// activity - see PCActivityDefaultMentor on the backend.
export function PCActivityMentorsDialog({ activity, canWrite, onClose }) {
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

  const setMutation = useMutation({
    mutationFn: ({ unitId, mentorId }) =>
      pcActivityDefaultMentorsApi.set(activity.id, unitId, mentorId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })
  const clearMutation = useMutation({
    mutationFn: (unitId) => pcActivityDefaultMentorsApi.clear(activity.id, unitId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const units = distinctGradeUnits(gradesQuery.data?.data || [])
  const defaultMentors = defaultMentorsQuery.data || []
  const isLoading = gradesQuery.isLoading || defaultMentorsQuery.isLoading
  const isSaving = setMutation.isPending || clearMutation.isPending

  // Picking "No default mentor" on a unit that never had one set is a
  // no-op, not a clear - calling clear() there just 404s (nothing to
  // delete) and surfaces as a confusing error toast for doing nothing.
  function handleChange(unitId, mentorId, hadExisting) {
    if (mentorId) setMutation.mutate({ unitId, mentorId })
    else if (hadExisting) clearMutation.mutate(unitId)
  }

  return (
    <CrudDialog
      title={`Mentors - ${activity.name}`}
      description="Mentor per unit"
      onClose={onClose}
      panelClassName="max-w-xl"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading ? (
        <p className="py-6 text-center text-sm text-[var(--mws-muted)]">Loading...</p>
      ) : (
        <div className="space-y-3">
          {units.map((unit) => {
            const current = defaultMentors.find((row) => row.unit_id === unit.id)
            return (
              <div key={unit.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-sm font-semibold text-[var(--mws-charcoal)]">
                  {unit.name}
                </span>
                <div className="min-w-0 flex-1">
                  <SearchableSelect
                    value={current?.mentor_id || ''}
                    onChange={(mentorId) =>
                      handleChange(unit.id, mentorId, Boolean(current))
                    }
                    disabled={!canWrite || isSaving}
                    options={[
                      { value: '', label: 'No default mentor' },
                      ...teachingEmployees.map((employee) => ({
                        value: employee.id,
                        label: employee.identity.full_name,
                        description: employee.identity.email,
                        badge: employee.employment.job_position,
                      })),
                    ]}
                    placeholder="No default mentor"
                    searchPlaceholder="Search Employee"
                    searchableThreshold={1}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CrudDialog>
  )
}
