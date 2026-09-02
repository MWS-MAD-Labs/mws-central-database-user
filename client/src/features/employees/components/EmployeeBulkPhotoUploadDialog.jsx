import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Pencil, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { PhotoCropDialog } from "../../../components/photo/PhotoCropDialog.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import {
  MAX_BULK_PHOTO_BATCH_BYTES,
  chunkBulkUploadEntries,
  formatFileSize,
} from "../../../lib/fileSize.js";
import {
  startBulkPhotoUpload,
  useBulkPhotoUploadState,
} from "../../../lib/bulkPhotoUploadManager.js";
import { employeesApi } from "../api/employeesApi.js";

const THUMBNAIL_SIZE = 128;

// These files run 10-15 MB each straight off a phone/camera - just pointing
// an <img> at the raw File (the old approach) meant a full decode of that
// 12 MB source every single time, including every time a page you'd
// already visited came back around, since the objectURL (and the browser's
// decode of it) got thrown away on unmount. createImageBitmap's resize
// hints let the browser decode straight to a small target size instead of
// decoding full-res first, and drawing that onto a small canvas guarantees
// a small result even on a browser that ignores the resize hint.
async function createThumbnailUrl(source) {
  const bitmap = await createImageBitmap(source, {
    resizeWidth: THUMBNAIL_SIZE,
    resizeHeight: THUMBNAIL_SIZE,
    resizeQuality: "medium",
  });
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not create thumbnail"));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.75,
    );
  });
}

