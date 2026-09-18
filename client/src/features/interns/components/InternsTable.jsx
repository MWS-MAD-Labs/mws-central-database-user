import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { FlagBadgeList } from '../../../components/ui/FlagBadgeList.jsx'
import { StatusBadge } from '../../../components/ui/StatusBadge.jsx'
import { cn } from '../../../lib/cn.js'
import {
  formatDate,
  formatStatus,
  getInternFlagBadges,
  statusTone,
} from '../../../lib/format.js'

export function InternsTable({
  interns,
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
    () => buildColumns({
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

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: interns,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange,
  })

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <table className="w-full min-w-[800px] text-left text-sm">
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3">
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left hover:text-(--mws-burgundy)"
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
              <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={columns.length}>
                Preparing intern records...
              </td>
            </tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-(--mws-muted)" colSpan={columns.length}>
                No interns are ready to review.
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
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
                aria-label="Select All Interns"
                onChange={onToggleAll}
                className="size-4 rounded border-(--mws-line) accent-(--mws-burgundy)"
              />
            ),
            enableSorting: false,
            cell: ({ row }) => (
              <input
                type="checkbox"
                checked={selectedIds?.has(row.original.id) || false}
                aria-label={`Select ${row.original.identity.full_name}`}
                onChange={() => onToggleSelected?.(row.original.id)}
                className="size-4 rounded border-(--mws-line) accent-(--mws-burgundy)"
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
        const flagBadges = getInternFlagBadges(row.original)
        const [primaryFlag] = flagBadges
        return (
          <div className="min-w-0">
            <p
              className={cn(
                'max-w-72 truncate font-display font-bold',
                primaryFlag ? primaryFlag.textClass : 'text-(--mws-charcoal)',
              )}
              title={flagBadges.map((flag) => flag.title).join(' ')}
            >
              {row.original.identity.full_name}
              <FlagBadgeList badges={flagBadges} />
            </p>
            <p className="max-w-72 truncate text-xs text-(--mws-muted)">
              {row.original.identity.email}
            </p>
          </div>
        )
      },
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
      accessorKey: 'employment.end_date',
      id: 'end_date',
      header: 'End Date',
      enableSorting: true,
      cell: ({ row }) => formatDate(row.original.employment.end_date),
    },
    {
      accessorKey: 'status',
      id: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {formatStatus(row.original.status)}
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
            <Link to={`/interns/${row.original.id}`}>
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
