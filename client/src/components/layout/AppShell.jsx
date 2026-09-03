import {
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Database,
  FileClock,
  GraduationCap,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  PanelLeftClose,
  Puzzle,
  ShieldCheck,
  UserRound,
  UserRoundPlus,
  UserCog,
  UsersRound,
  Sheet,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "../ui/Button.jsx";
import { BulkPhotoUploadStatusBar } from "./BulkPhotoUploadStatusBar.jsx";
import { useAuth } from "../../features/auth/hooks/useAuth.js";
import { cn } from "../../lib/cn.js";
import {
  getUserDisplayName,
  getUserEmail,
  getUserInitials,
} from "../../lib/session.js";
import { formatStatus } from "../../lib/format.js";

const adminNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employees", label: "Employees", icon: UsersRound },
  { to: "/interns", label: "Interns", icon: UserRoundPlus },
  { to: "/students", label: "Students", icon: GraduationCap },
  {
    label: "Academic",
    icon: CalendarDays,
    children: [
      {
        to: "/academic?tab=years",
        label: "Academic Years",
        icon: CalendarDays,
      },
      { to: "/academic?tab=grades", label: "Grades", icon: Layers3 },
      { to: "/academic?tab=classes", label: "Classes", icon: BookOpen },
      {
        to: "/academic?tab=pc-activities",
        label: "PC Activity Mentors",
        icon: Puzzle,
      },
      { to: "/academic?tab=workspace", label: "Workspace", icon: Sheet },
      // Enrollments tab hidden - promote/move/close now live on each
      // class's own detail page. Nav entry intentionally left out rather
      // than deleted; see AcademicPage.jsx's `tabs` list.
    ],
  },
];

const employeeNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/profile", label: "My Profile", icon: UserRound },
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openNavGroups, setOpenNavGroups] = useState({
    Academic: true,
    Access: true,
    "Master Data": true,
  });

  const navItems = useMemo(() => {
    if (user?.type === "employee") {
      return employeeNavItems;
    }

    const items = [...adminNavItems];
    if (user?.role === "SUPER_ADMIN") {
      items.push(
        {
          label: "Master Data",
          icon: Database,
          children: [
            { to: "/master-data?tab=units", label: "Units", icon: Building2 },
            {
              to: "/master-data?tab=job-positions",
              label: "Job Positions",
              icon: BriefcaseBusiness,
            },
            {
              to: "/master-data?tab=job-levels",
              label: "Job Levels",
              icon: Layers3,
            },
            {
              to: "/master-data?tab=buildings",
              label: "Buildings",
              icon: MapPinned,
            },
            {
              to: "/master-data?tab=pc-activities",
              label: "PC Activities",
              icon: Puzzle,
            },
            {
              to: "/master-data?tab=education",
              label: "Education",
              icon: GraduationCap,
            },
          ],
        },
        {
          label: "Access",
          icon: ShieldCheck,
          children: [
            { to: "/access?tab=admins", label: "Admin Users", icon: UserCog },
            {
              to: "/access?tab=working-days",
              label: "Working Saturdays",
              icon: CalendarDays,
            },
            { to: "/audit-logs", label: "Audit Logs", icon: FileClock },
            { to: "/api-clients", label: "API Clients", icon: KeyRound },
          ],
        },
      );
    }
    items.push({ to: "/profile", label: "Profile", icon: UserRound });
    return items;
  }, [user]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-svh overflow-x-hidden bg-[#fffafa] text-[var(--mws-charcoal)]">
      {/* header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--mws-line)] bg-white/95 px-4 backdrop-blur md:hidden">
        <button
          type="button"
          aria-label="Open Navigation"
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
          "fixed inset-0 z-40 bg-[#24171866] transition-opacity md:hidden",
          isSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setIsSidebarOpen(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col overflow-hidden border-r border-[var(--mws-line)] bg-white transition-[width,transform] duration-300 ease-in-out md:translate-x-0",
          sidebarOpen ? "md:w-72" : "md:w-20",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-[var(--mws-line)] transition-all duration-300",
            sidebarOpen ? "gap-3 px-5" : "justify-center px-3",
          )}
        >
          <div
            onClick={() => {
              if (!sidebarOpen) {
                setSidebarOpen(true);
              }
            }}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full bg-[var(--mws-burgundy)] text-white",
              !sidebarOpen && "cursor-pointer",
            )}
          >
            <Database size={20} />
          </div>
          <div
            className={cn(
              "min-w-0 transition-opacity duration-200",
              !sidebarOpen && "md:hidden",
            )}
          >
            <p className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
              MWS Data Center
            </p>
            <p className="text-xs text-[var(--mws-muted)]">
              Central User Database
            </p>
          </div>
          {sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="absolute top-7 right-3 z-50 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full  transition hover:border-[var(--mws-burgundy)] hover:text-[var(--mws-burgundy)]"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            if (item.children) {
              const isGroupActive = item.children.some((child) =>
                isSidebarLinkActive(location, child.to),
              );
              const isOpen = openNavGroups[item.label] ?? isGroupActive;

              return (
                <div key={item.label} className="space-y-1">
                  <button
                    type="button"
                    title={!sidebarOpen ? item.label : undefined}
                    onClick={() => {
                      if (!sidebarOpen) {
                        setSidebarOpen(true);
                        setOpenNavGroups((current) => ({
                          ...current,
                          [item.label]: true,
                        }));
                        return;
                      }
                      setOpenNavGroups((current) => ({
                        ...current,
                        [item.label]: !isOpen,
                      }));
                    }}
                    className={cn(
                      "flex h-10 w-full items-center rounded-full font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]",
                      sidebarOpen ? "gap-3 px-3" : "justify-center px-0",
                      isGroupActive &&
                        "bg-[var(--mws-soft)] text-[var(--mws-burgundy)]",
                    )}
                  >
                    <Icon size={18} />
                    <span
                      className={cn(
                        "flex-1 text-left",
                        !sidebarOpen && "md:hidden",
                      )}
                    >
                      {item.label}
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn(
                        "transition-transform",
                        !sidebarOpen && "md:hidden",
                        isOpen ? "rotate-180" : "rotate-0",
                      )}
                    />
                  </button>
                  {isOpen && sidebarOpen ? (
                    <div className="space-y-1 pl-6">
                      {item.children.map((child) => {
                        const ChildIcon = child.icon;
                        const isActive = isSidebarLinkActive(
                          location,
                          child.to,
                        );
                        return (
                          <Link
                            key={child.to}
                            to={child.to}
                            onClick={() => setIsSidebarOpen(false)}
                            title={!sidebarOpen ? child.label : undefined}
                            className={cn(
                              "flex h-9 items-center gap-2 rounded-full px-3 font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]",
                              isActive && "bg-[var(--mws-burgundy)] text-white",
                            )}
                          >
                            <ChildIcon size={15} />
                            {child.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsSidebarOpen(false)}
                title={!sidebarOpen ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    "flex h-10 items-center rounded-full font-display text-sm font-semibold text-[var(--mws-muted)] transition-colors hover:bg-[var(--mws-soft)] hover:text-[var(--mws-charcoal)]",
                    sidebarOpen ? "gap-3 px-3" : "justify-center px-0",
                    isActive && "bg-[var(--mws-burgundy)] text-white",
                  )
                }
              >
                <Icon size={18} />
                <span className={cn(!sidebarOpen && "md:hidden")}>
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-[var(--mws-line)] p-4">
          <div
            className={cn(
              "mb-3 flex items-center transition-all duration-300",
              sidebarOpen ? "gap-3" : "justify-center gap-0",
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4d8] font-display text-sm font-bold text-[#8a6419]">
              {getUserInitials(user)}
            </div>
            <div
              className={cn(
                "min-w-0 transition-opacity duration-200",
                !sidebarOpen && "md:hidden",
              )}
            >
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
            size={sidebarOpen ? "md" : "icon"}
            className={cn(
              "w-full",
              sidebarOpen ? "justify-start" : "justify-center px-0",
            )}
            disabled={isLoggingOut}
            onClick={handleLogout}
            title={!sidebarOpen ? "Logout" : undefined}
          >
            <LogOut size={16} />
            <span className={cn(!sidebarOpen && "md:hidden")}>Logout</span>
          </Button>
        </div>
      </aside>

      <main
        className={cn(
          "min-h-svh min-w-0 transition-[padding] duration-300 ease-in-out",
          sidebarOpen ? "md:pl-72" : "md:pl-20",
        )}
      >
        <div className="w-full min-w-0 px-4 py-5 sm:px-5 lg:px-6 xl:px-8 2xl:px-10">
          <div className="mb-6 hidden min-w-0 items-center justify-between gap-4 md:flex">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src="https://millenniaws.sch.id/wp-content/uploads/2021/11/Millennia-World-School-Logo-Only.svg"
                alt="MWS Logo"
                className="h-6 w-6"
              />
              <span className="truncate text-sm font-semibold text-[var(--mws-muted)]">
                MWS Internal Admin
              </span>
            </div>
            <div className="shrink-0 rounded-full border border-[var(--mws-line)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--mws-muted)]">
              {user?.type === "admin" ? formatStatus(user.role) : "Employee"}
            </div>
          </div>
          <Outlet />
        </div>
      </main>

      <BulkPhotoUploadStatusBar />
    </div>
  );
}

function isSidebarLinkActive(location, to) {
  const [pathname, query = ""] = to.split("?");
  // Prefix match, not just exact - a nested detail route like
  // /academic/classes/:classId should still keep "Classes" highlighted,
  // same as how NavLink's own default matching works for top-level items.
  if (
    location.pathname !== pathname &&
    !location.pathname.startsWith(`${pathname}/`)
  ) {
    return false;
  }

  const tab = new URLSearchParams(query).get("tab");
  if (!tab) return true;

  const defaultTabs = {
    "/academic": "years",
    "/master-data": "units",
  };
  // Nested detail routes (e.g. /academic/classes/:classId) don't carry a
  // ?tab= query of their own - infer which tab they belong to from the path
  // itself instead of silently falling back to the page's default tab.
  const nestedTabOverrides = [{ prefix: "/academic/classes/", tab: "classes" }];
  const nestedTab = nestedTabOverrides.find((entry) =>
    location.pathname.startsWith(entry.prefix),
  )?.tab;
  const activeTab =
    new URLSearchParams(location.search).get("tab") ||
    nestedTab ||
    defaultTabs[pathname];
  return activeTab === tab;
}
