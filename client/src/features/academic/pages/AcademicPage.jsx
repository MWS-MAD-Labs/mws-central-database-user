import { useSearchParams } from "react-router";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { AcademicYearsPanel } from "../components/AcademicYearsPanel.jsx";
import { ClassesPanel } from "../components/ClassesPanel.jsx";
import { EnrollmentsPanel } from "../components/EnrollmentsPanel.jsx";
import { GradesPanel } from "../components/GradesPanel.jsx";

const tabs = ["years", "grades", "classes", "enrollments"];

export function AcademicPage() {
  const [searchParams] = useSearchParams();
  const activeTab = tabs.includes(searchParams.get("tab"))
    ? searchParams.get("tab")
    : "years";

  return (
    <div className="min-w-0">
      <PageHeader
        title="Academic"
        description="Manage school years, grade levels, classes, homerooms, and student class history."
      />

      {activeTab === "years" ? <AcademicYearsPanel /> : null}
      {activeTab === "grades" ? <GradesPanel /> : null}
      {activeTab === "classes" ? <ClassesPanel /> : null}
      {activeTab === "enrollments" ? <EnrollmentsPanel /> : null}
    </div>
  );
}
