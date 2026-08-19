import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import {
  MAX_BULK_PHOTO_BATCH_BYTES,
  formatFileSize,
} from "../../../lib/fileSize.js";
import { studentsApi } from "../api/studentsApi.js";

// Small circular preview for a row's current photo (cropped version if the
// admin edited it, otherwise the original file as picked).
function PhotoRowThumbnail({ source }) {
  const objectUrl = useMemo(
    () => (source ? URL.createObjectURL(source) : null),
    [source],
  );

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  if (!objectUrl) return null;
  return (
    <img
      src={objectUrl}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full border border-[var(--mws-line)] object-cover"
    />
  );
}

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
  // Map<file_name, { studentId: string, skipped: boolean, candidates: StudentPhotoMatchCandidate[] }>
  const [rows, setRows] = useState(new Map());
  const [result, setResult] = useState(null);
  // Map<file_name, Blob> - present once a row's photo has been cropped/edited
  const [croppedBlobs, setCroppedBlobs] = useState(new Map());
  const [editingFileName, setEditingFileName] = useState(null);

  // The search endpoint caps size at 100 (consistent across every paginated
  // endpoint in the app, see student-validation.ts) - matching by name
  // needs the *entire* roster, not just the first page, so this walks
  // every page instead of requesting one oversized one (which would just
  // 400 outright: "Too big: expected number to be <=100").
  const studentsQuery = useQuery({
    queryKey: ["students", "bulk-photo-roster"],
    queryFn: async () => {
      const allStudents = [];
      let page = 1;
      let totalPages;
      do {
        const response = await studentsApi.list({
          page,
          size: 100,
          sort_by: "full_name",
          sort_order: "asc",
        });
        allStudents.push(...(response.data || []));
        totalPages = response.paging?.total_page || 1;
        page += 1;
      } while (page <= totalPages);
      return allStudents;
    },
    enabled: step !== "select",
  });
  const studentOptions = studentOptionsFor(studentsQuery.data || []);

  const previewMutation = useMutation({
    mutationFn: (fileNames) => studentsApi.previewBulkPhotos(fileNames),
    onSuccess: (preview) => {
      const next = new Map();
      for (const item of preview) {
        const singleMatch =
          item.candidates.length === 1 ? item.candidates[0] : null;
        // Default-skip a confident match who already has a photo on file -
        // a bulk re-upload is more often a mistake (wrong folder, re-running
        // an old batch) than an intentional replacement, so make the admin
        // opt back in rather than silently overwrite. No match (or an
        // ambiguous one) also starts unchecked - there's no student to
        // upload to yet, so a checked box would be misleading. Picking one
        // from the dropdown (see updateRow's studentId handling below)
        // turns it back on.
        next.set(item.file_name, {
          studentId: singleMatch?.id || "",
          skipped: !singleMatch || Boolean(singleMatch.has_photo),
          candidates: item.candidates,
        });
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
        const croppedBlob = croppedBlobs.get(file.name);
        // Blob has no filename of its own - wrap it in a File carrying the
        // original name so the server's filename-based matching still works.
        matchedFiles.push(
          croppedBlob
            ? new File([croppedBlob], file.name, {
                type: croppedBlob.type || file.type,
              })
            : file,
        );
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

  // Bytes that will actually go out - same rows commitMutation includes,
  // sized by the cropped blob when one exists (that's what actually gets
  // sent instead of the original file). Recomputes on every checkbox/crop
  // change since it's plain derived state, no extra effect needed.
  const totalBytes = files.reduce((sum, file) => {
    const row = rows.get(file.name);
    if (!row || row.skipped || !row.studentId) return sum;
    const size = croppedBlobs.get(file.name)?.size ?? file.size;
    return sum + size;
  }, 0);
  const isOverBatchLimit = totalBytes > MAX_BULK_PHOTO_BATCH_BYTES;

  const editingFile = editingFileName
    ? croppedBlobs.get(editingFileName) ||
      files.find((file) => file.name === editingFileName)
    : null;

  return (
    <>
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
              disabled={readyCount === 0 || isOverBatchLimit || commitMutation.isPending}
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
          <p
            className={`text-sm font-medium ${
              isOverBatchLimit ? "text-[#9f3d41]" : "text-[var(--mws-charcoal)]"
            }`}
          >
            Total upload size: {formatFileSize(totalBytes)}
            {isOverBatchLimit
              ? ` — over the ${formatFileSize(MAX_BULK_PHOTO_BATCH_BYTES)} batch limit, uncheck some rows first.`
              : null}
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {files.map((file) => {
              const row = rows.get(file.name) || {
                studentId: "",
                skipped: false,
                candidates: [],
              };
              const selectedCandidate = row.candidates?.find(
                (candidate) => candidate.id === row.studentId,
              );
              const fileSize =
                croppedBlobs.get(file.name)?.size ?? file.size;
              return (
                <div
                  key={file.name}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--mws-line)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={!row.skipped}
                    disabled={!row.studentId}
                    title={!row.studentId ? "Select a student first" : undefined}
                    onChange={(event) =>
                      updateRow(file.name, { skipped: !event.target.checked })
                    }
                    className="h-4 w-4 accent-[var(--mws-burgundy)] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Include ${file.name}`}
                  />
                  <PhotoRowThumbnail source={croppedBlobs.get(file.name) || file} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--mws-charcoal)]">
                      {file.name}
                    </span>
                    <span className="text-xs text-[var(--mws-muted)]">
                      {formatFileSize(fileSize)}
                    </span>
                  </div>
                  {selectedCandidate?.has_photo ? (
                    <StatusBadge tone="neutral" title="This student already has a photo on file">
                      Has photo
                    </StatusBadge>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Edit photo"
                    aria-label={`Edit ${file.name}`}
                    onClick={() => setEditingFileName(file.name)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <div className="w-full sm:w-64">
                    <SearchableSelect
                      value={row.studentId}
                      onChange={(value) =>
                        // Picking a student is a clear signal to include this
                        // row - turn the checkbox back on instead of leaving
                        // it unchecked with a student now selected.
                        updateRow(file.name, { studentId: value, skipped: !value })
                      }
                      options={studentOptions}
                      placeholder={
                        studentsQuery.isLoading
                          ? "Loading students..."
                          : "Select student"
                      }
                      searchPlaceholder="Search By Name Or NIS"
                    />
                  </div>
                  {!row.studentId ? (
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
    {editingFileName && editingFile ? (
      <PhotoCropDialog
        file={editingFile}
        onCancel={() => setEditingFileName(null)}
        onCropped={(blob) => {
          setCroppedBlobs((current) => {
            const next = new Map(current);
            next.set(editingFileName, blob);
            return next;
          });
          setEditingFileName(null);
        }}
      />
    ) : null}
    </>
  );
}
