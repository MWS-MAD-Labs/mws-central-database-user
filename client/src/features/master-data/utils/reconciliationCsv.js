export const GROUPS = [
  { key: 'only_in_central', label: 'Only In Central' },
  { key: 'only_in_google', label: 'Only In Google' },
  { key: 'not_linked', label: 'Not Linked' },
  { key: 'email_differs', label: 'Email Differs' },
  { key: 'name_differs', label: 'Name Differs' },
  { key: 'should_be_suspended', label: 'Should Be Suspended' },
  { key: 'suspended_in_google', label: 'Suspended In Google' },
  { key: 'link_broken', label: 'Link Broken' },
]

const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`

// One line per row, so the report opens in a spreadsheet.
export function reconciliationCsv(report) {
  const lines = ['section,type,name,email,detail']
  for (const group of GROUPS) {
    for (const row of report.groups[group.key]?.rows ?? []) {
      lines.push([group.label, row.type, row.name, row.email, row.detail].map(quote).join(','))
    }
  }
  return lines.join('\n')
}

