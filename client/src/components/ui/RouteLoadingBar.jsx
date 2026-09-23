import { useIsFetching } from '@tanstack/react-query'

export function RouteLoadingBar() {
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="fixed inset-x-0 top-0 z-[200] h-1 overflow-hidden bg-[#7E15181A]"
    >
      <div className="mws-route-loading-bar h-full w-[38%] rounded-r-full bg-gradient-to-r from-(--mws-burgundy) via-(--mws-rose) to-(--mws-gold) shadow-[0_0_12px_rgba(126,21,24,0.45)] motion-reduce:w-full" />
    </div>
  )
}

export function QueryLoadingBar() {
  return useIsFetching() > 0 ? <RouteLoadingBar /> : null
}
