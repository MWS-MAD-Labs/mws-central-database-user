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

// Shared by PCActivityMentorsDialog (Manage Mentors, editing an existing
// activity) and MasterDataDialog (the "Default Mentor" field on create) -
// same two-mode picker either way, just wired to different state: staged
// draft + explicit Save on the former, plain form values on the latter.
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
}) {
  return (
    <div className="space-y-4">
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

      {mode === 'all' ? (
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
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm font-semibold text-[var(--mws-charcoal)]">
                {unit.name}
              </span>
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={perUnitValue(unit.id)}
                  onChange={(mentorId) => onPerUnitChange(unit.id, mentorId)}
                  disabled={disabled}
                  options={mentorOptionsFor(teachingEmployees)}
                  placeholder="No default mentor"
                  searchPlaceholder="Search Employee"
                  searchableThreshold={1}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
