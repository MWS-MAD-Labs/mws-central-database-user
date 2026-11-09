import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'
import { PageHeader } from '../../../components/layout/PageHeader.jsx'
import { Button } from '../../../components/ui/Button.jsx'
import { PanelMessage } from '../../../components/ui/PanelMessage.jsx'
import { canWriteInUnit, editBlockedReason } from '../../../lib/capabilities.js'
import { useAuth } from '../../auth/hooks/useAuth.js'
import { loadStudentFormOptions } from '../api/studentFormOptions.js'
import { studentsApi } from '../api/studentsApi.js'
import {
  StudentConsentPanel,
  StudentHealthPanel,
  StudentParentsPanel,
  StudentVaccinePanel,
} from '../components/StudentSensitivePanels.jsx'

const CONFIG = {
  contacts: { title: 'Manage Contacts', tab: 'family-consent' },
  consent: { title: 'Manage Consent', tab: 'family-consent' },
  health: { title: 'Manage Health', tab: 'health' },
}

export function StudentManagePage({ section }) {
  const { studentId } = useParams()
  const { user } = useAuth()
  const config = CONFIG[section]
  const studentQuery = useQuery({
    queryKey: ['students', studentId],
    queryFn: () => studentsApi.get(studentId),
    enabled: Boolean(studentId),
  })
  const optionsQuery = useQuery({
    queryKey: ['student-form-options'],
    queryFn: loadStudentFormOptions,
  })

  if (!config) return <Navigate to={`/students/${studentId}`} replace />
  if (studentQuery.isLoading || optionsQuery.isLoading) return <PanelMessage>Loading student...</PanelMessage>
  if (studentQuery.isError || optionsQuery.isError || !studentQuery.data) return <PanelMessage>Student data is unavailable.</PanelMessage>

  const student = studentQuery.data
  const grade = (optionsQuery.data?.grades || []).find((item) => item.name === student.academic.current_grade)
  const baseWrite = user?.role === 'SUPER_ADMIN' || (user?.role === 'DATABASE_ADMIN' && Boolean(user?.can_write_student_data))
  const sameUnit = user?.role === 'SUPER_ADMIN' || canWriteInUnit(user, grade?.unit_id, 'student')
  const blocked = editBlockedReason(user, { hasWriteFlag: Boolean(user?.can_write_student_data), sameUnit })
  const canViewSensitive = user?.role === 'SUPER_ADMIN' || Boolean(user?.can_view_sensitive_data)
  const canManage = baseWrite && sameUnit && !blocked && canViewSensitive

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title={config.title}
        description={`${student.identity.full_name} / ${student.academic.nis || 'No NIS yet'}`}
        actions={
          <Button asChild variant="secondary" size="icon" aria-label="Back" title="Back">
            <Link to={`/students/${studentId}?tab=${config.tab}`}><ArrowLeft size={16} /></Link>
          </Button>
        }
      />
      {!canManage ? (
        <PanelMessage>{canViewSensitive ? (blocked || "You don't have permission to manage this student's data.") : "You don't have permission to access sensitive data."}</PanelMessage>
      ) : section === 'contacts' ? (
        <StudentParentsPanel studentId={studentId} canWrite revealed />
      ) : section === 'consent' ? (
        <StudentConsentPanel studentId={studentId} canWrite canViewSensitive />
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <StudentHealthPanel studentId={studentId} canWrite canViewSensitive />
          <StudentVaccinePanel studentId={studentId} canWrite canViewSensitive />
        </div>
      )}
    </div>
  )
}
