import { Lock } from 'lucide-react'

// Pre-save "review before saving" panel for Employee/Student/Intern
// create/edit forms - passed as a confirm() description. mode="update"
// shows Before -> After for changed fields only (buildChangedFieldEntries);
// mode="create" just lists the value (buildFilledFieldEntries). Fields are
// grouped into the sections each form declares (e.g. Identity, Employment,
// Sensitive) as a 2-column card grid rather than one long list, and the
// Sensitive section gets a lock badge since that's the data worth a second
// look before confirming.
export function ChangeReviewTable({ changes, mode = 'update', warning, fieldWarnings = {} }) {
  const isCreate = mode === 'create'
  const groups = groupBySection(changes)

  return (
    <div>
      {warning ? (
        <div className="mb-3 rounded-xl border border-[#e4b2a5] border-l-4 border-l-(--mws-burgundy) bg-[#fff4ed] px-3 py-2.5 text-sm text-[#7e1518]">
          {warning}
        </div>
      ) : null}
      <p className="mb-2 text-xs text-(--mws-muted)">
        {changes.length} field{changes.length === 1 ? '' : 's'}{' '}
        {isCreate ? 'will be set:' : 'will change:'}
      </p>
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        {groups.map((group) => (
          <div key={group.title}>
            <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-(--mws-muted) uppercase">
              {group.title === 'Sensitive' ? <Lock size={11} /> : null}
              {group.title}
            </h4>
            {isCreate ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.items.map((item) => (
                  <FieldCard
                    key={item.key}
                    item={item}
                    isCreate
                    sensitive={group.title === 'Sensitive'}
                    warning={fieldWarnings[item.key]}
                  />
                ))}
              </div>
            ) : (
              <UpdateFieldTable
                items={group.items}
                sensitive={group.title === 'Sensitive'}
                fieldWarnings={fieldWarnings}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function UpdateFieldTable({ items, sensitive, fieldWarnings }) {
  return (
    <div className="overflow-hidden rounded-xl border border-(--mws-line)">
      <div className="grid grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] bg-(--mws-soft) px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-(--mws-muted)">
        <span>Field</span>
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="divide-y divide-(--mws-line)">
        {items.map((item) => {
          const warning = fieldWarnings[item.key]
          return (
            <div
              key={item.key}
              className={
                'grid grid-cols-[minmax(8rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-3 text-xs ' +
                (warning
                  ? 'border-l-4 border-l-(--mws-burgundy) bg-[#fff4ed]'
                  : sensitive
                    ? 'border-l-4 border-l-[#a43c41] bg-white'
                    : 'bg-white')
              }
            >
              <div className="min-w-0">
                <p
                  className={
                    warning
                      ? 'font-semibold text-(--mws-burgundy)'
                      : 'font-semibold text-(--mws-charcoal)'
                  }
                >
                  {item.label}
                </p>
                {warning ? (
                  <p className="mt-1 leading-4 text-(--mws-burgundy)">{warning}</p>
                ) : null}
              </div>
              <p className="min-w-0 break-words text-(--mws-muted)">
                {item.before}
              </p>
              <p className="min-w-0 break-words font-semibold text-(--mws-charcoal)">
                {item.after}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FieldCard({ item, isCreate, sensitive, warning }) {
  return (
    <div
      className={
        'min-w-0 rounded-lg border p-2 ' +
        (warning
          ? 'border-[#e4b2a5] border-l-4 border-l-(--mws-burgundy) bg-[#fff4ed]'
          : sensitive
          ? 'border-(--mws-line) border-l-4 border-l-[#a43c41] bg-white'
          : isCreate
            ? 'border-(--mws-line) bg-(--mws-soft)'
            : 'border-(--mws-line) bg-[#fff4d8]')
      }
    >
      <p className={warning ? 'truncate text-[11px] font-semibold text-(--mws-burgundy)' : 'truncate text-[11px] font-medium text-(--mws-charcoal)'}>{item.label}</p>
      {warning ? <p className="mt-0.5 text-[11px] font-medium text-(--mws-burgundy)">{warning}</p> : null}
      {isCreate ? (
        <p className="mt-0.5 break-words text-xs font-semibold text-(--mws-charcoal)">{item.after}</p>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          <p className="break-words text-xs text-(--mws-muted)">{item.before}</p>
          <p className="break-words text-xs font-semibold text-(--mws-charcoal)">→ {item.after}</p>
        </div>
      )}
    </div>
  )
}

// Groups the flat entries list by `.section`, in the order each section is
// first seen - so a form only needs to declare its field->section map with
// fields in the order it wants sections to appear, nothing else to keep in
// sync.
function groupBySection(changes) {
  const order = []
  const buckets = new Map()

  changes.forEach((change) => {
    const section = change.section || 'Other'
    if (!buckets.has(section)) {
      buckets.set(section, [])
      order.push(section)
    }
    buckets.get(section).push(change)
  })

  return order.map((title) => ({ title, items: buckets.get(title) }))
}
