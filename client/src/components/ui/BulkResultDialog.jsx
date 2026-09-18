import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { CrudDialog } from "./CrudDialog.jsx";
import { Button } from "./Button.jsx";
import { showErrorToast } from "../../lib/toast.js";

export function BulkResultDialog({
  title,
  result,
  getLabel,
  getDetailHref,
  onClose,
}) {
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const failed = (result.items || []).filter(
    (item) => item.status === "FAILED",
  );
  if (failed.length === 0) return null;

  async function handleCopy() {
    const text = failed
      .map(
        (item) =>
          `${getLabel?.(item.id) || item.label || item.id}: ${item.error}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showErrorToast("Couldn't copy to clipboard.");
    }
  }

  return (
    <CrudDialog
      title={title}
      description={`${failed.length} employee${failed.length === 1 ? "" : "s"} could not be archived. Resolve the issue and try again.`}
      onClose={onClose}
      panelClassName="max-w-3xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleCopy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="mws-scrollbar max-h-80 overflow-y-auto rounded-xl border border-(--mws-line)">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="sticky top-0 bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
            <tr>
              <th className="w-[34%] px-4 py-3">Employee</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--mws-line)">
            {failed.map((item) => {
              const detailHref = getDetailHref?.(item.id);
              return (
                <tr key={item.id} className="bg-white align-top">
                  <td className="px-4 py-3 font-display font-bold text-(--mws-charcoal)">
                    {detailHref ? (
                      <Link
                        to={detailHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-(--mws-burgundy) underline decoration-(--mws-burgundy)/30 underline-offset-2 hover:decoration-(--mws-burgundy)"
                      >
                        {getLabel?.(item.id) || item.label || item.id}
                      </Link>
                    ) : (
                      getLabel?.(item.id) || item.label || item.id
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm leading-5 text-[#991b1b]">
                    {item.error}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </CrudDialog>
  );
}
