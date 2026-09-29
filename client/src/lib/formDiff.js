import { formatDiffValue, formatStatus } from './format.js'

// Diffs a form's initial vs current values for a pre-save review dialog -
// see ChangeReviewTable.jsx for the presentational half. Only changed keys
// are returned. Display order is "section first seen, in `values`' own key
// order" - see ChangeReviewTable's groupBySection, which is why getting a
// sensible section order just means declaring `sections` in the order you
// want it grouped, nothing extra to maintain.
export function buildChangedFieldEntries(
  initialValues,
  values,
  { labels = {}, resolveValue, excludeKeys = [], sections = {} } = {},
) {
  const excluded = new Set(excludeKeys)
  return Object.keys(values)
    .filter((key) => !excluded.has(key))
    .filter((key) => JSON.stringify(values[key]) !== JSON.stringify(initialValues[key]))
    .map((key) => ({
      key,
      label: labels[key] || formatStatus(key),
      section: sections[key] || 'Other',
      before: resolveValue ? resolveValue(key, initialValues[key]) : formatDiffValue(initialValues[key]),
      after: resolveValue ? resolveValue(key, values[key]) : formatDiffValue(values[key]),
    }))
}

// Create-mode counterpart to buildChangedFieldEntries: no "before" to diff
// against, so this lists every field (filled or not - an empty field is
// still useful to see nothing was missed before creating).
export function buildFilledFieldEntries(
  values,
  { labels = {}, resolveValue, excludeKeys = [], sections = {} } = {},
) {
  const excluded = new Set(excludeKeys)
  return Object.keys(values)
    .filter((key) => !excluded.has(key))
    .map((key) => ({
      key,
      label: labels[key] || formatStatus(key),
      section: sections[key] || 'Other',
      after: resolveValue ? resolveValue(key, values[key]) : formatDiffValue(values[key]),
    }))
}

// Common shape for a form's resolveValue: known *_id fields display the
// matching option's name instead of a raw id, a field with its own display
// formatter (e.g. education_level's "SMA/SMK", entry_type's "Pre-K") uses
// that instead of the generic enum-label guesser, everything else falls
// back to formatDiffValue. `idFieldOptionKeys` maps a values field name to
// the key in `options` holding its {id, name} list (e.g. { unit_id: 'units' }).
// A `*_ids` array field (e.g. pc_mentor_unit_ids) works the same way - each
// id in the array is resolved against the same options list and joined.
// `fieldFormatters` maps a values field name straight to a `(value) => string`
// formatter, for the fields formatDiffValue's generic ENUM_LIKE guess would
// get wrong.
export function makeOptionAwareResolver(options, idFieldOptionKeys, fieldFormatters = {}) {
  return function resolveValue(key, rawValue) {
    const formatter = fieldFormatters[key]
    if (formatter) return formatter(rawValue)

    const optionsKey = idFieldOptionKeys[key]
    if (optionsKey) {
      const list = options[optionsKey] || []
      if (Array.isArray(rawValue)) {
        if (rawValue.length === 0) return '(none)'
        return rawValue
          .map((id) => list.find((option) => option.id === id)?.name || id)
          .join(', ')
      }
      const match = list.find((option) => option.id === rawValue)
      if (match) return match.name
    }
    return formatDiffValue(rawValue)
  }
}
