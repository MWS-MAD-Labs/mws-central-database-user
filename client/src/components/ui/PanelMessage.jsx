export function PanelMessage({ children, tone = 'neutral' }) {
  const classes =
    tone === 'error'
      ? 'border-[#f0c7c9] bg-[#fff6f6] text-(--mws-rose)'
      : 'border-(--mws-line) bg-white text-(--mws-muted)'

  return (
    <div className={`rounded-2xl border p-8 text-center text-sm ${classes}`}>
      {children}
    </div>
  )
}
