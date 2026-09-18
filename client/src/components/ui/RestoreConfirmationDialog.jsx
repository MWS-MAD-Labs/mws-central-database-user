import { RotateCcw } from "lucide-react";
import { Link } from "react-router";
import { CrudDialog } from "./CrudDialog.jsx";
import { Button } from "./Button.jsx";

export function RestoreConfirmationDialog({
  title,
  description,
  records,
  columns,
  getDetailHref,
  isSubmitting,
  onClose,
  onConfirm,
}) {
  if (!records?.length) return null;

  return (
    <CrudDialog
      title={title}
      description={description}
      panelClassName="max-w-5xl"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
            <RotateCcw size={15} />
            {isSubmitting ? "Restoring..." : `Restore ${records.length} record${records.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="mws-scrollbar overflow-x-auto rounded-xl border border-(--mws-line)">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="px-4 py-3">
                  {column.label}
                </th>
              ))}
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--mws-line)">
            {records.map((record) => (
              <tr key={record.id} className="bg-white align-top">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3">
                    {column.key === "name" && getDetailHref ? (
                      <Link
                        to={getDetailHref(record)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-display font-bold text-(--mws-burgundy) underline decoration-(--mws-burgundy)/30 underline-offset-2 hover:decoration-(--mws-burgundy)"
                      >
                        {column.render(record)}
                      </Link>
                    ) : (
                      column.render(record)
                    )}
                  </td>
                ))}
                <td className="px-4 py-3 font-semibold text-[#8a6419]">Archived</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CrudDialog>
  );
}
