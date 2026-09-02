import { Eye } from "lucide-react";
import { Link } from "react-router";
import { CrudDialog } from "./CrudDialog.jsx";
import { Button } from "./Button.jsx";

// Every bulk action (enroll, promote, transfer, close, ...) returns
// { success_count, failed_count, items: [{ id, status, error }] } - the
// toast version of this just joins every reason into one line with no way
// to tell which item it belongs to. This shows the actual failed rows,
// each labeled by whatever the caller can look up for that id (a name,
// usually). A single-item result (one student, one failure) still renders
// here rather than falling back to a toast - same failure, same fix flow,
// no reason for it to look different just because there was only one.
//
// getDetailHref is optional and caller-supplied on purpose - item.id means
// different things for different bulk actions (a student id for enroll,
// an enrollment id for promote/transfer/close), so only a caller that
// actually knows which it has should offer the "view detail" link.
export function BulkResultDialog({
  title,
  result,
  getLabel,
  getDetailHref,
  onClose,
}) {
  if (!result) return null;
  const failed = (result.items || []).filter(
    (item) => item.status === "FAILED",
  );
  if (failed.length === 0) return null;

  return (
    <CrudDialog
      title={title}
      description={`${result.success_count || 0} succeeded, ${failed.length} failed. Fix these and try again for just the ones below.`}
      onClose={onClose}
      footer={
        <Button type="button" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--mws-line)]">
        <div className="divide-y divide-[var(--mws-line)]">
          {failed.map((item) => {
            const detailHref = getDetailHref?.(item.id);
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
                    {getLabel(item.id) || item.id}
                  </p>
                  <p className="text-xs text-[#991b1b]">{item.error}</p>
                </div>
                {detailHref ? (
                  <Link
                    to={detailHref}
                    target="_blank"
                    rel="noreferrer"
                    title="Open detail in a new tab"
                    className="shrink-0 rounded-lg p-1.5 text-[var(--mws-muted)] hover:bg-[var(--mws-soft)] hover:text-[var(--mws-burgundy)]"
                  >
                    <Eye size={15} />
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </CrudDialog>
  );
}
