export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-[#deded7] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-[#202326]">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[#676c70]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
