import { Copy } from "lucide-react";
import { TextAction } from "../../../../components/ui/TextAction.jsx";
import { StatusBadge } from "../../../../components/ui/StatusBadge.jsx";
import { copyText } from "../../utils/copyText.js";

function Table({ rows, showValue }) {
  if (rows.length === 0) return <p className="text-xs text-(--mws-muted)">None for this application.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-(--mws-line)">
      <table className="w-full min-w-[34rem] text-left text-xs">
        <thead className="bg-(--mws-soft) text-(--mws-muted)">
          <tr>
            <th className="w-[38%] px-4 py-2.5 font-semibold">Name</th>
            <th className="w-[18%] px-4 py-2.5 font-semibold">Used by</th>
            <th className="px-4 py-2.5 font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-(--mws-line) align-top">
              <td className="px-4 py-3 font-mono break-all">{row.key}</td>
              <td className="px-4 py-3 text-(--mws-muted)">{row.usedBy}</td>
              <td className="px-4 py-3">
                {showValue && row.value ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono break-all">{row.value}</span>
                    <TextAction icon={Copy} onClick={() => copyText(row.value)} aria-label={`Copy ${row.key}`}>
                      Copy
                    </TextAction>
                  </span>
                ) : (
                  <span className="leading-5 text-(--mws-muted)">{row.source}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One GitHub environment (staging or production) with what to add in it. The values are only known for the Central
// that is being looked at. For the other one the card says where they come from.
export function GithubEnvironmentCard({ name, here, rows }) {
  const secrets = rows.filter((row) => row.kind === "Secret");
  const variables = rows.filter((row) => row.kind === "Variable");
  return (
    <section aria-label={`GitHub environment ${name}`} className="min-w-0 space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-base font-bold capitalize text-(--mws-charcoal)">{name}</h4>
        {here ? <StatusBadge tone="green">This Central</StatusBadge> : <StatusBadge tone="neutral">Another Central</StatusBadge>}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-(--mws-muted)">
        <li>
          In the repository open Settings, then Environments, then New environment, and name it{" "}
          <span className="font-mono text-(--mws-charcoal)">{name}</span>.
        </li>
        <li>Inside it, under Environment secrets and Environment variables, add the names below.</li>
        {here ? null : (
          <li>
            The values come from the {name} Central. Open this application there, make the connection, and copy them from its block.
          </li>
        )}
      </ol>
      <div className="space-y-2">
        <h5 className="text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Environment secrets</h5>
        <Table rows={secrets} showValue={here} />
      </div>
      <div className="space-y-2">
        <h5 className="text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Environment variables</h5>
        <Table rows={variables} showValue={here} />
      </div>
    </section>
  );
}
