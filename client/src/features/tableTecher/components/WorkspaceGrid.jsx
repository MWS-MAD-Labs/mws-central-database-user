import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { formatStatus, statusTone } from "../../../lib/format.js";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
const ROW_NUMBER_WIDTH = 56;
const OVERSCAN = 8;
const MIN_COLUMN_WIDTH = 80;

// Read-only data grid for the workspace: fixed column widths, windowed rows,
// sticky header and first column, resizable columns, and a tooltip for values
// that don't fit. Cell rendering is driven by column metadata so the same grid
// works for students, enrollments, academic, and grades.
export function WorkspaceGrid({
  columns,
  rows,
  getRowId,
  getCellValue,
  rowNumberStart = 1,
  isLoading,
  isError,
  errorMessage,
  emptyMessage = "No rows to show.",
}) {
  const scrollRef = useRef(null);
  const resizeRef = useRef(null);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Local view preference only, never sent anywhere.
  const [widthOverrides, setWidthOverrides] = useState({});
  const [tooltip, setTooltip] = useState(null);

  const readCell = useCallback(
    (row, column) =>
      getCellValue ? getCellValue(row, column) : column.value(row),
    [getCellValue],
  );

  const widthOf = useCallback(
    (column) => widthOverrides[column.key] ?? column.width,
    [widthOverrides],
  );

  const totalWidth =
    ROW_NUMBER_WIDTH +
    columns.reduce((sum, column) => sum + widthOf(column), 0);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() =>
      setViewportHeight(element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowCount = rows.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (rowCount - endIndex) * ROW_HEIGHT);

  function startResize(event, column) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = widthOf(column);

    function handleMouseMove(moveEvent) {
      const nextWidth = Math.max(
        MIN_COLUMN_WIDTH,
        startWidth + moveEvent.clientX - startX,
      );
      setWidthOverrides((current) => ({ ...current, [column.key]: nextWidth }));
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("select-none");
      resizeRef.current = null;
    }

    resizeRef.current = column.key;
    document.body.classList.add("select-none");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function resetWidth(column) {
    setWidthOverrides((current) => {
      if (current[column.key] === undefined) return current;
      const next = { ...current };
      delete next[column.key];
      return next;
    });
  }

  // Tooltip only when the value is actually cut off, not on every cell.
  function handleCellEnter(event, text) {
    if (resizeRef.current || !text) return;

    const target = event.currentTarget.querySelector("[data-cell-text]");
    if (!target || target.scrollWidth <= target.clientWidth + 1) return;

    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({ text, top: rect.bottom + 4, left: rect.left });
  }

  const message = isError
    ? errorMessage || "Failed to load rows."
    : isLoading
      ? "Loading workspace rows..."
      : rowCount === 0
        ? emptyMessage
        : null;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="grid"
        aria-rowcount={rowCount}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setTooltip(null);
        }}
        className="min-h-0 min-w-0 flex-1 overflow-auto"
      >
        <table
          className="table-fixed border-separate border-spacing-0 text-left text-sm"
          style={{ width: totalWidth }}
        >
          <colgroup>
            <col style={{ width: ROW_NUMBER_WIDTH }} />
            {columns.map((column) => (
              <col key={column.key} style={{ width: widthOf(column) }} />
            ))}
          </colgroup>

          <thead className="font-display text-xs font-bold text-[var(--mws-muted)]">
            <tr style={{ height: HEADER_HEIGHT }}>
              <th className="sticky left-0 top-0 z-30 border-b border-r border-[var(--mws-line)] bg-[var(--mws-soft)] px-2 text-right">
                #
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ left: column.sticky ? ROW_NUMBER_WIDTH : undefined }}
                  className={cn(
                    "sticky top-0 z-20 border-b border-r border-[var(--mws-line)] bg-[var(--mws-soft)] px-3",
                    column.sticky && "z-30",
                  )}
                >
                  <span className="block truncate">{column.label}</span>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    title="Drag to resize, double click to reset"
                    onMouseDown={(event) => startResize(event, column)}
                    onDoubleClick={() => resetWidth(column)}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--mws-burgundy)]"
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {message ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className={cn(
                    "px-4 py-10 text-center",
                    isError
                      ? "text-[var(--mws-rose)]"
                      : "text-[var(--mws-muted)]",
                  )}
                >
                  {message}
                </td>
              </tr>
            ) : (
              <>
                {topSpacer > 0 ? (
                  <tr style={{ height: topSpacer }} aria-hidden="true">
                    <td colSpan={columns.length + 1} />
                  </tr>
                ) : null}

                {visibleRows.map((row, offset) => (
                  <tr
                    key={getRowId(row)}
                    style={{ height: ROW_HEIGHT }}
                    className="group"
                  >
                    <td className="sticky left-0 z-10 border-b border-r border-[var(--mws-line)] bg-white px-2 text-right text-xs tabular-nums text-[var(--mws-muted)] group-hover:bg-[var(--mws-soft)]">
                      {rowNumberStart + startIndex + offset}
                    </td>

                    {columns.map((column) => {
                      const value = readCell(row, column);

                      return (
                        <td
                          key={column.key}
                          style={{
                            left: column.sticky ? ROW_NUMBER_WIDTH : undefined,
                          }}
                          onMouseEnter={(event) =>
                            handleCellEnter(event, cellText(column, value))
                          }
                          onMouseLeave={() => setTooltip(null)}
                          className={cn(
                            "border-b border-r border-[var(--mws-line)] bg-white px-3 group-hover:bg-[var(--mws-soft)]",
                            column.numeric && "tabular-nums",
                            column.sticky &&
                              "sticky z-10 font-semibold text-[var(--mws-charcoal)]",
                          )}
                        >
                          <CellContent
                            column={column}
                            row={row}
                            value={value}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {bottomSpacer > 0 ? (
                  <tr style={{ height: bottomSpacer }} aria-hidden="true">
                    <td colSpan={columns.length + 1} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>

      {tooltip ? (
        <div
          role="tooltip"
          style={{
            top: tooltip.top,
            left: Math.min(tooltip.left, window.innerWidth - 340),
          }}
          className="pointer-events-none fixed z-50 max-w-80 rounded-lg bg-[var(--mws-charcoal)] px-3 py-2 text-xs text-white shadow-lg"
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  );
}

function CellContent({ column, row, value }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-[var(--mws-muted)]">-</span>;
  }

  if (column.type === "status") {
    return (
      <StatusBadge tone={statusTone(value)}>{formatStatus(value)}</StatusBadge>
    );
  }

  if (column.cellType === "link" && column.getHref) {
    return (
      <Link
        to={column.getHref(row)}
        data-cell-text
        className="block truncate text-[var(--mws-burgundy)] underline-offset-2 hover:underline"
      >
        {value}
      </Link>
    );
  }

  return (
    <span data-cell-text className="block truncate">
      {value}
    </span>
  );
}

function cellText(column, value) {
  if (value === null || value === undefined || value === "") return "";
  if (column.type === "status") return formatStatus(value);
  return String(value);
}
