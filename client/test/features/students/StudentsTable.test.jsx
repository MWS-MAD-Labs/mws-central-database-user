import { describe, expect, it, mock } from 'bun:test'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/render.jsx'
import { studentListItem } from '../../fixtures/students.js'
import { StudentsTable } from '../../../src/features/students/components/StudentsTable.jsx'

function renderTable(overrides = {}) {
  const props = {
    students: [studentListItem()],
    yearsById: { 'year-2025': '2025/2026' },
    sortBy: 'created_at',
    sortOrder: 'desc',
    onSort: mock(() => {}),
    isLoading: false,
    isTrash: false,
    canRestore: false,
    restoringId: null,
    onRestore: mock(() => {}),
    canSelect: true,
    selectedIds: new Set(),
    onToggleSelected: mock(() => {}),
    onToggleAll: mock(() => {}),
    allSelected: false,
    ...overrides,
  }
  return { ...renderWithProviders(<StudentsTable {...props} />), props }
}

describe('StudentsTable', () => {
  it('renders loading and empty states with the correct column span', () => {
    const { rerender, props } = renderTable({ students: [], isLoading: true })
    expect(screen.getByText('Preparing student records...').closest('td')).toHaveAttribute('colspan', '8')

    rerender(<StudentsTable {...props} isLoading={false} canSelect={false} />)
    expect(screen.getByText('No students are ready to review.').closest('td')).toHaveAttribute('colspan', '7')
  })

  it('renders identity, academics, status, flags, and detail links', () => {
    renderTable({
      students: [studentListItem({
        status: 'GRADUATED',
        identity: { has_birth_date_warning: true },
        academic: {
          nis: null,
          nisn: null,
          has_class_history: false,
          import_defaulted_fields: ['religion'],
        },
      })],
    })

    expect(screen.getByText('Ari Student')).toBeVisible()
    expect(screen.getByText('Auto-Filled')).toBeVisible()
    expect(screen.getByText('Dates')).toBeVisible()
    expect(screen.getByText('No NIS yet')).toBeVisible()
    expect(screen.getByText('Graduated')).toBeVisible()
    expect(screen.getByText('No class history')).toBeVisible()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', '/students/student-1')
    expect(screen.getByRole('link', { name: 'Grade 1A' })).toHaveAttribute('href', '/academic/classes/class-1')
  })

  it('handles sorting and row selection', async () => {
    const { user, props } = renderTable()
    await user.click(screen.getByRole('button', { name: 'Name' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Ari Student' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select All Students' }))

    expect(props.onSort).toHaveBeenCalledWith('full_name', 'asc')
    expect(props.onToggleSelected).toHaveBeenCalledWith('student-1')
    expect(props.onToggleAll).toHaveBeenCalledTimes(1)
  })

  it('renders restore actions in trash mode', async () => {
    const { user, props } = renderTable({ isTrash: true, canRestore: true })
    await user.click(screen.getByRole('button', { name: /Restore/ }))
    expect(props.onRestore).toHaveBeenCalledWith('student-1')
  })

  it('disables restore while the row is being restored', () => {
    renderTable({ isTrash: true, canRestore: true, restoringId: 'student-1' })
    expect(screen.getByRole('button', { name: /Restore/ })).toBeDisabled()
  })
})
