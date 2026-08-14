import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { cn } from "../../../lib/cn.js";
import { formatStatus, statusTone } from "../../../lib/format.js";
import { parseClipboardText, toClipboardText } from "../utils/gridClipboard.js";

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
const ROW_NUMBER_WIDTH = 56;
const OVERSCAN = 8;

// Generic spreadsheet grid: fixed column widths, windowed rows, cell
// selection, inline editing, keyboard nav, and TSV copy/paste.
// Edits are handed back through onCellCommit, the grid keeps no row state.
export function WorkspaceGrid({
  columns,
  rows,
  getRowId,
  getCellValue,
  onCellCommit,
  isCellDirty,
  rowNumberStart = 1,
  isLoading,
  isError,
  errorMessage,
  emptyMessage = "No rows to show.",
}) {
  const scrollRef = useRef(null);
  const isDraggingRef = useRef(false);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [active, setActive] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [editing, setEditing] = useState(null);

  const canEdit = Boolean(onCellCommit);
  const readCell = useCallback(
    (row, column) =>
      getCellValue ? getCellValue(row, column) : column.value(row),
    [getCellValue],
  );

  // Fixed widths mean every scroll position is plain arithmetic, which is
  // what keeps windowing and "scroll active cell into view" simple.
  const columnOffsets = useMemo(() => {
    const offsets = [];
    let offset = ROW_NUMBER_WIDTH;
    columns.forEach((column) => {
      offsets.push(offset);
      offset += column.width;
    });
    return offsets;
  }, [columns]);

  const totalWidth =
    ROW_NUMBER_WIDTH + columns.reduce((sum, column) => sum + column.width, 0);
  const frozenWidth =
    ROW_NUMBER_WIDTH + (columns[0]?.sticky ? columns[0].width : 0);

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

  useEffect(() => {
    function handleMouseUp() {
      isDraggingRef.current = false;
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // Rows shift under the selection (filter change, refetch), so the cells are
  // derived rather than stored - a stale index never renders or commits.
  const rowCount = rows.length;
  const activeCell = active && active.row < rowCount ? active : null;
  const anchorCell = anchor && anchor.row < rowCount ? anchor : null;
  const editingCell =
    editing &&
    editing.row < rowCount &&
    getRowId(rows[editing.row]) === editing.rowId
      ? editing
      : null;

  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN,
  );
  const endIndex = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(startIndex, endIndex);
  const topSpacer = startIndex * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (rowCount - endIndex) * ROW_HEIGHT);

  const selection = useMemo(() => {
    if (!activeCell || !anchorCell) return null;
    return {
      top: Math.min(activeCell.row, anchorCell.row),
      bottom: Math.max(activeCell.row, anchorCell.row),
      left: Math.min(activeCell.col, anchorCell.col),
      right: Math.max(activeCell.col, anchorCell.col),
    };
  }, [activeCell, anchorCell]);

  const scrollCellIntoView = useCallback(
    (rowIndex, colIndex) => {
      const element = scrollRef.current;
      if (!element) return;

      const top = rowIndex * ROW_HEIGHT;
      const visibleTop = element.scrollTop + HEADER_HEIGHT;
      const visibleBottom = element.scrollTop + element.clientHeight;
      if (top < visibleTop) {
        element.scrollTop = top - HEADER_HEIGHT;
      } else if (top + ROW_HEIGHT > visibleBottom) {
        element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
      }

      const left = columnOffsets[colIndex];
      const right = left + columns[colIndex].width;
      if (left < element.scrollLeft + frozenWidth) {
        element.scrollLeft = Math.max(0, left - frozenWidth);
      } else if (right > element.scrollLeft + element.clientWidth) {
        element.scrollLeft = right - element.clientWidth;
      }
    },
    [columnOffsets, columns, frozenWidth],
  );

  const focusGrid = useCallback(() => scrollRef.current?.focus(), []);

  const selectCell = useCallback(
    (rowIndex, colIndex, extend) => {
      setActive({ row: rowIndex, col: colIndex });
      if (!extend) setAnchor({ row: rowIndex, col: colIndex });
      scrollCellIntoView(rowIndex, colIndex);
    },
    [scrollCellIntoView],
  );

  const moveActive = useCallback(
    (rowDelta, colDelta, extend) => {
      if (rowCount === 0) return;

      const base = activeCell || { row: 0, col: 0 };
      const nextRow = clamp(base.row + rowDelta, 0, rowCount - 1);
      const nextCol = clamp(base.col + colDelta, 0, columns.length - 1);
      selectCell(nextRow, nextCol, extend);
    },
    [activeCell, columns.length, rowCount, selectCell],
  );

  const startEditing = useCallback(
    (cell, initialValue) => {
      if (!canEdit || !cell) return;

      const column = columns[cell.col];
      if (!column?.editable) return;

      const value =
        initialValue !== undefined
          ? initialValue
          : stringifyCell(column, readCell(rows[cell.row], column));

      setEditing({
        row: cell.row,
        col: cell.col,
        rowId: getRowId(rows[cell.row]),
        value,
      });
    },
    [canEdit, columns, getRowId, readCell, rows],
  );

  const commitEditing = useCallback(
    (rowDelta, colDelta) => {
      if (!editingCell) return;

      const column = columns[editingCell.col];
      onCellCommit?.({
        row: rows[editingCell.row],
        rowIndex: editingCell.row,
        column,
        value: editingCell.value,
      });
      setEditing(null);
      focusGrid();
      if (rowDelta || colDelta) moveActive(rowDelta, colDelta, false);
    },
    [columns, editingCell, focusGrid, moveActive, onCellCommit, rows],
  );

  const cancelEditing = useCallback(() => {
    setEditing(null);
    focusGrid();
  }, [focusGrid]);

  function clearSelectedCells() {
    if (!canEdit || !selection) return;

    for (let row = selection.top; row <= selection.bottom; row++) {
      for (let col = selection.left; col <= selection.right; col++) {
        const column = columns[col];
        if (!column.editable) continue;
        onCellCommit({ row: rows[row], rowIndex: row, column, value: "" });
      }
    }
  }

  function handleKeyDown(event) {
    if (editingCell || rowCount === 0) return;
    if (event.metaKey || event.ctrlKey) return;

    const extend = event.shiftKey;
    const pageRows = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1);

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1, 0, extend);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveActive(1, 0, extend);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveActive(0, -1, extend);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveActive(0, 1, extend);
        return;
      case "PageUp":
        event.preventDefault();
        moveActive(-pageRows, 0, extend);
        return;
      case "PageDown":
        event.preventDefault();
        moveActive(pageRows, 0, extend);
        return;
      case "Home":
        event.preventDefault();
        moveActive(0, -columns.length, extend);
        return;
      case "End":
        event.preventDefault();
        moveActive(0, columns.length, extend);
        return;
      case "Tab":
        event.preventDefault();
        moveActive(0, extend ? -1 : 1, false);
        return;
      case "Enter":
      case "F2":
        event.preventDefault();
        if (!activeCell) return;
        if (columns[activeCell.col]?.editable) {
          startEditing(activeCell);
        } else {
          moveActive(1, 0, false);
        }
        return;
      case "Escape":
        if (activeCell) setAnchor(activeCell);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        clearSelectedCells();
        return;
      default:
        break;
    }

    // Typing over a cell replaces it, same as a spreadsheet.
    if (event.key.length === 1 && !event.altKey && activeCell) {
      startEditing(activeCell, event.key);
      event.preventDefault();
    }
  }

  function handleCopy(event) {
    if (!selection) return;

    const matrix = [];
    for (let row = selection.top; row <= selection.bottom; row++) {
      const line = [];
      for (let col = selection.left; col <= selection.right; col++) {
        const column = columns[col];
        line.push(stringifyCell(column, readCell(rows[row], column)));
      }
      matrix.push(line);
    }

    event.clipboardData.setData("text/plain", toClipboardText(matrix));
    event.preventDefault();
  }

  function handlePaste(event) {
    if (!canEdit || !activeCell) return;

    const matrix = parseClipboardText(event.clipboardData.getData("text/plain"));
    if (matrix.length === 0) return;
    event.preventDefault();

    let lastRow = activeCell.row;
    let lastCol = activeCell.col;

    matrix.forEach((line, rowOffset) => {
      const rowIndex = activeCell.row + rowOffset;
      if (rowIndex >= rowCount) return;

      line.forEach((value, colOffset) => {
        const colIndex = activeCell.col + colOffset;
        if (colIndex >= columns.length) return;

        const column = columns[colIndex];
        lastRow = Math.max(lastRow, rowIndex);
        lastCol = Math.max(lastCol, colIndex);
        if (!column.editable) return;

        onCellCommit({ row: rows[rowIndex], rowIndex, column, value });
      });
    });

    setAnchor(activeCell);
    setActive({ row: lastRow, col: lastCol });
  }

  const message = isError
    ? errorMessage || "Failed to load rows."
    : isLoading
      ? "Loading workspace rows..."
      : rowCount === 0
        ? emptyMessage
        : null;

  return (
    <div
      ref={scrollRef}
      role="grid"
      tabIndex={0}
      aria-rowcount={rowCount}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
      className="min-h-0 min-w-0 flex-1 overflow-auto outline-none"
    >
      <table
        className="table-fixed border-separate border-spacing-0 text-left text-sm"
        style={{ width: totalWidth }}
      >
        <colgroup>
          <col style={{ width: ROW_NUMBER_WIDTH }} />
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>

        <thead className="font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr style={{ height: HEADER_HEIGHT }}>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-[var(--mws-line)] bg-[var(--mws-soft)] px-2 text-right">
              #
            </th>
            {columns.map((column, colIndex) => (
              <th
                key={column.key}
                style={{ left: column.sticky ? ROW_NUMBER_WIDTH : undefined }}
                className={cn(
                  "sticky top-0 z-20 truncate border-b border-r border-[var(--mws-line)] bg-[var(--mws-soft)] px-3",
                  column.sticky && "z-30",
                  selection &&
                    colIndex >= selection.left &&
                    colIndex <= selection.right &&
                    "text-[var(--mws-burgundy)]",
                )}
              >
                {column.label}
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

              {visibleRows.map((row, offset) => {
                const rowIndex = startIndex + offset;

                return (
                  <tr
                    key={getRowId(row)}
                    style={{ height: ROW_HEIGHT }}
                    className="group"
                  >
                    <td className="sticky left-0 z-10 border-b border-r border-[var(--mws-line)] bg-white px-2 text-right text-xs tabular-nums text-[var(--mws-muted)] group-hover:bg-[var(--mws-soft)]">
                      {rowNumberStart + rowIndex}
                    </td>

                    {columns.map((column, colIndex) => {
                      const isActive =
                        activeCell?.row === rowIndex &&
                        activeCell?.col === colIndex;
                      const isEditing =
                        editingCell?.row === rowIndex &&
                        editingCell?.col === colIndex;
                      const isSelected =
                        selection &&
                        rowIndex >= selection.top &&
                        rowIndex <= selection.bottom &&
                        colIndex >= selection.left &&
                        colIndex <= selection.right;
                      const isDirty = isCellDirty?.(row, column);

                      return (
                        <td
                          key={column.key}
                          style={{
                            left: column.sticky ? ROW_NUMBER_WIDTH : undefined,
                          }}
                          onMouseDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            isDraggingRef.current = true;
                            focusGrid();
                            selectCell(rowIndex, colIndex, event.shiftKey);
                          }}
                          onMouseEnter={() => {
                            if (!isDraggingRef.current || editingCell) return;
                            setActive({ row: rowIndex, col: colIndex });
                          }}
                          onDoubleClick={() =>
                            startEditing({ row: rowIndex, col: colIndex })
                          }
                          className={cn(
                            "relative truncate border-b border-r border-[var(--mws-line)] bg-white px-3 group-hover:bg-[var(--mws-soft)]",
                            column.numeric && "tabular-nums",
                            column.sticky &&
                              "sticky z-10 font-semibold text-[var(--mws-charcoal)]",
                            isSelected &&
                              "bg-[#7e15180d] group-hover:bg-[#7e15180d]",
                            isDirty &&
                              "bg-[#fff6e6] group-hover:bg-[#fff6e6]",
                            isActive &&
                              "outline outline-2 -outline-offset-2 outline-[var(--mws-burgundy)]",
                            canEdit && !column.editable && "text-[var(--mws-muted)]",
                          )}
                        >
                          {isEditing ? (
                            <CellEditor
                              value={editingCell.value}
                              onChange={(value) =>
                                setEditing((current) =>
                                  current ? { ...current, value } : current,
                                )
                              }
                              onCommit={commitEditing}
                              onCancel={cancelEditing}
                            />
                          ) : (
                            <CellContent
                              column={column}
                              value={readCell(row, column)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

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
  );
}

function CellEditor({ value, onChange, onCommit, onCancel }) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => onCommit(0, 0)}
      onKeyDown={(event) => {
        event.stopPropagation();

        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(1, 0);
        } else if (event.key === "Tab") {
          event.preventDefault();
          onCommit(0, event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      className="absolute inset-0 h-full w-full border-2 border-[var(--mws-burgundy)] bg-white px-3 text-sm text-[var(--mws-charcoal)] outline-none"
    />
  );
}

function CellContent({ column, value }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-[var(--mws-muted)]">-</span>;
  }

  if (column.type === "status") {
    return (
      <StatusBadge tone={statusTone(value)}>{formatStatus(value)}</StatusBadge>
    );
  }

  return value;
}

function stringifyCell(column, value) {
  if (value === null || value === undefined) return "";
  if (column.type === "status") return formatStatus(value);
  return String(value);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
