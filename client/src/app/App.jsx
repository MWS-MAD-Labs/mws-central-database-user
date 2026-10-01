import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '../components/layout/AppShell.jsx'
import { ProtectedRoute } from '../routes/ProtectedRoute.jsx'
import { CapabilityRoute } from '../routes/CapabilityRoute.jsx'
import {
  canEditStudentProfiles,
  canEditWorkforceProfiles,
  canViewAcademic,
  canViewStudents,
  canViewWorkforce,
} from '../lib/capabilities.js'

const AccessPage = lazy(() => import('../features/access/pages/AccessPage.jsx').then((module) => ({ default: module.AccessPage })))
const AcademicPage = lazy(() => import('../features/academic/pages/AcademicPage.jsx').then((module) => ({ default: module.AcademicPage })))
const ClassDetailPage = lazy(() => import('../features/academic/pages/ClassDetailPage.jsx').then((module) => ({ default: module.ClassDetailPage })))
const PcActivityRoomDetailPage = lazy(() => import('../features/academic/pages/PcActivityRoomDetailPage.jsx').then((module) => ({ default: module.PcActivityRoomDetailPage })))
const ApiClientsPage = lazy(() => import('../features/api-clients/pages/ApiClientsPage.jsx').then((module) => ({ default: module.ApiClientsPage })))
const AuditLogsPage = lazy(() => import('../features/audit/pages/AuditLogsPage.jsx').then((module) => ({ default: module.AuditLogsPage })))
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage.jsx').then((module) => ({ default: module.LoginPage })))
const DashboardPage = lazy(() => import('../features/dashboard/pages/DashboardPage.jsx').then((module) => ({ default: module.DashboardPage })))
const EmployeeCreatePage = lazy(() => import('../features/employees/pages/EmployeeCreatePage.jsx').then((module) => ({ default: module.EmployeeCreatePage })))
const EmployeeDetailPage = lazy(() => import('../features/employees/pages/EmployeeDetailPage.jsx').then((module) => ({ default: module.EmployeeDetailPage })))
const EmployeeEditPage = lazy(() => import('../features/employees/pages/EmployeeEditPage.jsx').then((module) => ({ default: module.EmployeeEditPage })))
const EmployeesPage = lazy(() => import('../features/employees/pages/EmployeesPage.jsx').then((module) => ({ default: module.EmployeesPage })))
const InternCreatePage = lazy(() => import('../features/interns/pages/InternCreatePage.jsx').then((module) => ({ default: module.InternCreatePage })))
const InternDetailPage = lazy(() => import('../features/interns/pages/InternDetailPage.jsx').then((module) => ({ default: module.InternDetailPage })))
const InternEditPage = lazy(() => import('../features/interns/pages/InternEditPage.jsx').then((module) => ({ default: module.InternEditPage })))
const InternsPage = lazy(() => import('../features/interns/pages/InternsPage.jsx').then((module) => ({ default: module.InternsPage })))
const ProfilePage = lazy(() => import('../features/profile/pages/ProfilePage.jsx').then((module) => ({ default: module.ProfilePage })))
const StudentCreatePage = lazy(() => import('../features/students/pages/StudentCreatePage.jsx').then((module) => ({ default: module.StudentCreatePage })))
const StudentDetailPage = lazy(() => import('../features/students/pages/StudentDetailPage.jsx').then((module) => ({ default: module.StudentDetailPage })))
const StudentEditPage = lazy(() => import('../features/students/pages/StudentEditPage.jsx').then((module) => ({ default: module.StudentEditPage })))
const StudentsPage = lazy(() => import('../features/students/pages/StudentsPage.jsx').then((module) => ({ default: module.StudentsPage })))
const RoleHome = lazy(() => import('../routes/RoleHome.jsx').then((module) => ({ default: module.RoleHome })))
const MasterData = lazy(() => import('../features/master-data/pages/MasterData.jsx'))
const ChangeRequestsPage = lazy(() => import('../features/change-requests/pages/ChangeRequestsPage.jsx').then((module) => ({ default: module.ChangeRequestsPage })))
const WorkspaceTable = lazy(() => import('../features/tableTecher/pages/WorkspaceTable.jsx').then((module) => ({ default: module.WorkspaceTable })))

function LoginFallback() {
  return <div className="min-h-svh bg-[#fffafa]" />
}

export default function App() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleHome />} />
          <Route path="dashboard" element={<DashboardPage />} />
           <Route element={<CapabilityRoute allowed={canViewWorkforce} title="Employee & Intern Access Required" description="Your account cannot browse employee or intern records." />}>
             <Route path="employees" element={<EmployeesPage />} />
             <Route path="employees/:employeeId" element={<EmployeeDetailPage />} />
             <Route path="interns" element={<InternsPage />} />
             <Route path="interns/:internId" element={<InternDetailPage />} />
           </Route>
           <Route element={<CapabilityRoute allowed={canEditWorkforceProfiles} title="Employee Write Access Required" description="Your account cannot create or edit employee and intern profiles." />}>
             <Route path="employees/new" element={<EmployeeCreatePage />} />
             <Route path="employees/:employeeId/edit" element={<EmployeeEditPage />} />
             <Route path="interns/new" element={<InternCreatePage />} />
             <Route path="interns/:internId/edit" element={<InternEditPage />} />
           </Route>
           <Route element={<CapabilityRoute allowed={canViewStudents} title="Student Access Required" description="Your account cannot browse student records." />}>
             <Route path="students" element={<StudentsPage />} />
             <Route path="students/:studentId" element={<StudentDetailPage />} />
           </Route>
           <Route element={<CapabilityRoute allowed={canEditStudentProfiles} title="Student Write Access Required" description="Your account cannot create or edit student profiles." />}>
             <Route path="students/new" element={<StudentCreatePage />} />
             <Route path="students/:studentId/edit" element={<StudentEditPage />} />
           </Route>
           <Route element={<CapabilityRoute allowed={canViewAcademic} title="Academic Access Required" description="Student or employee access is required to view academic structure." />}>
             <Route path="academic" element={<AcademicPage />} />
             <Route path="academic/classes/:classId" element={<ClassDetailPage />} />
             <Route path="academic/pc-activity-rooms/:roomId" element={<PcActivityRoomDetailPage />} />
           </Route>
          <Route path="access" element={<AccessPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="api-clients" element={<ApiClientsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route element={<CapabilityRoute allowed={(user) => Boolean(user?.is_employee_identifier_change_approver)} title="Approver Access Required" description="Only change request approvers can review requests." />}>
            <Route path="change-requests" element={<ChangeRequestsPage />} />
          </Route>
          <Route path="master-data" element={<MasterData />} />
           <Route element={<CapabilityRoute allowed={canViewStudents} title="Student Access Required" description="Workspace contains student and enrollment data." />}>
             <Route path="workspace" element={<WorkspaceTable />} />
           </Route>
        </Route>
      </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
