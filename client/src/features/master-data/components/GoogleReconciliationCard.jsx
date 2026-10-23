import { useMutation } from '@tanstack/react-query'
import { Download, Scale } from 'lucide-react'
import { Button } from '../../../components/ui/Button.jsx'
import { ListPopover } from '../../../components/ui/ListPopover.jsx'
import { showErrorToast } from '../../../lib/toast.js'
import { googleAccountApi } from '../../google/api/googleAccountApi.js'
import { PanelFrame } from './PanelFrame.jsx'
import { GROUPS, reconciliationCsv } from '../utils/reconciliationCsv.js'

function download(report) {
  const blob = new Blob([reconciliationCsv(report)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `google-reconciliation-${report.generated_at.slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const clock = (value) => new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// Where Central and Google disagree. It only reads, and only when the button is pressed: it asks Google for everyone.
export function GoogleReconciliationCard() {
  const run = useMutation({
    mutationFn: googleAccountApi.reconcile,
    onError: (error) => showErrorToast(error, 'Google could not be compared.'),
  })
  const report = run.data

  return (
    <PanelFrame
      title="Central And Google"
      description="Where the people in Central and the accounts in Google disagree."
      icon={Scale}
      isFetching={run.isPending}
      action={
        <Button type="button" loading={run.isPending} onClick={() => run.mutate()}>
          Run Report
        </Button>
      }
    >
      <div className="space-y-5 p-5">
        {!report ? (
          <p className="text-sm text-(--mws-muted)">{run.isError ? run.error?.message || 'Google could not be compared.' : 'Not run yet.'}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-(--mws-muted)">
              <span>
                Run at {clock(report.generated_at)}. {report.central_people} People In Central, {report.google_users} Accounts In Google.
              </span>
              <Button type="button" variant="secondary" onClick={() => download(report)}>
                <Download size={15} /> Download CSV
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GROUPS.map((group) => {
                const data = report.groups[group.key]
                return (
                  <div key={group.key} className="rounded-2xl border border-(--mws-line) bg-(--mws-soft) p-4">
                    <p className="text-xs font-semibold text-(--mws-muted)">{group.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-(--mws-charcoal)">{data.count}</p>
                    {data.count > 0 ? (
                      <ListPopover
                        label="List"
                        count={data.count}
                        dialogLabel={group.label}
                        mono={false}
                        groups={[
                          {
                            hideCount: true,
                            items: data.rows.map((row) => ({ label: row.name, hint: `${row.email}. ${row.detail}` })),
                          },
                        ]}
                      />
                    ) : null}
                    {data.truncated ? <p className="mt-1 text-xs text-(--mws-muted)">First {data.rows.length} shown. The CSV has the same.</p> : null}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </PanelFrame>
  )
}
