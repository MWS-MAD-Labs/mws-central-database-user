import { useCallback, useMemo, useState } from 'react'
import { Button } from './Button.jsx'
import { ConfirmContext } from './confirmContext.js'

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { description: options } : options
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

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#24171899] px-4">
          <div
            className={
              'w-full rounded-3xl border border-[var(--mws-line)] bg-white p-5 shadow-2xl ' +
              (request.wide ? 'max-w-lg' : 'max-w-sm')
            }
          >
            <h2 className="font-display text-lg font-bold text-[var(--mws-charcoal)]">
              {request.title || 'Are you sure?'}
            </h2>
            {request.description ? (
              typeof request.description === 'string' ? (
                <p className="mt-2 text-sm leading-6 text-[var(--mws-muted)]">
                  {request.description}
                </p>
              ) : (
                <div className="mt-2 text-sm leading-6 text-[var(--mws-muted)]">
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
                onClick={() => settle(true)}
              >
                {request.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  )
}
