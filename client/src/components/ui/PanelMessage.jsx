export function PanelMessage({ children, tone = 'neutral' }) {
  const classes =
    tone === 'error'
      ? 'border-[#e8c7c2] bg-[#fff4f2] text-[#8f2f2f]'
      : 'border-[#deded7] bg-white text-[#77736a]'

  return (
    <div className={`rounded-md border p-8 text-center text-sm shadow-sm ${classes}`}>
      {children}
    </div>
  )
}
