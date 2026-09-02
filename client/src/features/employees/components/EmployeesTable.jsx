import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import {
  formatDate,
  formatStatus,
  getContractExpiryFlag,
  getDisciplinaryFlagStyle,
  statusTone,
} from '../../../lib/format.js'
import { cn } from '../../../lib/cn.js'


export function EmployeesTable({
  employees,
  sorting,
  onSortingChange,
  isLoading,
  isTrash,
  canRestore,
  restoringId,
  onRestore,
  canSelect,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  allSelected,
}) {
  const columns = useMemo(
    () =>
      buildColumns({
        isTrash,
        canRestore,
        restoringId,
        onRestore,
        canSelect,
        selectedIds,
        onToggleSelected,
        onToggleAll,
        allSelected,
      }),
    [
      isTrash,
      canRestore,
      restoringId,
      onRestore,
      canSelect,
      selectedIds,
      onToggleSelected,
      onToggleAll,
      allSelected,
    ],
  )

  // TanStack Table intentionally returns table helpers/functions from this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: employees,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange,
  })

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3">
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 text-left',
                        'hover:text-[var(--mws-burgundy)]',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <SortIcon direction={header.column.getIsSorted()} />
                    </button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={columns.length}>
                Preparing employee records...
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--mws-muted)]" colSpan={columns.length}>
                No employees are ready to review.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function buildColumns({
  isTrash,
  canRestore,
  restoringId,
  onRestore,
  canSelect,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  allSelected,
}) {
  return [
  ...(canSelect
    ? [
        {
          id: 'select',
          header: () => (
            <input
              type="checkbox"
              checked={allSelected}
              aria-label="Select All Employees"
              onChange={onToggleAll}
              className="size-4 rounded border-[var(--mws-line)] text-[var(--mws-burgundy)] accent-[var(--mws-burgundy)] focus:ring-[var(--mws-burgundy)]"
            />
          ),
          enableSorting: false,
          cell: ({ row }) => (
            <input
              type="checkbox"
              checked={selectedIds?.has(row.original.id) || false}
              aria-label={`Select ${row.original.identity.full_name}`}
              onChange={() => onToggleSelected?.(row.original.id)}
              className="size-4 rounded border-[var(--mws-line)] text-[var(--mws-burgundy)] accent-[var(--mws-burgundy)] focus:ring-[var(--mws-burgundy)]"
            />
          ),
        },
      ]
    : []),
  {
    accessorKey: 'identity.full_name',
    id: 'full_name',
    header: 'Name',
    enableSorting: true,
    cell: ({ row }) => {
      const flagStyle = getDisciplinaryFlagStyle(row.original.disciplinary_flag)
      return (
        <div className="min-w-0">
          <p
            className={cn(
              'max-w-72 truncate font-display font-bold',
              flagStyle ? flagStyle.textClass : 'text-[var(--mws-charcoal)]',
            )}
            title={flagStyle?.title}
          >
            {row.original.identity.full_name}
            {flagStyle ? (
              <span className="ml-1.5 align-middle text-[10px] font-semibold">
                {flagStyle.label}
              </span>
            ) : null}
          </p>
          <p className="max-w-72 truncate text-xs text-[var(--mws-muted)]">
            {row.original.identity.email}
          </p>
        </div>
      )
    },
  },
  {
    accessorKey: 'employment.employee_id',
    id: 'employee_id',
    header: 'Employee ID',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="font-semibold text-[var(--mws-charcoal)]">
        {row.original.employment.employee_id}
      </span>
    ),
  },
  {
    accessorKey: 'employment.unit',
    header: 'Unit',
    enableSorting: false,
    cell: ({ row }) => row.original.employment.unit,
  },
  {
    accessorKey: 'employment.job_position',
    header: 'Position',
    enableSorting: false,
    cell: ({ row }) => row.original.employment.job_position,
  },
  {
    accessorKey: 'employment.building',
    id: 'building',
    header: 'Building',
    enableSorting: false,
    cell: ({ row }) => row.original.employment.building,
  },
  {
    accessorKey: 'employment.join_date',
    id: 'join_date',
    header: 'Join Date',
    enableSorting: true,
    cell: ({ row }) => formatDate(row.original.employment.join_date),
  },
  {
    accessorKey: 'status_info.employment_type',
    id: 'employment_type',
    header: 'Employment Type',
    enableSorting: false,
    cell: ({ row }) => {
      const contractFlag = getContractExpiryFlag(row.original)
      const colorClass =
        contractFlag === 'expired'
          ? 'font-semibold text-[#9f3d41]'
          : contractFlag === 'soon'
            ? 'font-semibold text-[var(--mws-burgundy)]'
            : ''
      return (
        <span
          className={colorClass}
          title={
            contractFlag === 'expired'
              ? 'Contract expired'
              : contractFlag === 'soon'
                ? 'Contract ending soon'
                : undefined
          }
        >
          {formatStatus(row.original.status_info.employment_type)}
        </span>
      )
    },
  },
  {
    accessorKey: 'status_info.status',
    id: 'status',
    header: 'Status',
    enableSorting: true,
    cell: ({ row }) => (
      <StatusBadge tone={statusTone(row.original.status_info.status)}>
        {formatStatus(row.original.status_info.status)}
      </StatusBadge>
    ),
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    cell: ({ row }) => {
      if (isTrash) {
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canRestore || restoringId === row.original.id}
            onClick={() => onRestore?.(row.original.id)}
          >
            <RotateCcw size={15} />
            Restore
          </Button>
        )
      }

      return (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/employees/${row.original.id}`}>
            <Eye size={15} />
            View
          </Link>
        </Button>
      )
    },
  },
  ]
}

function SortIcon({ direction }) {
  if (direction === 'asc') return <ArrowUp size={13} />
  if (direction === 'desc') return <ArrowDown size={13} />
  return <ArrowUpDown size={13} className="opacity-45" />
}
