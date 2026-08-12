export function LoadingRows({ isLoading, isEmpty, colSpan, label }) {
  if (isLoading) {
    return (
      <tr>
        <td
          className="px-4 py-10 text-center text-[var(--mws-muted)]"
          colSpan={colSpan}
        >
          Loading {label}...
        </td>
      </tr>
    )
  }

  if (isEmpty) {
    return (
      <tr>
        <td
          className="px-4 py-10 text-center text-[var(--mws-muted)]"
          colSpan={colSpan}
        >
          No {label} found.
        </td>
      </tr>
    )
  }

  return null
}
