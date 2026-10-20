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
              <td className="px-4 py-3 font-mono break-all">{row.name ?? row.key}</td>
              <td className="px-4 py-3 text-(--mws-muted)">{row.usedBy}</td>
              <td className="px-4 py-3">
                {showValue && row.value ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono break-all">{row.value}</span>
                    <TextAction onClick={() => copyText(row.value)} aria-label={`Copy ${row.key}`}>
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
export function GithubEnvironmentCard({ name, here, rows: allRows, mode = "environments" }) {
  const prefixed = mode === "prefixed";
  // Only what the deploy pipeline reads is set in GitHub. The rest is in ServerEnvCard.
  const rows = allRows.filter((row) => row.target === "github");
  const secrets = rows.filter((row) => row.kind === "Secret");
  const variables = rows.filter((row) => row.kind === "Variable");
  return (
    <section aria-label={`GitHub environment ${name}`} className="min-w-0 space-y-4 rounded-2xl border border-(--mws-line) bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-base font-bold capitalize text-(--mws-charcoal)">{name}</h4>
        {here ? <StatusBadge tone="green">This Central</StatusBadge> : <StatusBadge tone="neutral">Another Central</StatusBadge>}
      </div>
      {prefixed ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-(--mws-muted)">
          <li>In the repository open Settings, then Secrets and variables, then Actions, then New repository secret.</li>
          <li>
            Add each name below, and only these. The {name.toUpperCase()}_ in front keeps {name} apart from the other environment. The
            application itself reads the plain names without it, in the .env of its server.
          </li>
          {here ? null : (
            <li>
              The values come from the {name} Central. Open this application there, make the connection, and copy them from its block.
            </li>
          )}
        </ol>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-(--mws-muted)">
          <li>
            In the repository open Settings, then Environments, then New environment, and name it{" "}
            <span className="font-mono text-(--mws-charcoal)">{name}</span>.
          </li>
          <li>Inside it, under Environment secrets and Environment variables, add the names below, and only these.</li>
          {here ? null : (
            <li>
              The values come from the {name} Central. Open this application there, make the connection, and copy them from its block.
            </li>
          )}
        </ol>
      )}
      {prefixed ? (
        <div className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Repository secrets</h5>
          <Table rows={rows} showValue={here} />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h5 className="text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Environment secrets</h5>
            <Table rows={secrets} showValue={here} />
          </div>
          <div className="space-y-2">
            <h5 className="text-xs font-bold uppercase tracking-wide text-(--mws-muted)">Environment variables</h5>
            <Table rows={variables} showValue={here} />
          </div>
        </>
      )}
    </section>
  );
}

// The lines of the block that are not set in GitHub: the server reads them from its own environment.
export function ServerEnvCard({ rows, environment }) {
  const server = rows.filter((row) => row.target === "server");
  if (server.length === 0) return null;
  return (
    <section aria-label="Not in GitHub" className="min-w-0 space-y-3 rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-base font-bold text-(--mws-charcoal)">Not In GitHub</h4>
        <StatusBadge tone="neutral">Server only</StatusBadge>
      </div>
      <p className="text-sm text-(--mws-muted)">
        Do not add these to GitHub. Put them in the .env of the server, which is the Environment field of the stack in Komodo, with
        these plain names. They come from the block Central shows when the connection is made, in the {environment} Central. If you
        already made them in GitHub, you can delete them. Nothing reads them there.
      </p>
      <Table rows={server} showValue={false} />
    </section>
  );
}
