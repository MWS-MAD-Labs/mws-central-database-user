import { CheckCircle2, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import {
  clearBulkPhotoUpload,
  initBulkPhotoUploadSync,
  useBulkPhotoUploadState,
} from "../../lib/bulkPhotoUploadManager.js";
import { cn } from "../../lib/cn.js";

export function BulkPhotoUploadStatusBar() {
  useEffect(() => initBulkPhotoUploadSync(), []);
  const state = useBulkPhotoUploadState();

  if (!state) return null;

  const isRunning = state.status === "running";
  const isError = state.status === "error";
  const percent = state.total > 0 ? Math.round((state.completed / state.total) * 100) : 0;
  const remaining = state.total - state.completed;

  return (
    <div className="fixed bottom-4 left-1/2 z-60 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 md:bottom-5 md:left-auto md:right-5 md:translate-x-0">
      <div className="overflow-hidden rounded-2xl border border-(--mws-line) bg-white shadow-[0_18px_40px_-20px_rgba(36,23,24,0.5)]">
        <div className="flex items-start gap-3 p-4">
          {isRunning ? (
            <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-(--mws-line) border-t-(--mws-burgundy)" />
          ) : isError ? (
            <XCircle size={18} className="mt-0.5 shrink-0 text-[#9f3d41]" />
          ) : (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#3f7a4d]" />
          )}

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-(--mws-charcoal)">
              {isRunning
                ? `Uploading ${state.label || "photos"}...`
                : isError
                  ? "Upload failed"
                  : "Upload complete"}
            </p>
            <p className="mt-0.5 text-xs text-(--mws-muted)">
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
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-(--mws-soft)">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  isError ? "bg-[#9f3d41]" : "bg-(--mws-burgundy)",
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
              className="flex h-7 w-7 min-w-7 shrink-0 aspect-square items-center justify-center rounded-full border border-transparent text-(--mws-muted) transition hover:border-(--mws-line) hover:bg-(--mws-soft) hover:text-(--mws-charcoal) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--mws-burgundy)"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
