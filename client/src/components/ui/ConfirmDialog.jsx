import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from './Button.jsx'
import { ConfirmContext } from './confirmContext.js'

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const titleId = useId()

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { description: options } : options
    setRemainingSeconds(opts.delaySeconds || 0)
    return new Promise((resolve) => {
      setRequest({ ...opts, resolve })
    })
  }, [])

  const settle = useCallback(
    (result) => {
      request?.resolve(result)
      setRequest(null)
    },
    [request],
  )

  const isCountingDown = remainingSeconds > 0
  useEffect(() => {
    if (!isCountingDown) return
    const timer = setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(seconds - 1, 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [isCountingDown])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#24171899] px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={
              'flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-3xl border border-(--mws-line) bg-white p-5 shadow-2xl ' +
              (request.wide ? 'max-w-lg' : 'max-w-sm')
            }
          >
            <h2 id={titleId} className="font-display text-lg font-bold text-(--mws-charcoal)">
              {request.title || 'Are you sure?'}
            </h2>
            {request.description ? (
              typeof request.description === 'string' ? (
                <p className="mt-2 text-sm leading-6 text-(--mws-muted)">
                  {request.description}
                </p>
              ) : (
                <div className="mt-2 text-sm leading-6 text-(--mws-muted)">
                  {request.description}
                </div>
              )
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => settle(false)}>
                {request.cancelLabel || 'Cancel'}
              </Button>
              <Button
                type="button"
                variant={request.tone === 'danger' ? 'danger' : 'primary'}
                disabled={remainingSeconds > 0}
                onClick={() => settle(true)}
              >
                {remainingSeconds > 0 ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {`Wait ${remainingSeconds}s...`}
                  </>
                ) : (
                  request.confirmLabel || 'Confirm'
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  )
}
