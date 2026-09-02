import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { capitalizeWords } from "../../../lib/form.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { loadEmployeeFormOptions } from "../../employees/api/employeeFormOptions.js";
import {
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from "../../employees/api/employeesApi.js";
import { loadStudentFormOptions } from "../../students/api/studentFormOptions.js";
import {
  studentEntryTypes,
  studentStatuses,
} from "../../students/api/studentsApi.js";
import { vaccineTypes } from "../../students/api/studentSensitiveApi.js";
import { dataTransferApi, downloadBlob } from "../api/dataTransferApi.js";

const entityLabels = {
  students: "students",
  employees: "employees",
};

// Sheets abbreviate gender as M/F or Indonesian L/P instead of MALE/FEMALE.
// Mirrors GENDER_VALUE_ALIASES in server/src/model/import-model.ts.
const GENDER_VALUE_ALIASES = {
  m: "MALE",
  f: "FEMALE",
  l: "MALE",
  p: "FEMALE",
};

// Sheets write religion as free text, not exact enum labels.
// Mirrors RELIGION_VALUE_ALIASES in server/src/model/import-model.ts.
const RELIGION_VALUE_ALIASES = {
  islam: "ISLAM",
  kristen: "PROTESTANTISM",
  christian: "PROTESTANTISM",
  christianity: "PROTESTANTISM",
  "christianity - protestant": "PROTESTANTISM",
  "christianity - prosestant": "PROTESTANTISM",
  "kristen - protestan": "PROTESTANTISM",
  protestant: "PROTESTANTISM",
  protestan: "PROTESTANTISM",
  "christianity - catholic": "CATHOLICISM",
  "christianity - chatholic": "CATHOLICISM",
  "christianity - chatolic": "CATHOLICISM",
  catholic: "CATHOLICISM",
  katolik: "CATHOLICISM",
  hindu: "HINDUISM",
  buddha: "BUDDHISM",
  budha: "BUDDHISM",
  buddhist: "BUDDHISM",
  konghucu: "CONFUCIANISM",
  confucian: "CONFUCIANISM",
  confucianism: "CONFUCIANISM",
  other: "OTHER",
};

// Legacy sheets use free text for student status ("Left School") instead of
// the StudentStatus enum. Mirrors STUDENT_STATUS_VALUE_ALIASES in
// server/src/model/import-model.ts.
const STUDENT_STATUS_VALUE_ALIASES = {
  "left school": "WITHDRAWN",
};

const FIELD_VALUE_ALIASES = {
  gender: GENDER_VALUE_ALIASES,
  religion: RELIGION_VALUE_ALIASES,
  status: STUDENT_STATUS_VALUE_ALIASES,
};

// English + Indonesian month names, e.g. "12 Januari 2010" or "12 January 2010".
// Mirrors MONTH_NAME_TO_INDEX in server/src/service/import-service.ts.
const MONTH_NAME_TO_INDEX = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maret: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  desember: 11,
};

