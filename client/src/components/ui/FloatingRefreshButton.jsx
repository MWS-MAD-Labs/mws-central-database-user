import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

export function FloatingRefreshButton() {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)

  async function handleRefresh() {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await queryClient.invalidateQueries({ refetchType: 'active' })
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <button
      type="button"
      aria-label="Refresh all data"
      title="Refresh all data"
      disabled={isRefreshing}
      onClick={handleRefresh}
      className="fixed right-1 top-3 z-40 inline-flex h-7 w-7 items-center justify-center text-(--mws-burgundy) transition hover:text-(--mws-burgundy-dark) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy) disabled:opacity-50 md:right-2 md:top-5"
    >
      <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
    </button>
  )
}
