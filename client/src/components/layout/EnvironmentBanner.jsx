import { useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef } from 'react'
import { apiRequest } from '../../lib/api.js'

// Staging only: PRODUCTION_URL is set on the staging server and not on the real one, so the real one shows nothing.
// The bar sits on top of the page, so its height is published for the sidebar and the mobile header to move down by.
export function EnvironmentBanner() {
  const { data } = useQuery({
    queryKey: ['public-config'],
    queryFn: () => apiRequest('/api/public-config'),
    staleTime: Infinity,
    retry: false,
  })
  const url = data?.data?.production_url ?? null
  const barRef = useRef(null)

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!url || !bar) return undefined
    const root = document.documentElement
    const publish = () => root.style.setProperty('--env-banner-h', `${bar.offsetHeight}px`)
    publish()
    window.addEventListener('resize', publish)
    return () => {
      window.removeEventListener('resize', publish)
      root.style.removeProperty('--env-banner-h')
    }
  }, [url])

  if (!url) return null

  return (
    <p
      ref={barRef}
      role="note"
      className="fixed inset-x-0 top-0 z-60 bg-[#8a6419] px-3 py-2 text-center text-xs font-semibold leading-5 text-white"
    >
      Ini versi uji coba Central. Perubahan di sini tidak dipakai. Untuk pekerjaan sebenarnya, buka{' '}
      <a href={url} className="underline underline-offset-2">
        {url}
      </a>
    </p>
  )
}
