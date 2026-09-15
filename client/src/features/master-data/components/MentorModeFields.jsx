import { SearchableSelect } from '../../../components/ui/FormControls.jsx'

function mentorOptionsFor(teachingEmployees) {
  return [
    { value: '', label: 'No default mentor' },
    ...teachingEmployees.map((employee) => ({
      value: employee.id,
      label: employee.identity.full_name,
      description: employee.identity.email,
      badge: employee.employment.job_position,
    })),
  ]
}

// The per-unit mentor picker used by PCActivityMentorsDialog (Manage
// Mentors). There's no "one mentor for all units" mode - a mentor is
// strictly scoped to their own unit (see assertMentorIsEligible on the
// backend), so no single person can ever validly cover more than one.
export function MentorModeFields({
  units,
  // (unitId) => Employee[] - teaching staff actually in that unit.
  eligibleForUnit,
  disabled,
  perUnitValue,
  onPerUnitChange,
  // (unitId) => { name, unitName } | null - set when that unit's current
  // mentor isn't in teachingEmployees (a cross-unit assignment a
  // unit-scoped picker can't offer as a selectable option). Renders a
  // read-only row instead of a dropdown that would otherwise show blank.
  readOnlyMentorInfo,
}) {
  return (
    <div className="space-y-3">
      {units.map((unit) => {
        const outOfScope = readOnlyMentorInfo?.(unit.id)
        return (
          <div key={unit.id} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm font-semibold text-[var(--mws-charcoal)]">
              {unit.name}
            </span>
            <div className="min-w-0 flex-1">
              {outOfScope ? (
                <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-3 py-2">
                  <p className="truncate text-sm font-semibold text-[var(--mws-charcoal)]">
                    {outOfScope.name}{' '}
                    <span className="font-normal text-[var(--mws-muted)]">
                      ({outOfScope.unitName})
                    </span>
                  </p>
                  <p className="text-xs text-[var(--mws-muted)]">
                    Assigned by an admin outside your unit. Only a Super
                    Admin can change this.
                  </p>
                </div>
              ) : (
                <SearchableSelect
                  value={perUnitValue(unit.id)}
                  onChange={(mentorId) => onPerUnitChange(unit.id, mentorId)}
                  disabled={disabled}
                  options={mentorOptionsFor(eligibleForUnit(unit.id))}
                  placeholder="No default mentor"
                  searchPlaceholder="Search Employee"
                  searchableThreshold={1}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
