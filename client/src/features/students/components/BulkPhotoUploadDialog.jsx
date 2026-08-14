import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { studentsApi } from "../api/studentsApi.js";

function studentOptionsFor(students) {
  return students.map((student) => ({
    value: student.id,
    label: student.identity.full_name,
    description: [
      student.academic.nis ? `NIS ${student.academic.nis}` : null,
      student.academic.current_grade,
    ]
      .filter(Boolean)
      .join(" / "),
  }));
}

// Two steps: pick files -> preview matches files
// filenames matched against every student's full name, then a review table
// lets the admin fix anything wrong (name collisions, typos, no match at
// all) before a single byte is actually uploaded.
export function BulkPhotoUploadDialog({ onClose }) {
  const [step, setStep] = useState("select"); // 'select' | 'review' | 'result'
  const [files, setFiles] = useState([]);
  // Map<file_name, { studentId: string, skipped: boolean }>
  const [rows, setRows] = useState(new Map());
  const [result, setResult] = useState(null);

  const studentsQuery = useQuery({
    queryKey: ["students", "bulk-photo-roster"],
    queryFn: () =>
      studentsApi.list({
        page: 1,
        size: 300,
        sort_by: "full_name",
        sort_order: "asc",
      }),
    enabled: step !== "select",
  });
  const studentOptions = studentOptionsFor(studentsQuery.data?.data || []);

  const previewMutation = useMutation({
    mutationFn: (fileNames) => studentsApi.previewBulkPhotos(fileNames),
    onSuccess: (preview) => {
      const next = new Map();
      for (const item of preview) {
        const singleMatch =
          item.candidates.length === 1 ? item.candidates[0].id : "";
        next.set(item.file_name, { studentId: singleMatch, skipped: false });
      }
      setRows(next);
      setStep("review");
    },
    onError: (error) => showErrorToast(error, "Could not match files."),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      const mappings = [];
      const matchedFiles = [];
      for (const file of files) {
        const row = rows.get(file.name);
        if (!row || row.skipped || !row.studentId) continue;
        mappings.push({ file_name: file.name, student_id: row.studentId });
        matchedFiles.push(file);
      }
      return studentsApi.commitBulkPhotos(mappings, matchedFiles);
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("result");
      if (data.success_count > 0) {
        showSuccessToast(`${data.success_count} photo(s) uploaded.`);
      }
      if (data.failed_count > 0) {
        showErrorToast(`${data.failed_count} upload(s) failed.`);
      }
    },
    onError: (error) => showErrorToast(error, "Bulk upload failed."),
  });

  function handleFilesSelected(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (selected.length === 0) return;
    setFiles(selected);
    previewMutation.mutate(selected.map((file) => file.name));
  }

  function updateRow(fileName, patch) {
    setRows((current) => {
      const next = new Map(current);
      next.set(fileName, { ...next.get(fileName), ...patch });
      return next;
    });
  }

  const readyCount = Array.from(rows.values()).filter(
    (row) => !row.skipped && row.studentId,
  ).length;

  return (
    <CrudDialog
      title="Bulk Photo Upload"
      description="Match each file to a student by name, review before uploading."
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        step === "review" ? (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={readyCount === 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {commitMutation.isPending
                ? "Uploading..."
                : `Upload ${readyCount} photo(s)`}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={onClose}>
            {step === "result" ? "Done" : "Close"}
          </Button>
        )
      }
    >
      {step === "select" ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--mws-muted)]">
            Select every photo file at once. Each file's name (without the
            extension) is matched against a student's full name e.g. "Seira"
            matches a student named "Seira".
          </p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--mws-line)] p-8 text-center text-sm text-[var(--mws-muted)] hover:border-[var(--mws-burgundy)] hover:text-[var(--mws-burgundy)]">
            <Upload size={22} />
            {previewMutation.isPending
              ? "Matching..."
              : "Click to select photo files"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              disabled={previewMutation.isPending}
              onChange={handleFilesSelected}
            />
          </label>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--mws-muted)]">
            {readyCount} of {files.length} file(s) ready to upload. Fix any
            unmatched or ambiguous rows below, or uncheck to skip.
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {files.map((file) => {
              const row = rows.get(file.name) || {
                studentId: "",
                skipped: false,
              };
              return (
                <div
                  key={file.name}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--mws-line)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={!row.skipped}
                    onChange={(event) =>
                      updateRow(file.name, { skipped: !event.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--mws-burgundy)]"
                    aria-label={`Include ${file.name}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--mws-charcoal)]">
                    {file.name}
                  </span>
                  <div className="w-full sm:w-64">
                    <SearchableSelect
                      value={row.studentId}
                      onChange={(value) =>
                        updateRow(file.name, { studentId: value })
                      }
                      options={studentOptions}
                      placeholder={
                        studentsQuery.isLoading
                          ? "Loading students..."
                          : "Select student"
                      }
                      searchPlaceholder="Search by name or NIS"
                    />
                  </div>
                  {!row.studentId && !row.skipped ? (
                    <StatusBadge tone="amber">No match</StatusBadge>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === "result" && result ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--mws-charcoal)]">
            {result.success_count} succeeded, {result.failed_count} failed.
          </p>
          {result.failed_count > 0 ? (
            <div className="max-h-[40vh] space-y-2 overflow-y-auto">
              {result.items
                .filter((item) => item.status === "FAILED")
                .map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-[#f2c8cb] bg-[#fff6f7] p-3 text-sm text-[#9f3d41]"
                  >
                    <p className="font-semibold">{item.id}</p>
                    <p>{item.error}</p>
                  </div>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </CrudDialog>
  );
}
