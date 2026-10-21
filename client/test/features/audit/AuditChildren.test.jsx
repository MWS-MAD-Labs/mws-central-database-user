import { describe, expect, it } from 'bun:test'
import { screen } from '@testing-library/react'
import { AuditDiffTable } from '../../../src/features/audit/pages/AuditLogsPage.jsx'
import { renderWithProviders } from '../../helpers/render.jsx'

describe('children in the audit log', () => {
  it('reads an older entry that kept counts the same as the newer phrase', () => {
    renderWithProviders(
      <AuditDiffTable
        oldValues={{ children: { total: 1, under_23: 1, age_23_plus: 0, allowance_eligible: 1 } }}
        newValues={{ children: '2 children' }}
        resolvedLabels={{}}
      />,
    )
    expect(screen.getByText('1 child')).toBeVisible()
    expect(screen.getByText('2 children')).toBeVisible()
    expect(screen.queryByText(/under_23/)).not.toBeInTheDocument()
  })
})
