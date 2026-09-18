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
import { fetchAllPages } from "../../../lib/pagination.js";
import {
  MAX_BULK_PHOTO_BATCH_BYTES,
  chunkBulkUploadEntries,
  formatFileSize,
} from "../../../lib/fileSize.js";
import {
  startBulkPhotoUpload,
  useBulkPhotoUploadState,
} from "../../../lib/bulkPhotoUploadManager.js";
import { studentsApi } from "../api/studentsApi.js";

const THUMBNAIL_SIZE = 128;

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

function PhotoRowThumbnail({ source, large, cache }) {
  const cachedUrl = source ? cache.get(source) || null : null;
  const [thumbnailUrl, setThumbnailUrl] = useState(cachedUrl);
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
          className={`absolute inset-0 animate-pulse rounded-full border border-(--mws-line) bg-(--mws-line)`}
        />
      ) : (
        <img
          src={thumbnailUrl}
          alt=""
          className={`${sizeClass} rounded-full border border-(--mws-line) object-cover`}
        />
      )}
    </div>
  );
}

const REVIEW_PAGE_SIZE = 10;

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

export function BulkPhotoUploadDialog({ onClose }) {
  const [step, setStep] = useState("select");
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState(new Map());
  const [result, setResult] = useState(null);
  const [croppedBlobs, setCroppedBlobs] = useState(new Map());
  const [editingFileName, setEditingFileName] = useState(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [thumbnailCache] = useState(() => new Map());
  useEffect(() => {
    return () => {
      for (const url of thumbnailCache.values()) URL.revokeObjectURL(url);
      thumbnailCache.clear();
    };
  }, [thumbnailCache]);

  const uploadState = useBulkPhotoUploadState();
  const isMyUploadRunning =
    uploadState?.status === "running" && uploadState.kind === "student";

  const studentsQuery = useQuery({
    queryKey: ["students", "bulk-photo-roster"],
    queryFn: async () => {
      const result = await fetchAllPages(studentsApi.list, {
        sort_by: "full_name",
        sort_order: "asc",
      });
      return result.data;
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
        next.set(item.file_name, {
          studentId: singleMatch?.id || "",
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

  async function handleUpload() {
    const entries = [];
    for (const file of files) {
      const row = rows.get(file.name);
      if (!row || row.skipped || !row.studentId) continue;
      const croppedBlob = croppedBlobs.get(file.name);
      const uploadFile = croppedBlob
        ? new File([croppedBlob], file.name, {
            type: croppedBlob.type || file.type,
          })
        : file;
      entries.push({
        mapping: { file_name: file.name, student_id: row.studentId },
        file: uploadFile,
        size: uploadFile.size,
      });
    }

    try {
      const data = await startBulkPhotoUpload({
        kind: "student",
        label: "student photos",
        entries,
        commitFn: studentsApi.commitBulkPhotos,
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

    const seen = new Set();
    const duplicateNames = new Set();
    for (const file of selected) {
      if (seen.has(file.name)) duplicateNames.add(file.name);
      seen.add(file.name);
    }
    if (duplicateNames.size > 0) {
      showErrorToast(
        `${duplicateNames.size} file name${duplicateNames.size === 1 ? " is" : "s are"} used more than once: ${Array.from(duplicateNames).join(", ")}. Rename the duplicates first. Two files sharing a name would silently overwrite each other.`,
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
    (row) => !row.skipped && row.studentId,
  ).length;
  const unmatchedCount = files.filter(
    (file) => !rows.get(file.name)?.studentId,
  ).length;

  const totalBytes = files.reduce((sum, file) => {
    const row = rows.get(file.name);
    if (!row || row.skipped || !row.studentId) return sum;
    const size = croppedBlobs.get(file.name)?.size ?? file.size;
    return sum + size;
  }, 0);
  const estimatedBatchCount = Math.max(
    1,
    Math.ceil(totalBytes / MAX_BULK_PHOTO_BATCH_BYTES),
  );

  const editingFile = editingFileName
    ? croppedBlobs.get(editingFileName) ||
      files.find((file) => file.name === editingFileName)
    : null;

  const visibleFiles = showUnmatchedOnly
    ? files.filter((file) => !rows.get(file.name)?.studentId)
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
      description="Match each file to a student by name, review before uploading."
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
          <p className="text-sm text-(--mws-muted)">
            Select every photo file at once. Each file's name (without the
            extension) is matched against a student's full name e.g. "Seira"
            matches a student named "Seira".
          </p>
          <label
            className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-(--mws-line) p-8 text-center text-sm text-(--mws-muted) ${
              previewMutation.isPending
                ? "cursor-wait"
                : "cursor-pointer hover:border-(--mws-burgundy) hover:text-(--mws-burgundy)"
            }`}
          >
            {previewMutation.isPending ? (
              <>
                <Loader2 size={22} className="animate-spin" />
                <span>
                  Matching {files.length} file{files.length === 1 ? "" : "s"}{" "}
                  against the student roster. This can take a moment for a
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
            <p className="text-sm text-(--mws-muted)">
              {readyCount} of {files.length} file(s) ready to upload. Fix any
              unmatched or ambiguous rows below, or uncheck to skip.
            </p>
            <label
              className={`flex shrink-0 items-center gap-2 text-sm font-medium ${
                unmatchedCount === 0 && !showUnmatchedOnly
                  ? "text-(--mws-muted) opacity-60"
                  : "cursor-pointer text-(--mws-charcoal)"
              }`}
            >
              <input
                type="checkbox"
                checked={showUnmatchedOnly}
                disabled={unmatchedCount === 0 && !showUnmatchedOnly}
                onChange={(event) => {
                  setShowUnmatchedOnly(event.target.checked);
                  setReviewPage(1);
                }}
                className="h-4 w-4 accent-(--mws-burgundy)"
              />
              Show unmatched only ({unmatchedCount})
            </label>
          </div>
          <p className="text-sm font-medium text-(--mws-charcoal)">
            Total upload size: {formatFileSize(totalBytes)}
            {estimatedBatchCount > 1
              ? ` Sent automatically as ${estimatedBatchCount} batches, each under ${formatFileSize(MAX_BULK_PHOTO_BATCH_BYTES)}.`
              : null}
          </p>
          {isMyUploadRunning ? (
            <p className="text-sm text-(--mws-muted)">
              Safe to close this dialog now. The upload keeps going in the
              background, tracked from the status bar in the corner.
            </p>
          ) : null}
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {(() => {
              const isSingleFile = files.length === 1;
              return pagedFiles.map((file) => {
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
                    className={`flex flex-wrap items-center gap-3 rounded-xl border border-(--mws-line) ${isSingleFile ? "p-5" : "p-3"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!row.skipped}
                      disabled={!row.studentId}
                      title={!row.studentId ? "Select a student first" : undefined}
                      onChange={(event) =>
                        updateRow(file.name, { skipped: !event.target.checked })
                      }
                      className="h-4 w-4 accent-(--mws-burgundy) disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Include ${file.name}`}
                    />
                    <PhotoRowThumbnail
                      source={croppedBlobs.get(file.name) || file}
                      large={isSingleFile}
                      cache={thumbnailCache}
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-(--mws-charcoal)">
                        {file.name}
                      </span>
                      <span className="text-xs text-(--mws-muted)">
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
                    <div className={isSingleFile ? "w-full" : "w-full sm:w-64"}>
                      <SearchableSelect
                        value={row.studentId}
                        onChange={(value) =>
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
          <p className="text-sm text-(--mws-charcoal)">
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
