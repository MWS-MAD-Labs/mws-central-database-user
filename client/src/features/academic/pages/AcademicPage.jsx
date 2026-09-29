import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { AcademicYearsPanel } from "../components/AcademicYearsPanel.jsx";
import { ClassesPanel } from "../components/ClassesPanel.jsx";
import { GradesPanel } from "../components/GradesPanel.jsx";
import { PcActivityRoomsPanel } from "../components/PcActivityRoomsPanel.jsx";
import { WorkspaceTable } from "../../tableTecher/pages/WorkspaceTable.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { canViewStudents } from "../../../lib/capabilities.js";

const tabs = [
  "years",
  "grades",
  "classes",
  "pc-activity-rooms",
  "workspace",
];

export function AcademicPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const requestedTab = searchParams.get("tab");
  const activeTab =
    tabs.includes(requestedTab) &&
    (requestedTab !== "workspace" || canViewStudents(user))
      ? requestedTab
      : "years";

  const isWorkspace = activeTab === "workspace";

  return (
    <div className="min-w-0">
      {isWorkspace ? (
        <PageHeader
          title="Academic Workspace"
          description="Work with academic data in a spreadsheet-style workspace."
        />
      ) : (
        <PageHeader
          title="Academic"
          description="Manage school years, grade levels, classes, and homerooms."
        />
      )}

      {activeTab === "years" ? <AcademicYearsPanel /> : null}
      {activeTab === "grades" ? <GradesPanel /> : null}
      {activeTab === "classes" ? <ClassesPanel /> : null}
      {activeTab === "pc-activity-rooms" ? <PcActivityRoomsPanel /> : null}
      {activeTab === "workspace" ? <WorkspaceTable /> : null}
    </div>
  );
}
