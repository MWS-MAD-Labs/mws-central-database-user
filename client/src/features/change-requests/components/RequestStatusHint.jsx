// What became of the requester's latest change request for a locked field.
export function RequestStatusHint({ request }) {
  if (!request || request.status === 'CANCELLED') return null
  if (request.status === 'PENDING') {
    return (
      <span className="font-semibold text-[#8a6419]">
        Change request pending.
      </span>
    )
  }
  const approved = request.status === 'APPROVED'
  return (
    <span className={approved ? 'font-semibold text-[#476b43]' : 'font-semibold text-[#a43c41]'}>
      Last request {approved ? 'approved' : 'rejected'}
      {request.decision_note ? `: ${request.decision_note}` : '.'}
    </span>
  )
}
