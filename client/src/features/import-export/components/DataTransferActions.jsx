import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { ActionsMenu, ActionsMenuItem } from "../../../components/ui/ActionsMenu.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { DateField, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import {
  addMonthsToDateInput,
  capitalizeWords,
  CONTRACT_DURATION_OPTIONS,
} from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import { loadStudentFormOptions } from "../../students/api/studentFormOptions.js";
import { dataTransferApi, downloadBlob } from "../api/dataTransferApi.js";
import {
  defaultPreviewFields,
  entityLabels,
  FIELD_KEYSTROKE_FILTERS,
  FIELD_VALUE_ALIASES,
  IMPORT_FIELD_LABEL_TO_KEY,
  importFields,
  parseDateStringToISO,
  requiredImportFields,
} from "./importFieldsConfig.js";

export function DataTransferActions({
  entity,
  exportParams,
  canImport,
  canExport = true,
  canExportSensitive = false,
}) {
  const [isImportOpen, setIsImportOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={!canImport}
        onClick={() => setIsImportOpen(true)}
      >
        <Upload size={16} />
        Import
      </Button>
      <ExportMenu
        entity={entity}
        exportParams={exportParams}
        canExport={canExport}
        canExportSensitive={canExportSensitive}
      />

      {isImportOpen ? (
        <ImportDialog entity={entity} onClose={() => setIsImportOpen(false)} />
      ) : null}
    </div>
  );
}

function ExportMenu({ entity, exportParams, canExport, canExportSensitive }) {
  const confirm = useConfirm();
  const exportMutation = useMutation({
    mutationFn: ({ format, exportMode }) =>
      dataTransferApi.exportFile(entity, {
        ...exportParams,
        format,
        export_mode: exportMode,
      }),
    onSuccess: ({ blob, fileName }, variables) => {
      downloadBlob(blob, fileName || `${entityLabels[entity]}-export.${variables.format}`);
      showSuccessToast(`${variables.format.toUpperCase()}${variables.exportMode === "sensitive" ? " sensitive" : ""} export downloaded.`);
    },
    onError: (error) => showErrorToast(error, "Export failed."),
  });

  async function requestExport(format, exportMode) {
    const sensitive = exportMode === "sensitive";
    const confirmed = await confirm({
      title: sensitive ? "Export sensitive data?" : `Export ${format.toUpperCase()}?`,
      description: sensitive
        ? "This file may contain personal identifiers, contact details, birth data, and other sensitive fields. The export will be recorded in Audit Logs."
        : `${format.toUpperCase()} export will be recorded in Audit Logs with the selected filters.`,
      confirmLabel: sensitive ? "Export sensitive data" : `Export ${format.toUpperCase()}`,
      tone: sensitive ? "danger" : undefined,
      wide: true,
    });
    if (confirmed) exportMutation.mutate({ format, exportMode });
  }

  return (
      <ActionsMenu
      label="Export"
      disabled={!canExport || exportMutation.isPending}
      renderTrigger={({ onClick }) => (
        <Button
          type="button"
          variant="secondary"
          disabled={!canExport}
          loading={exportMutation.isPending}
          onClick={onClick}
        >
          <Download size={16} />
          Export
        </Button>
      )}
    >
      {(closeMenu) => (
        <>
          <ActionsMenuItem
            disabled={!canExport || exportMutation.isPending}
            onClick={() => {
              closeMenu();
              requestExport("csv", "standard");
            }}
          >
            CSV
          </ActionsMenuItem>
          <ActionsMenuItem
            disabled={!canExport || exportMutation.isPending}
            onClick={() => {
              closeMenu();
              requestExport("xlsx", "standard");
            }}
          >
            XLSX
          </ActionsMenuItem>
          {canExportSensitive ? (
            <ActionsMenuItem
              tone="danger"
              onClick={() => {
                closeMenu();
                requestExport("xlsx", "sensitive");
              }}
            >
              Sensitive XLSX
            </ActionsMenuItem>
          ) : null}
        </>
      )}
    </ActionsMenu>
  );
}

const PREVIEW_PAGE_SIZE = 50;

const COMMIT_BATCH_SIZE = 50;

