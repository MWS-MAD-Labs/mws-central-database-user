import {
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Database,
  FileSpreadsheet,
  FileClock,
  GraduationCap,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Button } from '../ui/Button.jsx'
import { useAuth } from '../../features/auth/hooks/useAuth.js'
import { cn } from '../../lib/cn.js'
import {
  getUserDisplayName,
  getUserEmail,
  getUserInitials,
} from '../../lib/session.js'

const adminNavItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/employees', label: 'Employees', icon: UsersRound },
  { to: '/students', label: 'Students', icon: GraduationCap },
  { to: '/import-export', label: 'Import / Export', icon: FileSpreadsheet },
  {
    label: 'Academic',
    icon: CalendarDays,
    children: [
      { to: '/academic?tab=years', label: 'Academic Years', icon: CalendarDays },
      { to: '/academic?tab=grades', label: 'Grades', icon: Layers3 },
      { to: '/academic?tab=classes', label: 'Classes', icon: BookOpen },
      { to: '/academic?tab=enrollments', label: 'Enrollments', icon: UsersRound },
    ],
  },
]

const employeeNavItems = [
  { to: '/profile', label: 'My Profile', icon: UserRound },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, isLoggingOut } = useAuth()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [openNavGroups, setOpenNavGroups] = useState({
    Academic: true,
    'Master Data': true,
  })

  const navItems = useMemo(() => {
    if (user?.type === 'employee') {
      return employeeNavItems
    }

    const items = [...adminNavItems]
    if (user?.role === 'SUPER_ADMIN') {
      items.push(
        {
          label: 'Master Data',
          icon: Database,
          children: [
            { to: '/master-data?tab=units', label: 'Units', icon: Building2 },
            {
              to: '/master-data?tab=job-positions',
              label: 'Job Positions',
              icon: BriefcaseBusiness,
            },
            { to: '/master-data?tab=job-levels', label: 'Job Levels', icon: Layers3 },
            { to: '/master-data?tab=buildings', label: 'Buildings', icon: MapPinned },
          ],
        },
        { to: '/audit-logs', label: 'Audit Logs', icon: FileClock },
        { to: '/api-clients', label: 'API Clients', icon: KeyRound },
      )
    }
    items.push({ to: '/profile', label: 'Profile', icon: UserRound })
    return items
  }, [user])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-[#fffafa] text-[var(--mws-charcoal)]">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--mws-line)] bg-white/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setIsSidebarOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--mws-line)] bg-white text-[var(--mws-charcoal)]"
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Database size={18} />
          MWS Data Center
        </div>
      </header>

      <div
        className={cn(
          'fixed inset-0 z-40 bg-[#24171866] transition-opacity md:hidden',
          isSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-[var(--mws-line)] bg-white transition-transform md:translate-x-0',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-[var(--mws-line)] px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--mws-burgundy)] text-white">
            <Database size={20} />
          </div>
          <div>
            <p className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
              MWS Data Center
            </p>
            <p className="text-xs text-[var(--mws-muted)]">Central User Database</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon
            if (item.children) {
              const isGroupActive = item.children.some((child) =>
                isSidebarLinkActive(location, child.to),
              )
              const isOpen = openNavGroups[item.label] ?? isGroupActive

              return (
                <div key={item.label} className="space-y-1">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenNavGroups((current) => ({
                        ...current,
                        [item.label]: !isOpen,
                      }))
                    }
                    className={cn(
                      'flex h-10 w-full items-center gap-3 rounded-full px-3 font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]',
                      isGroupActive && 'bg-[var(--mws-soft)] text-[var(--mws-burgundy)]',
                    )}
                  >
                    <Icon size={18} />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown
                      size={16}
                      className={cn(
                        'transition-transform',
                        isOpen ? 'rotate-180' : 'rotate-0',
                      )}
                    />
                  </button>
                  {isOpen ? (
                    <div className="space-y-1 pl-6">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon
                        const isActive = isSidebarLinkActive(location, child.to)
                        return (
                          <Link
                            key={child.to}
                            to={child.to}
                            onClick={() => setIsSidebarOpen(false)}
                            className={cn(
                              'flex h-9 items-center gap-2 rounded-full px-3 font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]',
                              isActive && 'bg-[var(--mws-burgundy)] text-white',
                            )}
                          >
                            <ChildIcon size={15} />
                            {child.label}
                          </Link>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 items-center gap-3 rounded-full px-3 font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]',
                    isActive && 'bg-[var(--mws-burgundy)] text-white',
                  )
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="border-t border-[var(--mws-line)] p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] font-display text-sm font-bold text-[#8a6419]">
              {getUserInitials(user)}
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold text-[var(--mws-charcoal)]">
                {getUserDisplayName(user)}
              </p>
              <p className="truncate text-xs text-[var(--mws-muted)]">
                {getUserEmail(user)}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start"
            disabled={isLoggingOut}
            onClick={handleLogout}
          >
            <LogOut size={16} />
            Logout
          </Button>
        </div>
      </aside>

      <main className="min-h-svh md:pl-72">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 hidden items-center justify-between md:flex">
            <div className="flex items-center gap-3">
              <Building2 size={22} className="text-[var(--mws-burgundy)]" />
              <span className="text-sm font-semibold text-[var(--mws-muted)]">
                MWS internal admin
              </span>
            </div>
            <div className="rounded-full border border-[var(--mws-line)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--mws-muted)]">
              {user?.type === 'admin' ? user.role : 'EMPLOYEE'}
            </div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function isSidebarLinkActive(location, to) {
  const [pathname, query = ''] = to.split('?')
  if (location.pathname !== pathname) return false

  const tab = new URLSearchParams(query).get('tab')
  if (!tab) return true

  const defaultTabs = {
    '/academic': 'years',
    '/master-data': 'units',
  }
  const activeTab =
    new URLSearchParams(location.search).get('tab') || defaultTabs[pathname]
  return activeTab === tab
}