// Circular preview for a row's current photo (cropped version if the admin
// edited it, otherwise the original file as picked). Larger in single-file
// mode - see the size note on the row card below.
//
// `cache` is a Map<source, thumbnailUrl> owned by the dialog itself (not
// this component) - it outlives any one row's mount, so paging away and
// back reuses the already-generated small thumbnail instantly instead of
// redoing the decode. Falls back to the original source (old behavior) if
// thumbnail generation fails for any reason - a slower preview beats none.
function PhotoRowThumbnail({ source, large, cache }) {
  const cachedUrl = source ? cache.get(source) || null : null;
  const [thumbnailUrl, setThumbnailUrl] = useState(cachedUrl);
  // Syncs to a cache hit (or resets to "generating" if there's none yet)
  // whenever source changes - adjusting state during render instead of an
  // effect, per React's own guidance for "reset state when a prop changes".
  const [syncedForSource, setSyncedForSource] = useState(source);
  if (source !== syncedForSource) {
    setSyncedForSource(source);
    setThumbnailUrl(cachedUrl);
  }

  useEffect(() => {
    if (!source || cache.get(source)) return;
    let cancelled = false;
    createThumbnailUrl(source)
      .then((url) => {
        if (cancelled) return;
        cache.set(source, url);
        setThumbnailUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        const fallbackUrl = URL.createObjectURL(source);
        cache.set(source, fallbackUrl);
        setThumbnailUrl(fallbackUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [source, cache]);

  if (!source) return null;
  const sizeClass = large ? "h-16 w-16" : "h-10 w-10";
  return (
    <div className={`relative ${sizeClass} shrink-0`}>
      {!thumbnailUrl ? (
        <div
          className={`absolute inset-0 animate-pulse rounded-full border border-[var(--mws-line)] bg-[var(--mws-line)]`}
        />
      ) : (
        <img
          src={thumbnailUrl}
          alt=""
          className={`${sizeClass} rounded-full border border-[var(--mws-line)] object-cover`}
        />
      )}
    </div>
  );
}

// Fixed, not admin-configurable - see the reviewPage state comment below.
const REVIEW_PAGE_SIZE = 10;

function employeeOptionsFor(employees) {
  return employees.map((employee) => ({
    value: employee.id,
    label: employee.identity.full_name,
    description: [employee.employment.employee_id, employee.employment.unit]
      .filter(Boolean)
      .join(" / "),
  }));
}

// Two steps: pick files -> preview matches files
// filenames matched against every employee's full name, then a review table
// lets the admin fix anything wrong (name collisions, typos, no match at
// all) before a single byte is actually uploaded.
export function EmployeeBulkPhotoUploadDialog({ onClose }) {
  const [step, setStep] = useState("select"); // 'select' | 'review' | 'result'
  const [files, setFiles] = useState([]);
  // Map<file_name, { employeeId: string, skipped: boolean, candidates: EmployeePhotoMatchCandidate[] }>
  const [rows, setRows] = useState(new Map());
  // Snapshot of the upload result once this dialog's job finishes - not a
  // live read of uploadState, so it can't be overwritten if another upload
  // starts elsewhere while this "result" screen is still on display.
  const [result, setResult] = useState(null);
  // Map<file_name, Blob> - present once a row's photo has been cropped/edited
  const [croppedBlobs, setCroppedBlobs] = useState(new Map());
  const [editingFileName, setEditingFileName] = useState(null);
  // Paging over the review list only - a few hundred rows, each carrying a
  // SearchableSelect, rendered all at once was the actual "heavy" part the
  // admin ran into. readyCount/totalBytes below still walk the full files
  // array regardless of what page is showing. Fixed page size (no "Rows"
  // picker) - a larger page just brings the same heaviness right back.
  const [reviewPage, setReviewPage] = useState(1);
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  // Map<File|Blob, thumbnailUrl> - lives for the dialog's whole lifetime
  // (see PhotoRowThumbnail/createThumbnailUrl above), so revisiting a page
  // reuses an already-generated thumbnail instead of regenerating it. State
  // (not a ref) so it's safe to read during render, but never replaced -
  // only ever mutated in place via .set(), so mutating it doesn't itself
  // trigger a re-render (each row's own thumbnailUrl state does that).
  const [thumbnailCache] = useState(() => new Map());
  useEffect(() => {
    return () => {
      for (const url of thumbnailCache.values()) URL.revokeObjectURL(url);
      thumbnailCache.clear();
    };
  }, [thumbnailCache]);

  // The actual upload runs outside this component (bulkPhotoUploadManager.js)
  // so it survives the dialog closing or the admin navigating away - this
  // just mirrors its live progress for as long as the dialog stays open.
  const uploadState = useBulkPhotoUploadState();
  const isMyUploadRunning =
    uploadState?.status === "running" && uploadState.kind === "employee";

  // The search endpoint caps size at 100 (consistent across every paginated
  // endpoint in the app) - matching by name needs the *entire* roster, not
  // just the first page, so this walks every page instead of requesting one
  // oversized one (which would just 400 outright).
  const employeesQuery = useQuery({
    queryKey: ["employees", "bulk-photo-roster"],
    queryFn: async () => {
      const allEmployees = [];
      let page = 1;
      let totalPages;
      do {
        const response = await employeesApi.list({
          page,
          size: 100,
          sort_by: "full_name",
          sort_order: "asc",
        });
        allEmployees.push(...(response.data || []));
        totalPages = response.paging?.total_page || 1;
        page += 1;
      } while (page <= totalPages);
      return allEmployees;
    },
    enabled: step !== "select",
  });
  const employeeOptions = employeeOptionsFor(employeesQuery.data || []);

  const previewMutation = useMutation({
    mutationFn: (fileNames) => employeesApi.previewBulkPhotos(fileNames),
    onSuccess: (preview) => {
      const next = new Map();
      for (const item of preview) {
        const singleMatch =
          item.candidates.length === 1 ? item.candidates[0] : null;
        // Default-skip a confident match who already has a photo on file -
        // a bulk re-upload is more often a mistake (wrong folder, re-running
        // an old batch) than an intentional replacement, so make the admin
        // opt back in rather than silently overwrite. No match (or an
        // ambiguous one) also starts unchecked - there's no employee to
        // upload to yet, so a checked box would be misleading. Picking one
        // from the dropdown (see updateRow's employeeId handling below)
        // turns it back on.
        next.set(item.file_name, {
          employeeId: singleMatch?.id || "",
          skipped: !singleMatch || Boolean(singleMatch.has_photo),
          candidates: item.candidates,
        });
      }
      setRows(next);
      setStep("review");
      setReviewPage(1);
    },
    onError: (error) => showErrorToast(error, "Could not match files."),
  });

  // Kicks off the shared upload job and returns immediately - the actual
  // chunked upload runs independently of this component from here on (see
  // bulkPhotoUploadManager.js), tracked by the floating status bar mounted
  // in AppShell. This only sticks around to show the result screen if the
  // admin happens to leave the dialog open until it finishes.
  async function handleUpload() {
    const entries = [];
    for (const file of files) {
      const row = rows.get(file.name);
      if (!row || row.skipped || !row.employeeId) continue;
      const croppedBlob = croppedBlobs.get(file.name);
      // Blob has no filename of its own - wrap it in a File carrying the
      // original name so the server's filename-based matching still works.
      const uploadFile = croppedBlob
        ? new File([croppedBlob], file.name, {
            type: croppedBlob.type || file.type,
          })
        : file;
      entries.push({
        mapping: { file_name: file.name, employee_id: row.employeeId },
        file: uploadFile,
        size: uploadFile.size,
      });
    }

    try {
      const data = await startBulkPhotoUpload({
        kind: "employee",
        label: "employee photos",
        entries,
        commitFn: employeesApi.commitBulkPhotos,
        chunkFn: chunkBulkUploadEntries,
      });
      setResult(data);
      setStep("result");
      if (data.success_count > 0) {
        showSuccessToast(`${data.success_count} photo(s) uploaded.`);
      }
      if (data.failed_count > 0) {
        showErrorToast(`${data.failed_count} upload(s) failed.`);
      }
    } catch (error) {
      showErrorToast(error, "Could not start upload.");
    }
  }

  function handleFilesSelected(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (selected.length === 0) return;

    // Both the matching preview (rows keyed by file_name) and the actual
    // upload (server-side files.set(entry.name, entry) in the controller)
    // treat filename as a unique key end to end - two files sharing a name
    // (common with generic camera filenames like IMG_0001.jpg pulled from
    // different phones) silently collapse into one, and BOTH employees
    // would quietly get the same photo with no error. Caught here instead,
    // before a single byte goes anywhere.
    const seen = new Set();
    const duplicateNames = new Set();
    for (const file of selected) {
      if (seen.has(file.name)) duplicateNames.add(file.name);
      seen.add(file.name);
    }
    if (duplicateNames.size > 0) {
      showErrorToast(
        `${duplicateNames.size} file name${duplicateNames.size === 1 ? " is" : "s are"} used more than once: ${Array.from(duplicateNames).join(", ")}. Rename the duplicates first - two files sharing a name would silently overwrite each other.`,
      );
      return;
    }

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
    (row) => !row.skipped && row.employeeId,
  ).length;
  // "Unmatched" here covers both no-match and ambiguous-match rows (see
  // previewMutation above) - both leave row.employeeId empty, which is
  // exactly what needs fixing before it can be checked back on. Paging
  // through a few hundred files to find the handful that need attention
  // isn't practical, so this narrows the list down to just those.
  const unmatchedCount = files.filter(
    (file) => !rows.get(file.name)?.employeeId,
  ).length;

  // Bytes that will actually go out - same rows commitMutation includes,
  // sized by the cropped blob when one exists (that's what actually gets
  // sent instead of the original file). Recomputes on every checkbox/crop
  // change since it's plain derived state, no extra effect needed.
  const totalBytes = files.reduce((sum, file) => {
    const row = rows.get(file.name);
    if (!row || row.skipped || !row.employeeId) return sum;
    const size = croppedBlobs.get(file.name)?.size ?? file.size;
    return sum + size;
  }, 0);
  // How many requests commitMutation will actually split this into - a
  // rough estimate for display (sizes only, ignores the file-count
  // ceiling), not worth recomputing the real chunker just to show a number.
  const estimatedBatchCount = Math.max(
    1,
    Math.ceil(totalBytes / MAX_BULK_PHOTO_BATCH_BYTES),
  );

  const editingFile = editingFileName
    ? croppedBlobs.get(editingFileName) ||
      files.find((file) => file.name === editingFileName)
    : null;

  const visibleFiles = showUnmatchedOnly
    ? files.filter((file) => !rows.get(file.name)?.employeeId)
    : files;
  const reviewTotalPages = Math.max(
    Math.ceil(visibleFiles.length / REVIEW_PAGE_SIZE),
    1,
  );
  const clampedReviewPage = Math.min(reviewPage, reviewTotalPages);
  const pagedFiles = visibleFiles.slice(
    (clampedReviewPage - 1) * REVIEW_PAGE_SIZE,
    clampedReviewPage * REVIEW_PAGE_SIZE,
  );

  return (
    <>
    <CrudDialog
      title="Bulk Photo Upload"
      description="Match each file to an employee by name, review before uploading."
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        step === "review" ? (
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              {isMyUploadRunning ? "Close" : "Cancel"}
            </Button>
            <Button
              type="button"
              disabled={readyCount === 0 || uploadState?.status === "running"}
              onClick={handleUpload}
              title={
                uploadState?.status === "running" && !isMyUploadRunning
                  ? "Wait for the other upload in progress to finish first"
                  : undefined
              }
            >
              {isMyUploadRunning
                ? uploadState.totalBatches > 1
                  ? `Uploading batch ${uploadState.currentBatch}/${uploadState.totalBatches}...`
                  : "Uploading..."
                : uploadState?.status === "running"
                  ? "Another upload is running..."
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
            extension) is matched against an employee's full name e.g.
            "Seira" matches an employee named "Seira".
          </p>
          <label
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--mws-line)] p-8 text-center text-sm text-[var(--mws-muted)] ${
              previewMutation.isPending
                ? "cursor-wait"
                : "cursor-pointer hover:border-[var(--mws-burgundy)] hover:text-[var(--mws-burgundy)]"
            }`}
          >
            {previewMutation.isPending ? (
              <>
                <Loader2 size={22} className="animate-spin" />
                <span>
                  Matching {files.length} file{files.length === 1 ? "" : "s"}{" "}
                  against the employee roster. This can take a moment for a
                  large batch.
                </span>
              </>
            ) : (
              <>
                <Upload size={22} />
                Click to select photo files
              </>
            )}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--mws-muted)]">
              {readyCount} of {files.length} file(s) ready to upload. Fix any
              unmatched or ambiguous rows below, or uncheck to skip.
            </p>
            <label
              className={`flex shrink-0 items-center gap-2 text-sm font-medium ${
                unmatchedCount === 0 && !showUnmatchedOnly
                  ? "text-[var(--mws-muted)] opacity-60"
                  : "cursor-pointer text-[var(--mws-charcoal)]"
              }`}
            >
              <input
                type="checkbox"
                checked={showUnmatchedOnly}
                // Only blocks turning the filter ON when there's nothing
                // to show - if it's already on and the count later drops
                // to 0 (rows got matched while filtered), turning it back
                // off must still work, or it gets stuck checked+disabled.
                disabled={unmatchedCount === 0 && !showUnmatchedOnly}
                onChange={(event) => {
                  setShowUnmatchedOnly(event.target.checked);
                  setReviewPage(1);
                }}
                className="h-4 w-4 accent-[var(--mws-burgundy)]"
              />
              Show unmatched only ({unmatchedCount})
            </label>
          </div>
          <p className="text-sm font-medium text-[var(--mws-charcoal)]">
            Total upload size: {formatFileSize(totalBytes)}
            {estimatedBatchCount > 1
              ? ` Sent automatically as ${estimatedBatchCount} batches, each under ${formatFileSize(MAX_BULK_PHOTO_BATCH_BYTES)}.`
              : null}
          </p>
          {isMyUploadRunning ? (
            <p className="text-sm text-[var(--mws-muted)]">
              Safe to close this dialog now. The upload keeps going in the
              background - track it from the status bar in the corner.
            </p>
          ) : null}
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {(() => {
              // A single file has no neighboring rows to stay compact
              // alongside - the same tight padding/thumbnail/picker sizing a
              // dense multi-file list needs just reads as a small, sparse
              // card when it's the only thing in the dialog. Sized up here
              // instead so it looks like a proper one-item review, not a
              // list row that lost its list.
              const isSingleFile = files.length === 1;
              return pagedFiles.map((file) => {
                const row = rows.get(file.name) || {
                  employeeId: "",
                  skipped: false,
                  candidates: [],
                };
                const selectedCandidate = row.candidates?.find(
                  (candidate) => candidate.id === row.employeeId,
                );
                const fileSize =
                  croppedBlobs.get(file.name)?.size ?? file.size;
                return (
                  <div
                    key={file.name}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border border-[var(--mws-line)] ${isSingleFile ? "p-5" : "p-3"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!row.skipped}
                      disabled={!row.employeeId}
                      title={!row.employeeId ? "Select an employee first" : undefined}
                      onChange={(event) =>
                        updateRow(file.name, { skipped: !event.target.checked })
                      }
                      className="h-4 w-4 accent-[var(--mws-burgundy)] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Include ${file.name}`}
                    />
                    <PhotoRowThumbnail
                      source={croppedBlobs.get(file.name) || file}
                      large={isSingleFile}
                      cache={thumbnailCache}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--mws-charcoal)]">
                        {file.name}
                      </span>
                      <span className="text-xs text-[var(--mws-muted)]">
                        {formatFileSize(fileSize)}
                      </span>
                    </div>
                    {selectedCandidate?.has_photo ? (
                      <StatusBadge tone="neutral" title="This employee already has a photo on file">
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
                    <div className={isSingleFile ? "w-full" : "w-full sm:w-64"}>
                      <SearchableSelect
                        value={row.employeeId}
                        onChange={(value) =>
                          // Picking an employee is a clear signal to include
                          // this row - turn the checkbox back on instead of
                          // leaving it unchecked with an employee now selected.
                          updateRow(file.name, { employeeId: value, skipped: !value })
                        }
                        options={employeeOptions}
                        placeholder={
                          employeesQuery.isLoading
                            ? "Loading employees..."
                            : "Select employee"
                        }
                        searchPlaceholder="Search By Name Or Employee ID"
                      />
                    </div>
                    {!row.employeeId ? (
                      <StatusBadge tone="amber">No match</StatusBadge>
                    ) : null}
                  </div>
                );
              });
            })()}
          </div>
          {visibleFiles.length > REVIEW_PAGE_SIZE ? (
            <PaginationBar
              paging={{
                current_page: clampedReviewPage,
                total_page: reviewTotalPages,
                total_item: visibleFiles.length,
                size: REVIEW_PAGE_SIZE,
              }}
              itemLabel="files"
              onPrevious={() =>
                setReviewPage((page) => Math.max(page - 1, 1))
              }
              onNext={() =>
                setReviewPage((page) => Math.min(page + 1, reviewTotalPages))
              }
              onPageChange={(page) => setReviewPage(page)}
            />
          ) : null}
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