function toISODate(year, monthIndex, day) {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Best-effort conversion of free-text dates (Indonesian month names,
// dd-mm-yyyy) to the YYYY-MM-DD format <input type="date"> requires -
// anything it can't confidently parse it leaves blank rather than guess.
function parseDateStringToISO(dateStr) {
  const raw = (dateStr || "").trim();
  if (!raw) return "";

  const ddMonthNameYYYY = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (ddMonthNameYYYY) {
    const [, day, monthStr, year] = ddMonthNameYYYY;
    const monthIndex = MONTH_NAME_TO_INDEX[monthStr.toLowerCase()];
    if (monthIndex === undefined) return "";
    return toISODate(Number(year), monthIndex, Number(day));
  }

  const ddMMYYYY = raw.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (ddMMYYYY) {
    const [, day, month, year] = ddMMYYYY;
    return toISODate(Number(year), Number(month) - 1, Number(day));
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  return "";
}

// Mirrors IMPORT_EMPLOYEE_FIELDS/IMPORT_STUDENT_FIELDS's `required: true`
// entries server-side - a required field with no matching column in the
// uploaded sheet at all currently has no editable field either, so every
// row fails "X is required" with no way to fix it short of editing the
// source file and re-uploading. getEditableFields uses this to force those
// columns to always show up, empty, ready to fill in by hand.
const requiredImportFields = {
  employees: [
    "employee_id",
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "unit",
    "job_position",
    "job_level",
    "building",
    "join_date",
    "employment_type",
    "marital_status",
  ],
  students: [
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "entry_type",
    "current_grade",
  ],
};

const defaultPreviewFields = {
  employees: [
    "employee_id",
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "unit",
    "job_position",
    "job_level",
    "building",
    "join_date",
    "employment_type",
    "marital_status",
    "status",
  ],
  students: [
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "nisn",
    "entry_type",
    "current_grade",
    "join_academic_year",
    "status",
    "father_name",
    "father_phone",
    "mother_name",
    "mother_phone",
    "blood_type",
  ],
};

// Starting points, not a fixed enum - the field is creatable, so a fully
// custom reason still works. Kept short and plain, like something someone
// would actually type in a hurry, not a formal writeup.
const OVERRIDE_REASON_TEMPLATES = [
  "Verified via report card",
  "Confirmed with parent",
  "Confirmed with school",
  "Not verified",
  "Sheet mismatch",
  "Imported as-is",
];

const importFields = {
  employees: [
    { key: "employee_id", label: "Employee ID" },
    { key: "full_name", label: "Full Name" },
    { key: "nick_name", label: "Nick" },
    { key: "email", label: "Email" },
    { key: "gender", label: "Gender", options: genderOptions },
    { key: "religion", label: "Religion", options: religionOptions },
    { key: "religion_other", label: "Religion (Other)" },
    { key: "birth_place", label: "Birth Place" },
    { key: "birth_date", label: "Birth Date", type: "date" },
    { key: "unit", label: "Unit", optionSource: "units" },
    {
      key: "job_position",
      label: "Job Position",
      optionSource: "jobPositions",
    },
    { key: "job_level", label: "Job Level", optionSource: "jobLevels" },
    { key: "building", label: "Building", optionSource: "buildings" },
    { key: "join_date", label: "Join Date", type: "date" },
    {
      key: "employment_type",
      label: "Employment Type",
      options: employmentTypes,
    },
    {
      key: "contract_end_date",
      label: "Contract End Date",
      type: "date",
    },
    {
      key: "marital_status",
      label: "Marital Status",
      options: maritalStatuses,
    },
    { key: "status", label: "Status", options: employeeStatuses },
    { key: "last_working_date", label: "Last Working Date", type: "date" },
    { key: "notes", label: "Notes" },
    { key: "photo_url", label: "Photo ID" },
    { key: "mobile_phone", label: "Mobile Phone" },
    { key: "residential_address", label: "Residential Address" },
    { key: "nik", label: "NIK" },
    { key: "npwp", label: "NPWP" },
    { key: "bank_account_number", label: "Bank Account Number" },
    { key: "bpjs_number", label: "BPJS Kesehatan Number" },
    { key: "bpjs_employment_number", label: "BPJS Ketenagakerjaan Number" },
    { key: "kpj_number", label: "KPJ Number" },
  ],
  students: [
    { key: "full_name", label: "Full Name" },
    { key: "nick_name", label: "Nick Name" },
    { key: "email", label: "Email" },
    { key: "gender", label: "Gender", options: genderOptions },
    { key: "religion", label: "Religion", options: religionOptions },
    { key: "religion_other", label: "Religion (Other)" },
    { key: "birth_place", label: "Birth Place" },
    { key: "birth_date", label: "Birth Date", type: "date" },
    { key: "nis", label: "NIS" },
    { key: "nisn", label: "NISN" },
    { key: "entry_type", label: "Entry Type", options: studentEntryTypes },
    { key: "current_grade", label: "Current Grade", optionSource: "grades" },
    {
      key: "join_academic_year",
      label: "Join Academic Year",
      optionSource: "academicYears",
    },
    { key: "previous_school", label: "Previous School" },
    { key: "status", label: "Status", options: studentStatuses },
    { key: "photo_url", label: "Photo ID" },
    { key: "leave_year", label: "Leave Year" },
    { key: "sn", label: "SN", options: ["TRUE", "FALSE"] },
    { key: "join_grade", label: "Join Grade", optionSource: "grades" },
    {
      key: "graduation_grade",
      label: "Graduation Grade",
      optionSource: "grades",
    },
    {
      key: "override_too_far_ahead_reason",
      label: "Grade Consistency Override Reason (Super Admin)",
      options: OVERRIDE_REASON_TEMPLATES,
      creatable: true,
    },
    {
      key: "pickup_drop_service",
      label: "Pickup Drop Service",
      options: ["TRUE", "FALSE"],
    },
    {
      key: "catering_service",
      label: "Catering Service",
      options: ["TRUE", "FALSE"],
    },
    { key: "psb_guide", label: "PSB Guide", options: ["TRUE", "FALSE"] },
    { key: "father_name", label: "Father" },
    { key: "father_phone", label: "Father's Phone" },
    { key: "father_email", label: "Father's Email" },
    { key: "mother_name", label: "Mother" },
    { key: "mother_phone", label: "Mother's Phone" },
    { key: "mother_email", label: "Mother's Email" },
    { key: "parent_address", label: "Address" },
    { key: "health_info", label: "Health Information" },
    { key: "special_needs", label: "Special Needs" },
    { key: "blood_type", label: "Blood Type", options: ["A", "B", "AB", "O"] },
    { key: "media_consent_sign", label: "Media Consent Sign" },
    {
      key: "media_consent_yes",
      label: "Media Consent YES",
      options: ["YES", "NO"],
    },
    { key: "parent_consent_sign", label: "Parent Consent Sign" },
    { key: "pc_monday", label: "PC Monday" },
    { key: "pc_tuesday", label: "PC Tuesday" },
    { key: "pc_wednesday", label: "PC Wednesday" },
    { key: "pc_thursday", label: "PC Thursday" },
    { key: "vaccine_type", label: "Vaccine Type", options: vaccineTypes },
    {
      key: "vaccine_received",
      label: "Vaccine Received",
      options: ["TRUE", "FALSE"],
    },
    { key: "vaccine_date", label: "Vaccine Date", type: "date" },
    { key: "current_class", label: "Current Class", optionSource: "classes" },
    {
      key: "current_class_start_date",
      label: "Class Start Date",
      type: "date",
    },
    { key: "current_class_end_date", label: "Class End Date", type: "date" },
  ],
};

export function DataTransferActions({
  entity,
  exportParams,
  canImport,
  canExport = true,
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
      <ExportButton
        entity={entity}
        format="csv"
        exportParams={exportParams}
        disabled={!canExport}
      />
      <ExportButton
        entity={entity}
        format="xlsx"
        exportParams={exportParams}
        disabled={!canExport}
      />

      {isImportOpen ? (
        <ImportDialog entity={entity} onClose={() => setIsImportOpen(false)} />
      ) : null}
    </div>
  );
}

function ExportButton({ entity, format, exportParams, disabled }) {
  const exportMutation = useMutation({
    mutationFn: () =>
      dataTransferApi.exportFile(entity, {
        ...exportParams,
        format,
      }),
    onSuccess: ({ blob, fileName }) => {
      downloadBlob(
        blob,
        fileName || `${entityLabels[entity]}-export.${format}`,
      );
      showSuccessToast(`${format.toUpperCase()} export downloaded.`);
    },
    onError: (error) => showErrorToast(error, "Export failed."),
  });

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled || exportMutation.isPending}
      onClick={() => exportMutation.mutate()}
    >
      <Download size={16} />
      {exportMutation.isPending ? "Exporting" : format.toUpperCase()}
    </Button>
  );
}

// A 1000+ row sheet rendered in one giant table makes every single
// keystroke re-render the whole thing (React has to reconcile every cell,
// not just the one that changed) - paginating the editable preview keeps
// each render scoped to one page's worth of rows regardless of file size.
const PREVIEW_PAGE_SIZE = 50;

// Rows committed per request - same reasoning as PREVIEW_PAGE_SIZE, plus it
// keeps any single request's write work (each row is its own sequence of
// DB calls server-side) well under the timeout for a large file.
const COMMIT_BATCH_SIZE = 50;

// GET /import/:jobId responds with `id`, everything else (preview, commit)
// responds with `job_id` - normalize so the rest of this file can treat
// both response shapes the same way.
function normalizeJobResponse(data) {
  return { ...data, job_id: data.id };
}

function ImportDialog({ entity, onClose }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [draftRows, setDraftRows] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  // Lets you page through only the rows that still need fixing, instead of
  // clicking through every page hunting for the red ones.
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  // "CREATE" isolates rows the server couldn't match to an existing
  // student - on a re-upload of the same sheet after a partial-failure
  // commit, that's exactly the rows that failed last time (a row that
  // committed fine now matches as UPDATE instead).
  const [actionFilter, setActionFilter] = useState("ALL");
  // Rows unchecked in the Row column - dropped from the file rebuilt by
  // Revalidate, so they never reach the server at all (not just skipped at
  // commit). Keyed by row_number, not array index, since it needs to
  // survive re-renders as rows shift around. Cleared on every fresh
  // preview/revalidate response, since row numbers are reassigned then.
  const [excludedRowNumbers, setExcludedRowNumbers] = useState(
    () => new Set(),
  );
  // Revalidating rebuilds a single-sheet CSV from the edited rows and
  // re-uploads that, so its own preview response naturally has no
  // other_sheets - tracked separately from `preview` so the Workbook Sheet
  // picker (sourced from the *originally uploaded* file) doesn't disappear
  // just because you revalidated.
  const [originalSheetNames, setOriginalSheetNames] = useState([]);
  // Relation-attach only applies to students - each row attaches relation
  // data (health, parents, PC activities, consents, vaccines) to an
  // existing student matched by NIS/Email, instead of registering a new one.
  const [importMode, setImportMode] = useState("FULL_REGISTRATION");
  const supportsRelationAttach = entity === "students";

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
      setIsDirty(false);
      setSelectedSheetName(data.sheet_name || "");
      // Excluded rows already got dropped out of the rebuilt CSV a
      // Revalidate re-uploads, so they simply aren't in `data.rows`
      // anymore - nothing left to mark excluded. A fresh upload starts
      // from a clean slate too, except for the auto-exclude below.
      const noChangeRowNumbers = variables?.isRevalidate
        ? []
        : (data.rows || [])
            .filter((row) =>
              (row.warnings || []).includes(
                "No changes - identical to the existing record. Recommended: uncheck this row, nothing to update.",
              ),
            )
            .map((row) => row.row_number);
      // A row whose every mapped field already matches the existing record
      // would be a no-op UPDATE - pre-exclude it so a big reimport batch
      // doesn't spend the commit pass re-touching rows with nothing to
      // change. Only on the fresh upload, not on Revalidate.
      setExcludedRowNumbers(new Set(noChangeRowNumbers));
      // Revalidating (fixing rows, then re-checking) shouldn't yank you back
      // to page 1 - you're usually mid-way through a specific page's errors.
      // A fresh upload/sheet switch is a new dataset, so that one still
      // starts at page 1.
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
        if (data.rows.length === 0) break; // nothing left to process - safety net against looping forever
        completed += data.rows.length;
        setCommitState((current) => ({ ...current, completed }));
      }
    } catch (error) {
      setCommitState((current) => ({ ...current, isRunning: false }));
      showErrorToast(
        error,
        `Import commit stopped partway (${completed} of ${total} done) - click Commit again to resume.`,
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
    // Same reasoning as the revalidate case above - stay put so you can see
    // what happened to the rows on the page you were reviewing.
    queryClient.invalidateQueries({ queryKey: [entity] });
    setCommitState(null);

    if (finalJob.summary?.error_rows > 0) {
      showErrorToast(
        `Committed with ${finalJob.summary.error_rows} row(s) still failing - see Validation column.`,
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
  // Indexes into visibleRows/draftRows (not a filtered copy of the rows
  // themselves) - editing a cell or excluding a row needs the *original*
  // position, which a plain .filter() on the row objects would lose.
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
  // Defensive clamp, not state - if the row count ever shrinks out from
  // under a page number the user was already on, fall back to the last
  // valid page instead of rendering an empty slice.
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
  // Which 1-based preview pages (of the *current* filtered view) contain at
  // least one row with a validation error - drives the red page-number
  // marker so an error on a page you've scrolled past doesn't go unnoticed.
  const previewErrorPages = useMemo(() => {
    const pages = new Set();
    filteredRowIndexes.forEach((rowIndex, position) => {
      const row = visibleRows[rowIndex];
      // A row already marked for exclusion is on its way out - no point
      // flagging its page red for an error that won't exist after Revalidate.
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
  const sheetOptions = originalSheetNames;
  const canCommit =
    preview?.job_id &&
    // PROCESSING means an earlier commit run stopped partway (batch
    // failure) - Commit resumes it rather than starting over.
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
  }

  function updateCell(rowIndex, column, value) {
    setDraftRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    );
    setIsDirty(true);
  }

  // Toggling doesn't touch draftRows/preview yet - it's reversible until
  // Revalidate actually drops the row from the rebuilt file (see below).
  // isDirty=true blocks Commit in the meantime, same as editing a cell -
  // there's no such thing as "commit with an exclusion still pending".
  function toggleRowExcluded(rowNumber) {
    setExcludedRowNumbers((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
    setIsDirty(true);
  }

  // Picking "Create only"/"Update only" isn't just a view filter - it
  // excludes every non-matching row too, so Commit only actually hits the
  // server for the rows you're looking at (no wasted UPDATE calls when
  // you're just here to push through the rows that failed CREATE last
  // time, or vice versa). Same revalidate-before-commit safety net as any
  // other exclusion - nothing is dropped from the file until Revalidate.
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
    // Excluded rows are dropped here, not just hidden - the rebuilt file
    // (and the new job it produces) never contains them at all, same as if
    // they'd been deleted from the source sheet. That's permanent (short of
    // re-uploading the original file from scratch), so a mis-click gets one
    // more chance to be caught here before it's too late to just re-check
    // the box.
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
              import - re-check them now if any of this was unchecked by
              accident, since there's no way back after this besides
              re-uploading the file:
            </p>
            <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5 font-medium text-[var(--mws-charcoal)]">
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

  function previewSelectedSheet(sheetName = selectedSheetName) {
    previewMutation.mutate({ sheetName });
  }

  return (
    <CrudDialog
      title={`Import ${entityLabels[entity]}`}
      description="Upload CSV or Excel, edit invalid cells in preview, revalidate, then commit. Uncheck a row to drop it entirely instead of fixing it. Rows still in error are skipped on commit."
      onClose={onClose}
      panelClassName="max-w-[min(96rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {preview ? (
            <Button
              type="button"
              variant="secondary"
              disabled={!isDirty || previewMutation.isPending}
              onClick={revalidateDraft}
            >
              <RefreshCw size={16} />
              {previewMutation.isPending ? "Validating" : "Revalidate"}
            </Button>
          ) : null}
          {canRollback ? (
            <Button
              type="button"
              variant="danger"
              disabled={rollbackMutation.isPending}
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
        {supportsRelationAttach ? (
          <div className="grid min-w-0 gap-2 rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 sm:grid-cols-2">
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
                <span className="block font-display font-bold text-[var(--mws-charcoal)]">
                  Full Registration
                </span>
                <span className="block text-xs text-[var(--mws-muted)]">
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
                <span className="block font-display font-bold text-[var(--mws-charcoal)]">
                  Attach to Existing Student
                </span>
                <span className="block text-xs text-[var(--mws-muted)]">
                  Rows only need NIS or Email - relation data (health, parents,
                  PC activities, consents, vaccines) is attached to the matched
                  student. No new student is created.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="min-w-0 space-y-1.5">
            <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
              File
            </span>
            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={handleFileChange}
              className="block h-11 w-full rounded-xl border border-[var(--mws-line)] bg-white px-3 py-2 text-sm text-[var(--mws-charcoal)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--mws-soft)] file:px-3 file:py-1.5 file:font-display file:text-xs file:font-semibold file:text-[var(--mws-burgundy)] focus:outline-none"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!file || previewMutation.isPending}
            onClick={() => previewSelectedSheet()}
          >
            <Upload size={16} />
            {previewMutation.isPending ? "Previewing" : "Preview"}
          </Button>
        </div>

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
              <span className="break-all text-sm text-[var(--mws-muted)]">
                Job {preview.job_id || preview.id}
              </span>
            </div>

            {sheetOptions.length > 1 ? (
              <div className="grid min-w-0 gap-3 rounded-2xl border border-[var(--mws-line)] bg-white p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 space-y-1.5">
                  <span className="block font-display text-xs font-bold text-[var(--mws-muted)]">
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
                  className="rounded-2xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3"
                >
                  <p className="text-xs font-semibold text-[var(--mws-muted)]">
                    {label}
                  </p>
                  <p className="mt-1 font-display text-xl font-bold text-[var(--mws-charcoal)]">
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

            <div className="min-w-0 overflow-hidden rounded-2xl border border-[var(--mws-line)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-3">
                <h3 className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                  Editable Preview
                </h3>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--mws-muted)]">
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
                      "flex items-center gap-2 text-xs font-semibold text-[var(--mws-muted)]",
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
                      className="h-4 w-4 accent-[var(--mws-burgundy)]"
                    />
                    Show error rows only ({errorRowCount})
                  </label>
                </div>
              </div>
              <div className="max-h-[min(520px,calc(100svh-24rem))] min-w-0 overflow-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-white font-display text-xs font-bold text-[var(--mws-muted)]">
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
                          className="px-4 py-10 text-center text-sm text-[var(--mws-muted)]"
                        >
                          No rows match the current filter - reset &quot;Show
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
                      // Both grade-consistency checks the override can
                      // bypass - see student-service.ts's two callers of
                      // override_too_far_ahead_reason.
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
                            "border-t border-[var(--mws-line)]",
                            isExcluded
                              ? "bg-[var(--mws-soft)] opacity-60"
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
                                    ? "Excluded - re-check to include this row again"
                                    : "Uncheck to exclude this row from the import"
                                }
                                onChange={() =>
                                  toggleRowExcluded(row.row_number)
                                }
                                className="h-4 w-4 accent-[var(--mws-burgundy)]"
                              />
                              {row.row_number}
                            </label>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge
                              tone={row.action === "CREATE" ? "green" : "amber"}
                            >
                              {row.action || "Skipped"}
                            </StatusBadge>
                          </td>
                          {editableColumns.map((field) => (
                            <td key={field.key} className="px-2 py-2">
                              <EditableImportCell
                                field={field}
                                value={draftRows[rowIndex]?.[field.key] || ""}
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
                                onChange={(value) =>
                                  updateCell(rowIndex, field.key, value)
                                }
                              />
                            </td>
                          ))}
                          <td className="sticky right-0 z-10 bg-inherit px-4 py-3">
                            {isExcluded ? (
                              <span className="text-xs font-semibold text-[var(--mws-muted)]">
                                Excluded - won&apos;t be revalidated or
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
                              <ol className="space-y-1.5 text-xs font-semibold text-[#805b18]">
                                {row.warnings.map((warning, index) => (
                                  <li key={warning} className="flex gap-1.5">
                                    <span className="shrink-0 tabular-nums text-[#c7a95e]">
                                      {index + 1}.
                                    </span>
                                    <span>{warning}</span>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <span className="text-xs font-semibold text-[var(--mws-muted)]">
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
                  <div className="border-t border-[var(--mws-line)] px-4 py-3 text-xs font-semibold text-[var(--mws-muted)]">
                    {showErrorsOnly || actionFilter !== "ALL"
                      ? `Showing ${pagedRowIndexes.length} of ${filteredRowIndexes.length} filtered row(s), from ${visibleRows.length} total.`
                      : `Showing ${pagedRowIndexes.length} of ${visibleRows.length} rows.`}{" "}
                    Edit cells, then revalidate before commit.
                    {previewErrorPages.size
                      ? ` ${previewErrorPages.size} page(s) still have errors.`
                      : ""}
                    {excludedRowNumbers.size
                      ? ` ${excludedRowNumbers.size} row(s) unchecked - revalidate to drop them from the import.`
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

// Windowed page numbers around the current page, plus page 1 and the last
// page, so a big preview (hundreds of pages) doesn't render a button per
// page - callers insert an ellipsis wherever consecutive numbers skip.
function buildPageWindow(current, total, delta = 2) {
  const pages = new Set([1, total, current]);
  for (let page = current - delta; page <= current + delta; page++) {
    if (page >= 1 && page <= total) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

// Prev/Next plus clickable page numbers (red when that page has a row-level
// validation error, so an error you've scrolled past still shows) - a plain
// page-size selector wouldn't surface *which* page still needs attention,
// which is the actual problem being solved here. A direct "go to page"
// input is added once there are enough pages that the window alone isn't
// a fast way to reach a far-off one.
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

  // Clamp as you type, not just on submit - the number input's own
  // min/max attrs only affect the spinner arrows, a pasted or typed value
  // past totalPages goes straight through otherwise.
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
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--mws-line)] bg-white px-4 py-3">
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
                <span className="px-1 text-xs text-[var(--mws-muted)]">
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
                    ? "bg-[var(--mws-burgundy)] text-white"
                    : hasError
                      ? "bg-[#fff0f1] text-[#a43c41] hover:bg-[#ffe1e3]"
                      : "text-[var(--mws-muted)] hover:bg-[var(--mws-soft)]",
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
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--mws-muted)]"
        >
          Go to
          <input
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={handleJumpChange}
            placeholder="Page"
            className="h-7 w-20 rounded-md border border-[var(--mws-line)] px-2 text-xs text-[var(--mws-charcoal)] outline-none transition focus:border-[var(--mws-burgundy)] focus:ring-2 focus:ring-[#7E15181A]"
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
  options,
  hasError,
  hasWarning,
  disabled,
  onChange,
}) {
  const choices = getFieldOptions(field, options);
  // Focus uses navy, not burgundy - burgundy is close enough to the error
  // red (#c75f64) that clicking through a row's valid cells looked like
  // they were all flagged as errors too. An error cell keeps its own red
  // focus so it doesn't look like the error cleared just by tabbing into it.
  // A warning (auto-defaulted placeholder, e.g. Birth Date -> 1900-01-01)
  // gets its own yellow/gold, distinct from both - it's a "double check
  // this" nudge, not something blocking the row.
  const inputClassName = [
    "h-9 w-full rounded-lg border bg-white px-2 text-sm text-[var(--mws-charcoal)] outline-none transition",
    hasError
      ? "border-[#c75f64] bg-[#fff5f5] text-[#7b2024] focus:border-[#c75f64] focus:ring-2 focus:ring-[#c75f6433]"
      : hasWarning
        ? "border-[var(--mws-gold)] bg-[#fdf8ee] text-[#6b4f14] focus:border-[var(--mws-gold)] focus:ring-2 focus:ring-[#d6a13a33]"
        : "border-[var(--mws-line)] focus:border-[var(--mws-navy)] focus:ring-2 focus:ring-[#1f2a4422]",
  ].join(" ");

  if (choices.length > 0) {
    // Value coming from the uploaded file (e.g. a boolean cell stringified
    // as "false") doesn't always match a choice's exact case (options list
    // has "FALSE"), so match case-insensitively to show the right option.
    const fieldKey = field.targetKey || field.key;
    const aliasTable = FIELD_VALUE_ALIASES[fieldKey];
    const normalizedValue = aliasTable
      ? (aliasTable[String(value).toLowerCase()] ?? value)
      : value;
    const matchedChoice = choices.find(
      (choice) =>
        choice.toLowerCase() === String(normalizedValue).toLowerCase(),
    );
    // Creatable fields (e.g. the override reason) can hold a value that
    // isn't one of the templates at all - pass the raw text through so
    // SearchableSelect's own creatable-display fallback can show it,
    // instead of collapsing an already-typed custom reason back to blank.
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
              ? "border-[var(--mws-gold)] bg-[#fdf8ee] text-[#6b4f14]"
              : null,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
  }

  // Match the Create Student/Employee form's own rule (StudentForm.jsx,
  // EmployeeForm.jsx) so a name typed/pasted into the import preview
  // doesn't end up capitalized differently than one typed straight into
  // the create form. field.key is the literal sheet header text (e.g.
  // "Full Name") when the upload has its own headers - targetKey carries
  // the semantic field ("full_name") in that case, so check both.
  const fieldKey = field.targetKey || field.key;
  const isNameField = fieldKey === "full_name" || fieldKey === "nick_name";

  return (
    <input
      type={field.type || "text"}
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange(
          isNameField
            ? capitalizeWords(event.target.value)
            : event.target.value,
        )
      }
      className={inputClassName}
    />
  );
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

    // "Parent/guardian (MOTHER) failed: Full name is too long" is about the
    // parent's own name/phone/email, not the student's - map it to the
    // parent field and stop, so it doesn't also fall through to the
    // student-field checks below (which would wrongly flag e.g. Full Name).
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

// Distinct from getErrorFields() - these are auto-defaulted-placeholder
// warnings ("Birth Date was blank - defaulted to 1900-01-01"), not
// blocking errors, so they get their own yellow indicator instead of red.
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

// Commit/rollback responses only carry job_id/status/summary/rows - unlike
// preview, they don't return sheet_name/other_sheets/source_headers/
// field_mapping/unmapped_headers. Carry those over from the current preview
// so the Workbook Sheet selector, unmapped-headers banner, and editable
// columns don't disappear the moment you commit or roll back.
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
      // A blank cell in the sheet doesn't mean the row's actual value is
      // blank - the server may have already defaulted it (Entry Type ->
      // PSB, Birth Date -> 1900-01-01, etc., see mapRow() server-side).
      // Fall back to that resolved value so the preview shows what's
      // actually about to be committed, not a misleadingly empty cell.
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

// Same rule Create Student/Employee applies as you type (StudentForm.jsx,
// EmployeeForm.jsx) - a sheet value like "aadad" or "JOHN DOE" should land
// in the preview already cased the same way a manually-typed name would,
// not just once someone happens to edit the cell.
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

    // A required field with no column at all in the uploaded sheet still
    // needs somewhere to be filled in - append it, empty, rather than
    // leaving every row stuck on "X is required" with no way to fix it here.
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

    // Never comes from an uploaded sheet - it's a per-row escape hatch typed
    // directly in this table for a row flagged "too far ahead", so it needs
    // to always be editable here regardless of what the file's headers are.
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

    return [...columns, ...missingRequiredColumns, ...overrideReasonColumn];
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
