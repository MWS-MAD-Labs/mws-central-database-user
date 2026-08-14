import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { AcademicYearsPanel } from "../components/AcademicYearsPanel.jsx";
import { ClassesPanel } from "../components/ClassesPanel.jsx";
import { GradesPanel } from "../components/GradesPanel.jsx";
import { WorkspaceTable } from "../../tableTecher/pages/WorkspaceTable.jsx";

// "enrollments" intentionally left out - promote/move/close now live on
// each class's own detail page, so this flat cross-class list is hidden
// from nav and unreachable via ?tab= too. EnrollmentsPanel itself is kept
// around (not deleted) in case it's needed again later.
const tabs = ["years", "grades", "classes", "workspace"];

export function AcademicPage() {
  const [searchParams] = useSearchParams();
  const activeTab = tabs.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
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
      {activeTab === "workspace" ? <WorkspaceTable /> : null}
    </div>
  );
}
