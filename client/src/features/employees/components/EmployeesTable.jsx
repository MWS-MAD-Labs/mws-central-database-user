import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Eye, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { formatDate, formatStatus, statusTone } from '../../../lib/format.js'
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
}) {
  const columns = useMemo(
    () => buildColumns({ isTrash, canRestore, restoringId, onRestore }),
    [isTrash, canRestore, restoringId, onRestore],
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-[#f3f3ee] text-xs font-semibold uppercase text-[#62676b]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3">
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 text-left',
                        header.column.getCanSort() &&
                          'hover:text-[#24463f]',
                      )}
                      disabled={!header.column.getCanSort()}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <SortIcon direction={header.column.getIsSorted()} />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td className="px-4 py-10 text-center text-[#77736a]" colSpan={columns.length}>
                Loading employees...
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[#77736a]" colSpan={columns.length}>
                No employees found.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-[#eceae3] bg-white hover:bg-[#fbfbf7]"
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

function buildColumns({ isTrash, canRestore, restoringId, onRestore }) {
  return [
  {
    accessorKey: 'identity.full_name',
    id: 'full_name',
    header: 'Name',
    enableSorting: true,
    cell: ({ row }) => (
      <div>
        <p className="font-semibold text-[#202326]">
          {row.original.identity.full_name}
        </p>
        <p className="text-xs text-[#676c70]">{row.original.identity.email}</p>
      </div>
    ),
  },
  {
    accessorKey: 'employment.employee_id',
    id: 'employee_id',
    header: 'Employee ID',
    enableSorting: true,
    cell: ({ row }) => (
      <span className="font-medium text-[#34383c]">
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
    enableSorting: true,
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
  return null
}