function normalizeJobResponse(data) {
  return { ...data, job_id: data.id };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function ImportDialog({ entity, onClose, initialJobId }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isLoadingInitialJob, setIsLoadingInitialJob] = useState(
    Boolean(initialJobId),
  );
  const [draftRows, setDraftRows] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [actionFilter, setActionFilter] = useState("ALL");
  const [excludedRowNumbers, setExcludedRowNumbers] = useState(
    () => new Set(),
  );
  const [originalSheetNames, setOriginalSheetNames] = useState([]);
  const [importMode, setImportMode] = useState("FULL_REGISTRATION");
  const supportsRelationAttach = entity === "students";

  useEffect(() => {
    if (!initialJobId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = normalizeJobResponse(
          await dataTransferApi.getJob(entity, initialJobId),
        );
        if (cancelled) return;
        setPreview(data);
        setDraftRows(buildDraftRows(data));
        setSelectedSheetName(data.sheet_name || "");
      } catch (error) {
        if (!cancelled) showErrorToast(error, "Could not load import job.");
      } finally {
        if (!cancelled) setIsLoadingInitialJob(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialJobId, entity]);

  const previewMutation = useMutation({
    mutationFn: ({ nextFile, sheetName, mapping } = {}) =>
      dataTransferApi.preview(entity, nextFile || file, {
        sheetName,
        mapping,
        importMode: supportsRelationAttach ? importMode : undefined,
      }),
    onSuccess: (data, variables) => {
      setPreview(data);
      setDraftRows(buildDraftRows(data));
      setContractDurationByRow({});
      setIsDirty(false);
      setSelectedSheetName(data.sheet_name || "");
      const noChangeRowNumbers = variables?.isRevalidate
        ? []
        : (data.rows || [])
            .filter((row) =>
              (row.warnings || []).includes(
                "No changes, identical to the existing record. Recommended: uncheck this row, nothing to update.",
              ),
            )
            .map((row) => row.row_number);
      setExcludedRowNumbers(new Set(noChangeRowNumbers));
      if (!variables?.isRevalidate) {
        setPreviewPage(1);
        setOriginalSheetNames(getSheetOptions(data));
      }
      showSuccessToast("Import preview is ready.");
    },
    onError: (error) => showErrorToast(error, "Import preview failed."),
  });

  const [commitState, setCommitState] = useState(null);

  async function runCommit() {
    if (!preview?.job_id) return;

    const total = preview.summary?.total_rows || 0;
    let completed = commitState?.completed || 0;
    const totalBatches = Math.max(Math.ceil(total / COMMIT_BATCH_SIZE), 1);

    setCommitState({
      completed,
      total,
      currentBatch: Math.floor(completed / COMMIT_BATCH_SIZE) + 1,
      totalBatches,
      isRunning: true,
    });

    try {
      while (completed < total) {
        setCommitState((current) => ({
          ...current,
          currentBatch: Math.floor(completed / COMMIT_BATCH_SIZE) + 1,
        }));
        const data = await dataTransferApi.commit(entity, preview.job_id, {
          offset: completed,
          limit: COMMIT_BATCH_SIZE,
        });
        if (data.rows.length === 0) break;
        completed += data.rows.length;
        setCommitState((current) => ({ ...current, completed }));
      }
    } catch (error) {
      setCommitState((current) => ({ ...current, isRunning: false }));
      showErrorToast(
        error,
        `Import commit stopped partway (${completed} of ${total} done). Click Commit again to resume.`,
      );
      return;
    }

    const finalJob = normalizeJobResponse(
      await dataTransferApi.getJob(entity, preview.job_id),
    );
    const merged = mergePreviewAfterMutation(preview, finalJob);
    setPreview(merged);
    setDraftRows(buildDraftRows(merged));
    setIsDirty(false);
    queryClient.invalidateQueries({ queryKey: [entity] });
    setCommitState(null);

    if (finalJob.summary?.error_rows > 0) {
      showErrorToast(
        `Committed with ${finalJob.summary.error_rows} row(s) still failing. See Validation column.`,
      );
    } else {
      showSuccessToast("Import committed.");
    }
  }

  const rollbackMutation = useMutation({
    mutationFn: () => dataTransferApi.rollback(entity, preview.job_id),
    onSuccess: (data) => {
      const merged = mergePreviewAfterMutation(preview, data);
      setPreview(merged);
      setDraftRows(buildDraftRows(merged));
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: [entity] });
      showSuccessToast("Import rolled back.");
    },
    onError: (error) => showErrorToast(error, "Import rollback failed."),
  });

  const summaryRows = useMemo(() => {
    const summary = preview?.summary;
    if (!summary) return [];

    return [
      ["Total rows", summary.total_rows],
      ["Valid rows", summary.valid_rows],
      ["Error rows", summary.error_rows],
      ["Create", summary.create_count],
      ["Update", summary.update_count],
      ["Reverted", summary.reverted_count],
      ["Rollback failed", summary.failed_count],
    ].filter(([, value]) => value !== undefined && value !== null);
  }, [preview]);

  const visibleRows = useMemo(() => preview?.rows || [], [preview]);
  const errorRowCount = useMemo(
    () => visibleRows.filter((row) => row.errors?.length).length,
    [visibleRows],
  );
  const createRowCount = useMemo(
    () => visibleRows.filter((row) => row.action === "CREATE").length,
    [visibleRows],
  );
  const updateRowCount = useMemo(
    () => visibleRows.filter((row) => row.action === "UPDATE").length,
    [visibleRows],
  );
  const filteredRowIndexes = useMemo(() => {
    let indexes = visibleRows.map((_, index) => index);
    if (showErrorsOnly) {
      indexes = indexes.filter(
        (index) => visibleRows[index]?.errors?.length > 0,
      );
    }
    if (actionFilter !== "ALL") {
      indexes = indexes.filter(
        (index) => visibleRows[index]?.action === actionFilter,
      );
    }
    return indexes;
  }, [visibleRows, showErrorsOnly, actionFilter]);
  const previewTotalPages = Math.max(
    Math.ceil(filteredRowIndexes.length / PREVIEW_PAGE_SIZE),
    1,
  );
  const safePreviewPage = Math.min(previewPage, previewTotalPages);
  const previewPageStart = (safePreviewPage - 1) * PREVIEW_PAGE_SIZE;
  const pagedRowIndexes = useMemo(
    () =>
      filteredRowIndexes.slice(
        previewPageStart,
        previewPageStart + PREVIEW_PAGE_SIZE,
      ),
    [filteredRowIndexes, previewPageStart],
  );
  const previewErrorPages = useMemo(() => {
    const pages = new Set();
    filteredRowIndexes.forEach((rowIndex, position) => {
      const row = visibleRows[rowIndex];
      if (row?.errors?.length && !excludedRowNumbers.has(row.row_number)) {
        pages.add(Math.floor(position / PREVIEW_PAGE_SIZE) + 1);
      }
    });
    return pages;
  }, [filteredRowIndexes, visibleRows, excludedRowNumbers]);
  const editableColumns = useMemo(() => {
    return getEditableFields(entity, preview, draftRows);
  }, [draftRows, entity, preview]);
  const optionDataQuery = useQuery({
    queryKey: [
      entity === "employees" ? "employee-form-options" : "student-form-options",
    ],
    queryFn:
      entity === "employees" ? loadEmployeeFormOptions : loadStudentFormOptions,
    enabled: Boolean(preview),
  });
  const joinDateKey = editableColumns.find(
    (column) => (column.targetKey || column.key) === "join_date",
  )?.key;
  const [contractDurationByRow, setContractDurationByRow] = useState({});
  const sheetOptions = originalSheetNames;
  const canCommit =
    preview?.job_id &&
    (preview.status === "PENDING" || preview.status === "PROCESSING") &&
    preview.summary?.valid_rows > 0 &&
    !isDirty;
  const canRollback = preview?.job_id && preview.status === "COMPLETED";

  function handleFileChange(event) {
    const nextFile = event.target.files?.[0] || null;
    setFile(nextFile);
    setPreview(null);
    setDraftRows([]);
    setIsDirty(false);
    setExcludedRowNumbers(new Set());
    setSelectedSheetName("");
    setOriginalSheetNames([]);
    setPreviewPage(1);
    setShowErrorsOnly(false);
    setContractDurationByRow({});
  }

  function updateCell(rowIndex, column, value) {
    if (draftRows[rowIndex]?.[column] === value) return;
    setDraftRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    );
    setIsDirty(true);
  }

  function toggleRowExcluded(rowNumber) {
    setExcludedRowNumbers((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
    setIsDirty(true);
  }

  function applyActionFilter(nextFilter) {
    setActionFilter(nextFilter);
    setPreviewPage(1);
    if (nextFilter === "ALL") {
      setExcludedRowNumbers(new Set());
    } else {
      setExcludedRowNumbers(
        new Set(
          visibleRows
            .filter((row) => row.action !== nextFilter)
            .map((row) => row.row_number),
        ),
      );
    }
    setIsDirty(true);
  }

  async function revalidateDraft() {
    if (excludedRowNumbers.size > 0) {
      const excludedLabels = visibleRows
        .filter((row) => excludedRowNumbers.has(row.row_number))
        .map(
          (row) =>
            row.raw?.full_name ||
            row.raw?.email ||
            `Row ${row.row_number}`,
        );

      const proceed = await confirm({
        title: "Drop unchecked rows?",
        wide: true,
        description: (
          <>
            <p>
              {excludedRowNumbers.size} row(s) will be dropped from this
              import. Re-check them now if any of this was unchecked by
              accident, since there's no way back after this besides
              re-uploading the file:
            </p>
            <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5 font-medium text-(--mws-charcoal)">
              {excludedLabels.map((label, index) => (
                <li key={index}>{label}</li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: "Drop and Revalidate",
        tone: "danger",
      });
      if (!proceed) return;
    }

    const includedDraftRows = draftRows.filter(
      (_, index) => !excludedRowNumbers.has(visibleRows[index]?.row_number),
    );
    const editedFile = createCsvFile(
      editableColumns,
      includedDraftRows,
      file?.name || `${entityLabels[entity]}-import.csv`,
    );
    previewMutation.mutate({
      nextFile: editedFile,
      mapping: Object.fromEntries(
        editableColumns
          .filter(
            (field) => field.targetKey && !field.targetKey.startsWith("__"),
          )
          .map((field) => [field.label, field.targetKey]),
      ),
      isRevalidate: true,
    });
  }

  async function refreshReferenceData() {
    await queryClient.invalidateQueries({
      queryKey: [
        entity === "employees" ? "employee-form-options" : "student-form-options",
      ],
    });
    await revalidateDraft();
  }

  function applyContractDuration(rowIndex, columnKey, months) {
    setContractDurationByRow((current) => ({ ...current, [rowIndex]: months }));
    const joinDate = draftRows[rowIndex]?.[joinDateKey];
    if (months && ISO_DATE_RE.test(joinDate || "")) {
      updateCell(
        rowIndex,
        columnKey,
        addMonthsToDateInput(joinDate, months),
      );
    }
  }

  function previewSelectedSheet(sheetName = selectedSheetName) {
    previewMutation.mutate({ sheetName });
  }

  return (
    <CrudDialog
      title={
        initialJobId
          ? `Import job - ${entityLabels[entity]}`
          : `Import ${entityLabels[entity]}`
      }
      description={
        initialJobId
          ? "Rows from this import job. Edit invalid cells, revalidate, then commit if it's still pending, or roll back if it's already done."
          : "Upload CSV or Excel, edit invalid cells in preview, revalidate, then commit. Uncheck a row to drop it entirely instead of fixing it. Rows still in error are skipped on commit."
      }
      onClose={onClose}
      panelClassName="max-w-[min(96rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {preview &&
          (preview.status === "PENDING" || preview.status === "PROCESSING") ? (
            <Button
              type="button"
              variant="secondary"
              loading={previewMutation.isPending || optionDataQuery.isFetching}
              onClick={refreshReferenceData}
              title="Reload units, grades, and other reference data, then revalidate"
            >
              <RefreshCw size={16} />
              Refresh data
            </Button>
          ) : null}
          {preview ? (
            <Button
              type="button"
              variant="secondary"
              disabled={!isDirty}
              loading={previewMutation.isPending}
              onClick={revalidateDraft}
            >
              <RefreshCw size={16} />
              Revalidate
            </Button>
          ) : null}
          {canRollback ? (
            <Button
              type="button"
              variant="danger"
              loading={rollbackMutation.isPending}
              onClick={() => rollbackMutation.mutate()}
            >
              <RotateCcw size={16} />
              Rollback
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={!canCommit || commitState?.isRunning}
            onClick={runCommit}
          >
            {commitState?.isRunning ? (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {commitState?.isRunning
              ? commitState.totalBatches > 1
                ? `Committing (${commitState.completed}/${commitState.total})...`
                : "Committing..."
              : commitState && !commitState.isRunning
                ? `Resume (${commitState.completed}/${commitState.total})`
                : "Commit"}
          </Button>
        </>
      }
    >
      <div className="min-w-0 space-y-5">
        {isLoadingInitialJob ? (
          <p className="rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4 text-sm text-(--mws-muted)">
            Loading import job...
          </p>
        ) : null}
        {!initialJobId && supportsRelationAttach ? (
          <div className="grid min-w-0 gap-2 rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4 sm:grid-cols-2">
            <label className="flex min-w-0 cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="import-mode"
                value="FULL_REGISTRATION"
                checked={importMode === "FULL_REGISTRATION"}
                disabled={Boolean(preview)}
                onChange={() => setImportMode("FULL_REGISTRATION")}
                className="mt-1"
              />
              <span className="min-w-0 text-sm">
                <span className="block font-display font-bold text-(--mws-charcoal)">
                  Full Registration
                </span>
                <span className="block text-xs text-(--mws-muted)">
                  Registers new students (or updates matched ones) from a
                  complete sheet.
                </span>
              </span>
            </label>
            <label className="flex min-w-0 cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="import-mode"
                value="RELATION_ATTACH"
                checked={importMode === "RELATION_ATTACH"}
                disabled={Boolean(preview)}
                onChange={() => setImportMode("RELATION_ATTACH")}
                className="mt-1"
              />
              <span className="min-w-0 text-sm">
                <span className="block font-display font-bold text-(--mws-charcoal)">
                  Attach to Existing Student
                </span>
                <span className="block text-xs text-(--mws-muted)">
                  Rows only need NIS or Email. Relation data (health, parents,
                  PC activities, consents, vaccines) is attached to the matched
                  student. No new student is created.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {!initialJobId ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="min-w-0 space-y-1.5">
              <span className="block font-display text-xs font-bold text-(--mws-muted)">
                File
              </span>
              <input
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={handleFileChange}
                className="block h-11 w-full rounded-xl border border-(--mws-line) bg-white px-3 py-2 text-sm text-(--mws-charcoal) file:mr-3 file:rounded-full file:border-0 file:bg-(--mws-soft) file:px-3 file:py-1.5 file:font-display file:text-xs file:font-semibold file:text-(--mws-burgundy) focus:outline-none"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={!file}
              loading={previewMutation.isPending}
              onClick={() => previewSelectedSheet()}
            >
              <Upload size={16} />
              Preview
            </Button>
          </div>
        ) : null}

        {preview ? (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge
                tone={preview.status === "PENDING" ? "amber" : "green"}
              >
                {preview.status}
              </StatusBadge>
              {preview.sheet_name ? (
                <StatusBadge tone="neutral">
                  Sheet: {preview.sheet_name}
                </StatusBadge>
              ) : null}
              {preview.mode === "RELATION_ATTACH" ? (
                <StatusBadge tone="neutral">Attach to Existing</StatusBadge>
              ) : null}
              {isDirty ? (
                <StatusBadge tone="amber">Needs revalidation</StatusBadge>
              ) : null}
              <span className="break-all text-sm text-(--mws-muted)">
                Job {preview.job_id || preview.id}
              </span>
            </div>

            {sheetOptions.length > 1 ? (
              <div className="grid min-w-0 gap-3 rounded-2xl border border-(--mws-line) bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 space-y-1.5">
                  <span className="block font-display text-xs font-bold text-(--mws-muted)">
                    Workbook Sheet
                  </span>
                  <SearchableSelect
                    value={selectedSheetName}
                    onChange={(value) => setSelectedSheetName(value)}
                    options={sheetOptions.map((sheet) => ({
                      value: sheet,
                      label: sheet,
                    }))}
                    placeholder="Select Sheet"
                    searchPlaceholder="Search Sheets"
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !file ||
                    !selectedSheetName ||
                    selectedSheetName === preview.sheet_name ||
                    previewMutation.isPending
                  }
                  onClick={() => previewSelectedSheet(selectedSheetName)}
                >
                  <RefreshCw size={16} />
                  Preview Sheet
                </Button>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summaryRows.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-2xl border border-(--mws-line) bg-(--mws-soft) px-4 py-3"
                >
                  <p className="text-xs font-semibold text-(--mws-muted)">
                    {label}
                  </p>
                  <p className="mt-1 font-display text-xl font-bold text-(--mws-charcoal)">
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {preview.unmapped_headers?.length ? (
              <div className="rounded-2xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
                Unmapped headers: {preview.unmapped_headers.join(", ")}
              </div>
            ) : null}

            {preview.status === "PENDING" && preview.summary?.error_rows > 0 ? (
              <div className="rounded-2xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18]">
                {preview.summary.error_rows} row(s) have errors and will be
                skipped on commit. Fix them now, or commit anyway to import the{" "}
                {preview.summary.valid_rows} valid row(s) and handle the rest in
                a follow-up import.
              </div>
            ) : null}

            <div className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line)">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--mws-line) bg-(--mws-soft) px-4 py-3">
                <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">
                  Editable Preview
                </h3>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-(--mws-muted)">
                    Action
                    <SearchableSelect
                      value={actionFilter}
                      onChange={applyActionFilter}
                      options={[
                        { value: "ALL", label: `All (${visibleRows.length})` },
                        {
                          value: "CREATE",
                          label: `Create only (${createRowCount})`,
                        },
                        {
                          value: "UPDATE",
                          label: `Update only (${updateRowCount})`,
                        },
                      ]}
                      className="w-40"
                      buttonClassName="h-8 w-40 rounded-full px-3"
                    />
                  </div>
                  <label
                    className={[
                      "flex items-center gap-2 text-xs font-semibold text-(--mws-muted)",
                      errorRowCount === 0 && !showErrorsOnly
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={showErrorsOnly}
                      disabled={errorRowCount === 0 && !showErrorsOnly}
                      onChange={(event) => {
                        setShowErrorsOnly(event.target.checked);
                        setPreviewPage(1);
                      }}
                      className="h-4 w-4 accent-(--mws-burgundy)"
                    />
                    Show error rows only ({errorRowCount})
                  </label>
                </div>
              </div>
              <div className="max-h-[min(520px,calc(100svh-24rem))] min-w-0 overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-white font-display text-xs font-bold text-(--mws-muted)">
                    <tr>
                      <th className="sticky left-0 top-0 z-20 w-20 bg-white px-4 py-3">
                        Row
                      </th>
                      <th className="sticky top-0 z-10 w-28 bg-white px-4 py-3">
                        Action
                      </th>
                      {editableColumns.map((field) => (
                        <th
                          key={field.key}
                          className="sticky top-0 z-10 min-w-44 bg-white px-3 py-3"
                        >
                          {field.label}
                        </th>
                      ))}
                      <th className="sticky right-0 top-0 z-20 min-w-72 bg-white px-4 py-3">
                        Validation
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRowIndexes.length === 0 &&
                    (showErrorsOnly || actionFilter !== "ALL") ? (
                      <tr>
                        <td
                          colSpan={editableColumns.length + 3}
                          className="px-4 py-10 text-center text-sm text-(--mws-muted)"
                        >
                          No rows match the current filter. Reset &quot;Show
                          error rows only&quot; or Action to see everything.
                        </td>
                      </tr>
                    ) : null}
                    {pagedRowIndexes.map((rowIndex) => {
                      const row = visibleRows[rowIndex];
                      const errorFields = getErrorFields(row);
                      const warningFields = getWarningFields(row);
                      const hasRowError = row.errors?.length > 0;
                      const isExcluded = excludedRowNumbers.has(
                        row.row_number,
                      );
                      const hasOverridableGradeError = (
                        row.errors || []
                      ).some(
                        (e) =>
                          e.toLowerCase().includes("too far ahead") ||
                          e.toLowerCase().includes("is behind join grade"),
                      );

                      return (
                        <tr
                          key={row.row_number}
                          className={[
                            "border-t border-(--mws-line)",
                            isExcluded
                              ? "bg-(--mws-soft) opacity-60"
                              : hasRowError
                                ? "bg-[#fff8f8]"
                                : "bg-white",
                          ].join(" ")}
                        >
                          <td className="sticky left-0 z-10 bg-inherit px-4 py-3 font-semibold">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={!isExcluded}
                                title={
                                  isExcluded
                                    ? "Excluded. Re-check to include this row again"
                                    : "Uncheck to exclude this row from the import"
                                }
                                onChange={() =>
                                  toggleRowExcluded(row.row_number)
                                }
                                className="h-4 w-4 accent-(--mws-burgundy)"
                              />
                              {row.row_number}
                            </label>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={row.action === "CREATE" ? "green" : "amber"}
                            >
                              {row.action || "SKIPPED"}
                            </StatusBadge>
                          </td>
                          {editableColumns.map((field) => (
                            <td key={field.key} className="px-2 py-2">
                              {(() => {
                                const cell = (
                                  <EditableImportCell
                                    field={field}
                                    value={draftRows[rowIndex]?.[field.key] || ""}
                                    religionValue={draftRows[rowIndex]?.religion}
                                    options={optionDataQuery.data}
                                    hasError={errorFields.has(
                                      field.targetKey || field.key,
                                    )}
                                    hasWarning={warningFields.has(
                                      field.targetKey || field.key,
                                    )}
                                    disabled={
                                      isExcluded ||
                                      (field.key ===
                                        "override_too_far_ahead_reason" &&
                                        !hasOverridableGradeError)
                                    }
                                    onChange={(value) => {
                                      if (contractDurationByRow[rowIndex]) {
                                        setContractDurationByRow((current) => ({
                                          ...current,
                                          [rowIndex]: "",
                                        }));
                                      }
                                      updateCell(rowIndex, field.key, value);
                                    }}
                                  />
                                );
                                if (
                                  entity !== "employees" ||
                                  (field.targetKey || field.key) !==
                                    "contract_end_date"
                                ) {
                                  return cell;
                                }
                                const joinDate = draftRows[rowIndex]?.[joinDateKey] || "";
                                return (
                                  <div className="space-y-1">
                                    {cell}
                                    <SearchableSelect
                                      value={contractDurationByRow[rowIndex] || ""}
                                      onChange={(months) =>
                                        applyContractDuration(
                                          rowIndex,
                                          field.key,
                                          months,
                                        )
                                      }
                                      options={CONTRACT_DURATION_OPTIONS}
                                      placeholder="Set end date manually"
                                      searchPlaceholder="Search Durations"
                                      disabled={isExcluded || !ISO_DATE_RE.test(joinDate)}
                                      buttonClassName="h-9"
                                    />
                                  </div>
                                );
                              })()}
                            </td>
                          ))}
                          <td className="sticky right-0 z-10 bg-inherit px-4 py-3">
                            {isExcluded ? (
                              <span className="text-xs font-semibold text-(--mws-muted)">
                                Excluded, won&apos;t be revalidated or
                                committed
                              </span>
                            ) : row.errors?.length ? (
                              <ol className="space-y-1.5 text-xs font-semibold text-[#9f3d41]">
                                {row.errors.map((error, index) => (
                                  <li key={error} className="flex gap-1.5">
                                    <span className="shrink-0 tabular-nums text-[#c78488]">
                                      {index + 1}.
                                    </span>
                                    <span>{error}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : row.warnings?.length ? (
                              <ValidationWarnings warnings={row.warnings} />
                            ) : (
                              <span className="text-xs font-semibold text-(--mws-muted)">
                                Valid
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {visibleRows.length ? (
                <>
                  <div className="border-t border-(--mws-line) px-4 py-3 text-xs font-semibold text-(--mws-muted)">
                    {showErrorsOnly || actionFilter !== "ALL"
                      ? `Showing ${pagedRowIndexes.length} of ${filteredRowIndexes.length} filtered row(s), from ${visibleRows.length} total.`
                      : `Showing ${pagedRowIndexes.length} of ${visibleRows.length} rows.`}{" "}
                    Edit cells, then revalidate before commit.
                    {previewErrorPages.size
                      ? ` ${previewErrorPages.size} page(s) still have errors.`
                      : ""}
                    {excludedRowNumbers.size
                      ? ` ${excludedRowNumbers.size} row(s) unchecked. Revalidate to drop them from the import.`
                      : ""}
                  </div>
                  <ImportPreviewPager
                    currentPage={safePreviewPage}
                    totalPages={previewTotalPages}
                    errorPages={previewErrorPages}
                    onPageChange={setPreviewPage}
                    isLoading={previewMutation.isPending}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </CrudDialog>
  );
}

function buildPageWindow(current, total, delta = 2) {
  const pages = new Set([1, total, current]);
  for (let page = current - delta; page <= current + delta; page++) {
    if (page >= 1 && page <= total) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

function ImportPreviewPager({
  currentPage,
  totalPages,
  errorPages,
  onPageChange,
  isLoading,
}) {
  const [jumpValue, setJumpValue] = useState("");
  const pageWindow = useMemo(
    () => buildPageWindow(currentPage, totalPages),
    [currentPage, totalPages],
  );

  function goTo(page) {
    onPageChange(Math.min(Math.max(page, 1), totalPages));
  }

  function handleJumpSubmit(event) {
    event.preventDefault();
    const parsed = Number(jumpValue);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= totalPages) {
      goTo(parsed);
    }
    setJumpValue("");
  }

  function handleJumpChange(event) {
    const raw = event.target.value;
    if (raw === "") {
      setJumpValue("");
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    setJumpValue(parsed > totalPages ? String(totalPages) : raw);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-(--mws-line) bg-white px-4 py-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage <= 1 || isLoading}
          onClick={() => goTo(currentPage - 1)}
        >
          <ChevronLeft size={15} />
          Prev
        </Button>
        {pageWindow.map((page, index) => {
          const previousPage = pageWindow[index - 1];
          const showEllipsisBefore =
            previousPage !== undefined && page - previousPage > 1;
          const hasError = errorPages.has(page);
          const isCurrent = page === currentPage;

          return (
            <span key={page} className="flex items-center gap-1">
              {showEllipsisBefore ? (
                <span className="px-1 text-xs text-(--mws-muted)">
                  …
                </span>
              ) : null}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => goTo(page)}
                title={
                  hasError ? `Page ${page} has row(s) with errors` : undefined
                }
                className={[
                  "flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-semibold transition-colors",
                  isCurrent
                    ? "bg-(--mws-burgundy) text-white"
                    : hasError
                      ? "bg-[#fff0f1] text-[#a43c41] hover:bg-[#ffe1e3]"
                      : "text-(--mws-muted) hover:bg-(--mws-soft)",
                ].join(" ")}
              >
                {page}
              </button>
            </span>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage >= totalPages || isLoading}
          onClick={() => goTo(currentPage + 1)}
        >
          Next
          <ChevronRight size={15} />
        </Button>
      </div>
      {totalPages > 7 ? (
        <form
          onSubmit={handleJumpSubmit}
          className="flex items-center gap-1.5 text-xs font-semibold text-(--mws-muted)"
        >
          Go to
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={handleJumpChange}
            placeholder="Page"
            className="h-7 w-20 rounded-md border border-(--mws-line) px-2 text-xs text-(--mws-charcoal) outline-none transition focus:border-(--mws-burgundy) focus:ring-2 focus:ring-[#7E15181A]"
          />
          <Button type="submit" variant="secondary" size="sm">
            Go
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function EditableImportCell({
  field,
  value,
  religionValue,
  options,
  hasError,
  hasWarning,
  disabled,
  onChange,
}) {
  const choices = getFieldOptions(field, options);
  const inputClassName = [
    "h-9 w-full rounded-lg border bg-white px-2 text-sm text-(--mws-charcoal) outline-none transition",
    hasError
      ? "border-[#c75f64] bg-[#fff5f5] text-[#7b2024] focus:border-[#c75f64] focus:ring-2 focus:ring-[#c75f6433]"
      : hasWarning
        ? "border-(--mws-gold) bg-[#fdf8ee] text-[#6b4f14] focus:border-(--mws-gold) focus:ring-2 focus:ring-[#d6a13a33]"
        : "border-(--mws-line) focus:border-(--mws-navy) focus:ring-2 focus:ring-[#1f2a4422]",
  ].join(" ");

  if (choices.length > 0) {
    const fieldKey = field.targetKey || field.key;
    const aliasTable = FIELD_VALUE_ALIASES[fieldKey];
    const normalizedValue = aliasTable
      ? (aliasTable[String(value).toLowerCase()] ?? value)
      : value;
    const matchedChoice = choices.find(
      (choice) =>
        choice.toLowerCase() === String(normalizedValue).toLowerCase(),
    );
    const selectValue = matchedChoice ?? (field.creatable ? value : "");
    return (
      <SearchableSelect
        value={selectValue}
        onChange={onChange}
        options={choices.map((choice) => ({ value: choice, label: choice }))}
        placeholder="Select"
        searchPlaceholder={`Search ${field.label}`}
        disabled={disabled}
        creatable={Boolean(field.creatable)}
        buttonClassName={[
          "h-9",
          hasError
            ? "border-[#c75f64] bg-[#fff5f5] text-[#7b2024]"
            : hasWarning
              ? "border-(--mws-gold) bg-[#fdf8ee] text-[#6b4f14]"
              : null,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
  }

  const fieldKey = field.targetKey || field.key;

  if (field.type === "date") {
    return (
      <DateField
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        invalid={hasError}
        className={inputClassName}
      />
    );
  }

  const isReligionOtherLocked =
    fieldKey === "religion_other" &&
    String(religionValue || "").trim().toUpperCase() !== "OTHER";

  const keystrokeFilter = FIELD_KEYSTROKE_FILTERS[fieldKey];

  return (
    <input
      type={field.type || "text"}
      value={isReligionOtherLocked ? "" : value}
      disabled={disabled || isReligionOtherLocked}
      onChange={(event) =>
        onChange(
          keystrokeFilter
            ? keystrokeFilter(event.target.value)
            : event.target.value,
        )
      }
      className={inputClassName}
    />
  );
}

function formatChangeValue(label, value) {
  if (!value) return value;
  const fieldKey = IMPORT_FIELD_LABEL_TO_KEY[label];
  const formatter = fieldKey && FIELD_KEYSTROKE_FILTERS[fieldKey];
  return formatter ? formatter(value) : value;
}

function getFieldOptions(field, options) {
  if (field.options) return field.options;
  if (!field.optionSource) return [];

  return (options?.[field.optionSource] || []).map((option) => option.name);
}

function getErrorFields(row) {
  const fields = new Set();
  const errors = row.errors || [];

  errors.forEach((error) => {
    const text = error.toLowerCase();

    const parentMatch = text.match(/^parent\/guardian \((mother|father)\)/);
    if (parentMatch) {
      const prefix = parentMatch[1];
      if (text.includes("name")) fields.add(`${prefix}_name`);
      if (text.includes("phone")) fields.add(`${prefix}_phone`);
      if (text.includes("email")) fields.add(`${prefix}_email`);
      return;
    }

    if (text.includes("employee id")) fields.add("employee_id");
    if (text.includes("nick name")) fields.add("nick_name");
    if (text.includes("full name")) fields.add("full_name");

    if (text.includes("nisn")) {
      fields.add("nisn");
    } else if (text.includes("nis")) {
      fields.add("nis");
    }

    if (text.includes("entry type")) fields.add("entry_type");
    if (text.includes("email")) fields.add("email");
    if (text.includes("unit")) fields.add("unit");
    if (text.includes("contract end date")) fields.add("contract_end_date");
    if (text.includes("last working date")) fields.add("last_working_date");
    if (text.includes("job position")) fields.add("job_position");
    if (text.includes("job level")) fields.add("job_level");
    if (text.includes("building")) fields.add("building");
    if (text.includes("academic year")) fields.add("join_academic_year");
    if (text.includes("grade")) {
      fields.add("current_grade");
      fields.add("join_grade");
    }
    if (text.includes("birth place")) fields.add("birth_place");
    if (text.includes("birth date") || text.includes("date")) {
      fields.add("birth_date");
      fields.add("join_date");
    }
    if (text.includes("gender")) fields.add("gender");
    if (text.includes("religion")) fields.add("religion");
    if (text.includes("status")) fields.add("status");
  });

  return fields;
}

function getWarningFields(row) {
  const fields = new Set();
  const warnings = row.warnings || [];

  warnings.forEach((warning) => {
    const text = warning.toLowerCase();
    if (!text.includes("was blank")) return;

    if (text.includes("religion")) fields.add("religion");
    if (text.includes("birth place")) fields.add("birth_place");
    if (text.includes("birth date")) fields.add("birth_date");
    if (text.includes("status")) fields.add("status");
    if (text.includes("current grade")) fields.add("current_grade");
  });

  return fields;
}

const CHANGE_WARNING_RE = /^(.+?): "(.*)" -> "(.*)"$/;

function splitChangeWarnings(warnings) {
  const changes = [];
  const rest = [];
  for (const warning of warnings) {
    const match = warning.match(CHANGE_WARNING_RE);
    if (match) changes.push({ label: match[1], from: match[2], to: match[3] });
    else rest.push(warning);
  }
  return { changes, rest };
}

function ValidationWarnings({ warnings }) {
  const [isChangesOpen, setIsChangesOpen] = useState(false);
  const { changes, rest } = splitChangeWarnings(warnings);

  return (
    <div className="space-y-1.5">
      {changes.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setIsChangesOpen(true)}
            className="text-xs font-semibold text-[#805b18] underline decoration-dotted decoration-[#c7a95e] underline-offset-2 hover:text-[#6b4a14]"
          >
            View {changes.length} change{changes.length > 1 ? "s" : ""}
          </button>
          {isChangesOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-60 flex items-center justify-center bg-[#24171899] px-4 py-6"
                onClick={() => setIsChangesOpen(false)}
              >
                <div
                  className="max-h-[calc(100svh-6rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-(--mws-line) bg-white p-6 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <h3 className="font-display text-base font-bold text-(--mws-charcoal)">
                      Changes on this row
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Close"
                      onClick={() => setIsChangesOpen(false)}
                    >
                      <X size={18} />
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-(--mws-line)">
                    <table className="w-full table-fixed text-left text-sm">
                      <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
                        <tr>
                          <th className="w-1/3 px-4 py-3">Field</th>
                          <th className="px-4 py-3">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.map((change) => (
                          <tr
                            key={change.label}
                            className="border-t border-(--mws-line) bg-white align-top"
                          >
                            <td className="break-words px-4 py-3 font-semibold text-(--mws-charcoal)">
                              {change.label}
                            </td>
                            <td className="space-y-1 break-words px-4 py-3">
                              <p className="text-xs text-(--mws-muted) line-through decoration-(--mws-line)">
                                {formatChangeValue(change.label, change.from) || "-"}
                              </p>
                              <p className="font-semibold text-(--mws-charcoal)">
                                {formatChangeValue(change.label, change.to) || "-"}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>,
              document.body,
            )}
        </>
      )}
      {rest.length > 0 && (
        <ol className="space-y-1.5 text-xs font-semibold text-[#805b18]">
          {rest.map((warning, index) => (
            <li key={warning} className="flex gap-1.5">
              <span className="shrink-0 tabular-nums text-[#c7a95e]">
                {index + 1}.
              </span>
              <span>{warning}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function mergePreviewAfterMutation(current, data) {
  return {
    ...data,
    sheet_name: current?.sheet_name,
    other_sheets: current?.other_sheets,
    source_headers: current?.source_headers || data.source_headers,
    field_mapping: current?.field_mapping,
    unmapped_headers: current?.unmapped_headers,
  };
}

function birthPlaceDateKeys(header) {
  return {
    placeKey: `${header}::birth_place`,
    dateKey: `${header}::birth_date`,
  };
}

function buildDraftRows(preview) {
  if (preview.source_headers?.length) {
    return (preview.rows || []).map((row) => {
      const source = row.source_raw || {};
      const mapped = row.raw || {};
      return Object.fromEntries(
        preview.source_headers.flatMap((header) => {
          const targetKey = preview.field_mapping?.[header];
          if (targetKey === "__birth_place_date__") {
            const { placeKey, dateKey } = birthPlaceDateKeys(header);
            const rawCell = source[header] || "";
            if (rawCell) {
              const [place, ...dateParts] = rawCell.split(",");
              return [
                [placeKey, (place ?? "").trim()],
                [dateKey, parseDateStringToISO(dateParts.join(",").trim())],
              ];
            }
            return [
              [placeKey, mapped.birth_place || ""],
              [dateKey, mapped.birth_date || ""],
            ];
          }
          const rawValue = source[header] || "";
          const fallbackValue = targetKey ? mapped[targetKey] || "" : "";
          const value = rawValue || fallbackValue;
          return [[header, applyNameCase(targetKey, value)]];
        }),
      );
    });
  }

  const sourceByField = getSourceByField(preview);

  return (preview.rows || []).map((row) => {
    const draft = {};
    importFields[
      preview.type?.toLowerCase() === "employee" ? "employees" : "students"
    ].forEach((field) => {
      const source = sourceByField[field.key];
      const value = source
        ? row.raw?.[source] || ""
        : findRawFieldValue(row.raw, field);
      draft[field.key] = applyNameCase(field.key, value);
    });

    return draft;
  });
}

function applyNameCase(fieldKey, value) {
  if (fieldKey !== "full_name" && fieldKey !== "nick_name") return value;
  return capitalizeWords(value);
}

function findRawFieldValue(raw, field) {
  const entries = Object.entries(raw || {});
  const targets = new Set([
    normalizeHeader(field.key),
    normalizeHeader(field.label),
  ]);
  const match = entries.find(([header]) =>
    targets.has(normalizeHeader(header)),
  );
  return match?.[1] || "";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getEditableFields(entity, preview, draftRows) {
  const fieldMap = new Map(
    importFields[entity].map((field) => [field.key, field]),
  );

  if (preview?.source_headers?.length) {
    const columns = preview.source_headers.flatMap((header) => {
      const targetKey = preview.field_mapping?.[header];

      if (targetKey === "__birth_place_date__") {
        const { placeKey, dateKey } = birthPlaceDateKeys(header);
        return [
          {
            ...(fieldMap.get("birth_place") || {}),
            key: placeKey,
            label: "Birth Place",
            targetKey: "birth_place",
          },
          {
            ...(fieldMap.get("birth_date") || {}),
            key: dateKey,
            label: "Birth Date",
            targetKey: "birth_date",
          },
        ];
      }

      const field = fieldMap.get(targetKey);
      return [
        {
          ...(field || {}),
          key: header,
          label: field?.label || header,
          targetKey,
        },
      ];
    });

    const presentTargetKeys = new Set(
      columns.map((column) => column.targetKey || column.key),
    );
    const missingRequiredColumns = (requiredImportFields[entity] || [])
      .filter((fieldKey) => !presentTargetKeys.has(fieldKey))
      .map((fieldKey) => ({
        ...(fieldMap.get(fieldKey) || {}),
        key: fieldKey,
        label: fieldMap.get(fieldKey)?.label || fieldKey,
        targetKey: fieldKey,
      }));

    const overrideReasonColumn =
      entity === "students" &&
      !presentTargetKeys.has("override_too_far_ahead_reason")
        ? [
            {
              ...(fieldMap.get("override_too_far_ahead_reason") || {}),
              key: "override_too_far_ahead_reason",
              label:
                fieldMap.get("override_too_far_ahead_reason")?.label ||
                "Grade Consistency Override Reason (Super Admin)",
              targetKey: "override_too_far_ahead_reason",
            },
          ]
        : [];

    // The end date is needed for non-permanent rows, so it stays editable
    // even when the sheet has no such header.
    const contractEndDateColumn =
      entity === "employees" && !presentTargetKeys.has("contract_end_date")
        ? [
            {
              ...(fieldMap.get("contract_end_date") || {}),
              key: "contract_end_date",
              label: fieldMap.get("contract_end_date")?.label || "Contract End Date",
              targetKey: "contract_end_date",
            },
          ]
        : [];

    return [
      ...columns,
      ...missingRequiredColumns,
      ...contractEndDateColumn,
      ...overrideReasonColumn,
    ];
  }

  const fieldKeys = [];
  const seen = new Set();

  defaultPreviewFields[entity].forEach((fieldKey) => {
    seen.add(fieldKey);
    fieldKeys.push(fieldKey);
  });

  Object.values(preview?.field_mapping || {}).forEach((fieldKey) => {
    if (seen.has(fieldKey)) return;
    seen.add(fieldKey);
    fieldKeys.push(fieldKey);
  });

  draftRows.forEach((row) => {
    Object.keys(row || {}).forEach((fieldKey) => {
      if (seen.has(fieldKey)) return;
      seen.add(fieldKey);
      fieldKeys.push(fieldKey);
    });
  });

  return fieldKeys.map(
    (fieldKey) => fieldMap.get(fieldKey) || { key: fieldKey, label: fieldKey },
  );
}

function getSourceByField(preview) {
  const sourceByField = {};

  Object.entries(preview?.field_mapping || {}).forEach(([source, field]) => {
    if (sourceByField[field]) return;
    sourceByField[field] = source;
  });

  return sourceByField;
}

function getSheetOptions(preview) {
  const names = [];
  const seen = new Set();

  [preview?.sheet_name, ...(preview?.other_sheets || [])].forEach((name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });

  return names;
}

function createCsvFile(fields, rows, sourceName) {
  const csv = [
    fields.map((field) => escapeCsvCell(field.label)).join(","),
    ...rows.map((row) =>
      fields.map((field) => escapeCsvCell(row?.[field.key] || "")).join(","),
    ),
  ].join("\n");

  return new File([csv], toCsvFileName(sourceName), { type: "text/csv" });
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsvFileName(sourceName) {
  return sourceName.replace(/\.(xlsx?|csv)$/i, "") + "-edited.csv";
}
