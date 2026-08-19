import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import {
  clearBulkPhotoUpload,
  initBulkPhotoUploadSync,
  useBulkPhotoUploadState,
} from "../../lib/bulkPhotoUploadManager.js";
import { cn } from "../../lib/cn.js";

// Mounted once at the app shell so it survives navigating away from
// whichever bulk-photo dialog started the upload, and mirrors progress
// from any other open tab of the app too (see bulkPhotoUploadManager.js).
export function BulkPhotoUploadStatusBar() {
  useEffect(() => initBulkPhotoUploadSync(), []);
  const state = useBulkPhotoUploadState();

  if (!state) return null;

  const isRunning = state.status === "running";
  const isError = state.status === "error";
  const percent = state.total > 0 ? Math.round((state.completed / state.total) * 100) : 0;
  const remaining = state.total - state.completed;

  return (
    <div className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 md:bottom-5 md:left-auto md:right-5 md:translate-x-0">
      <div className="overflow-hidden rounded-2xl border border-[var(--mws-line)] bg-white shadow-[0_18px_40px_-20px_rgba(36,23,24,0.5)]">
        <div className="flex items-start gap-3 p-4">
          {isRunning ? (
            <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--mws-line)] border-t-[var(--mws-burgundy)]" />
          ) : isError ? (
            <XCircle size={18} className="mt-0.5 shrink-0 text-[#9f3d41]" />
          ) : (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#3f7a4d]" />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--mws-charcoal)]">
              {isRunning
                ? `Uploading ${state.label || "photos"}...`
                : isError
                  ? "Upload failed"
                  : "Upload complete"}
            </p>
            <p className="mt-0.5 text-xs text-[var(--mws-muted)]">
              {isRunning ? (
                <>
                  {state.completed} of {state.total} done, {remaining} remaining
                  {state.totalBatches > 1 ? ` · batch ${state.currentBatch}/${state.totalBatches}` : null}
                </>
              ) : (
                <>
                  {state.result?.success_count ?? 0} succeeded, {state.result?.failed_count ?? 0} failed
                </>
              )}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--mws-soft)]">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  isError ? "bg-[#9f3d41]" : "bg-[var(--mws-burgundy)]",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {!isRunning ? (
            <button
              type="button"
              onClick={clearBulkPhotoUpload}
              aria-label="Dismiss"
              className="shrink-0 rounded-full p-1 text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
