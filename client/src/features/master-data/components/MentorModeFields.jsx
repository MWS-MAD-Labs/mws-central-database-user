import { Link } from 'react-router'
import { SearchableSelect } from '../../../components/ui/FormControls.jsx'
import { workforceTargetValue } from '../../academic/utils/selectOptions.js'

function mentorOptionsFor(teachingEmployees) {
  return [
    { value: '', label: 'No default mentor' },
    ...teachingEmployees.map((employee) => ({
      value: workforceTargetValue(employee.workforce_type || 'EMPLOYEE', employee.id),
      label: `${employee.identity.full_name}${employee.workforce_type === 'INTERN' ? ' (Intern)' : ''}`,
      description: employee.identity.email,
      badge: employee.employment.job_position,
    })),
  ]
}

export function MentorModeFields({
  units,
  eligibleForUnit,
  disabled,
  perUnitValue,
  onPerUnitChange,
  readOnlyMentorInfo,
}) {
  return (
    <div className="space-y-3">
      {units.map((unit) => {
        const outOfScope = readOnlyMentorInfo?.(unit.id)
        return (
          <div key={unit.id} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm font-semibold text-(--mws-charcoal)">
              {unit.name}
            </span>
            <div className="min-w-0 flex-1">
              {outOfScope ? (
                <div className="rounded-xl border border-(--mws-line) bg-(--mws-soft) px-3 py-2">
                  <p className="truncate text-sm font-semibold text-(--mws-charcoal)">
                    <Link
                      to={
                        outOfScope.type === 'INTERN'
                          ? `/interns/${outOfScope.id}`
                          : `/employees/${outOfScope.id}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-(--mws-burgundy) hover:underline"
                    >
                      {outOfScope.name}
                    </Link>{' '}
                    <span className="font-normal text-(--mws-muted)">
                      ({outOfScope.unitName})
                    </span>
                  </p>
                  <p className="text-xs text-(--mws-muted)">
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
                  searchPlaceholder="Search Employee or Intern"
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
