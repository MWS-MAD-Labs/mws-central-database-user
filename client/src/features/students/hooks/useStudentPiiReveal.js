import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useConfirm } from '../../../components/ui/useConfirm.js'
import { forgetReveal, hasRecentReveal, rememberReveal } from '../../../lib/piiRevealMemory.js'
import { showErrorToast } from '../../../lib/toast.js'
import { studentSensitiveApi } from '../api/studentSensitiveApi.js'

const studentPiiScope = (studentId) => `student-pii:${studentId}`

// Birth details and parent contacts stay hidden until an admin asks to see
// them; the request is logged once per student per viewing session.
export function useStudentPiiReveal(studentId, studentName) {
  const confirm = useConfirm()
  const [revealed, setRevealed] = useState(
    () => Boolean(studentId) && hasRecentReveal(studentPiiScope(studentId)),
  )

  const [data, setData] = useState(null)

  const mutation = useMutation({
    mutationFn: () => studentSensitiveApi.recordPiiAccess(studentId),
    onSuccess: (revealedData) => {
      rememberReveal(studentPiiScope(studentId))
      setData(revealedData)
      setRevealed(true)
    },
    onError: (error) => showErrorToast(error, 'Could not reveal sensitive fields.'),
  })

  // The values are never kept past the page, so a reveal remembered from an
  // earlier visit fetches them again (the server dedupes the audit entry).
  const { mutate } = mutation
  useEffect(() => {
    if (revealed && !data && studentId) mutate()
  }, [revealed, data, studentId, mutate])

  async function reveal() {
    const confirmed = await confirm({
      title: 'View sensitive fields',
      description: `View ${studentName || "this student"}'s birth details and parent/guardian contacts? This access is logged.`,
      confirmLabel: 'View',
    })
    if (confirmed) mutation.mutate()
  }

  return {
    revealed,
    data,
    isRevealing: mutation.isPending,
    reveal,
    hide: () => {
      forgetReveal(studentPiiScope(studentId))
      setRevealed(false)
      setData(null)
    },
  }
}
