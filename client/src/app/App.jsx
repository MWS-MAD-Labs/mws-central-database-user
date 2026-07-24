import { Navigate, Route, Routes } from 'react-router'
import { AppShell } from '../components/layout/AppShell.jsx'
import { AcademicPage } from '../features/academic/pages/AcademicPage.jsx'
import { ApiClientsPage } from '../features/api-clients/pages/ApiClientsPage.jsx'
import { LoginPage } from '../features/auth/pages/LoginPage.jsx'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage.jsx'
import { EmployeeCreatePage } from '../features/employees/pages/EmployeeCreatePage.jsx'
import { EmployeeDetailPage } from '../features/employees/pages/EmployeeDetailPage.jsx'
import { EmployeeEditPage } from '../features/employees/pages/EmployeeEditPage.jsx'
import { EmployeesPage } from '../features/employees/pages/EmployeesPage.jsx'
import { ProfilePage } from '../features/profile/pages/ProfilePage.jsx'
import { StudentCreatePage } from '../features/students/pages/StudentCreatePage.jsx'
import { StudentDetailPage } from '../features/students/pages/StudentDetailPage.jsx'
import { StudentEditPage } from '../features/students/pages/StudentEditPage.jsx'
import { StudentsPage } from '../features/students/pages/StudentsPage.jsx'
import { ProtectedRoute } from '../routes/ProtectedRoute.jsx'
import { RoleHome } from '../routes/RoleHome.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleHome />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/new" element={<EmployeeCreatePage />} />
          <Route path="employees/:employeeId/edit" element={<EmployeeEditPage />} />
          <Route path="employees/:employeeId" element={<EmployeeDetailPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/new" element={<StudentCreatePage />} />
          <Route path="students/:studentId/edit" element={<StudentEditPage />} />
          <Route path="students/:studentId" element={<StudentDetailPage />} />
          <Route path="academic" element={<AcademicPage />} />
          <Route path="api-clients" element={<ApiClientsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
