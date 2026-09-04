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

// The two-mode mentor picker used by PCActivityMentorsDialog (Manage
// Mentors).
export function MentorModeFields({
  mode,
  onModeChange,
  units,
  teachingEmployees,
  disabled,
  allValue,
  onAllChange,
  perUnitValue,
  onPerUnitChange,
  // A unit-scoped DATABASE_ADMIN only ever has one unit to manage, so
  // "one mentor for all units" (a cross-unit action) isn't a real choice
  // for them - hide the toggle entirely and stay in per-unit view.
  allowAllUnitsMode = true,
  // (unitId) => { name, unitName } | null - set when that unit's current
  // mentor isn't in teachingEmployees (a cross-unit assignment a
  // unit-scoped picker can't offer as a selectable option). Renders a
  // read-only row instead of a dropdown that would otherwise show blank.
  readOnlyMentorInfo,
}) {
  return (
    <div className="space-y-4">
      {allowAllUnitsMode ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--mws-line)] p-3">
            <input
              type="radio"
              name="pc-activity-mentor-mode"
              checked={mode === 'all'}
              onChange={() => onModeChange('all')}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="block font-display font-bold text-[var(--mws-charcoal)]">
                One mentor for all units
              </span>
              <span className="block text-xs text-[var(--mws-muted)]">
                Same person everywhere.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--mws-line)] p-3">
            <input
              type="radio"
              name="pc-activity-mentor-mode"
              checked={mode === 'per-unit'}
              onChange={() => onModeChange('per-unit')}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="block font-display font-bold text-[var(--mws-charcoal)]">
                Per unit
              </span>
              <span className="block text-xs text-[var(--mws-muted)]">
                Different mentor per unit.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {mode === 'all' && allowAllUnitsMode ? (
        <SearchableSelect
          value={allValue}
          onChange={onAllChange}
          disabled={disabled}
          options={mentorOptionsFor(teachingEmployees)}
          placeholder="No default mentor"
          searchPlaceholder="Search Employee"
          searchableThreshold={1}
        />
      ) : (
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
                        Assigned by an admin outside your unit - only a Super
                        Admin can change this.
                      </p>
                    </div>
                  ) : (
                    <SearchableSelect
                      value={perUnitValue(unit.id)}
                      onChange={(mentorId) => onPerUnitChange(unit.id, mentorId)}
                      disabled={disabled}
                      options={mentorOptionsFor(teachingEmployees)}
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
      )}
    </div>
  )
}
