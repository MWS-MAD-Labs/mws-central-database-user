import { useCallback, useMemo, useState } from 'react'
import { Button } from './Button.jsx'
import { ConfirmContext } from './confirmContext.js'
import { CrudDialog } from './CrudDialog.jsx'

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
        <CrudDialog
          title={request.title || 'Are you sure?'}
          description={request.description}
          onClose={() => settle(false)}
          footer={
            <>
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
            </>
          }
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}
