import { Link } from "react-router";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";
import {
  classTeacherCount,
  classTeacherGroups,
  classTeacherSummary,
  onlyTeacher,
  teacherName,
} from "../utils/classTeachers.js";

// The teachers of a class in one line. One teacher shows their name as a link to the profile,
// several show the roles with their counts and open the names on a click.
export function ClassTeachers({ klass, empty = "-" }) {
  const count = classTeacherCount(klass);
  if (count === 0) return <span className="text-sm text-(--mws-muted)">{empty}</span>;

  const only = onlyTeacher(klass);
  if (only) {
    const member = only.workforce_member || only.employee;
    return (
      <Link
        to={member?.type === "INTERN" ? `/interns/${member.id}` : `/employees/${member?.id}`}
        className="text-sm font-semibold text-(--mws-charcoal) hover:text-(--mws-burgundy) hover:underline"
      >
        {teacherName(only)}
      </Link>
    );
  }

  return (
    <ListPopover
      label={classTeacherSummary(klass)}
      count={count}
      dialogLabel={`Teachers of ${klass.name}`}
      icon={false}
      mono={false}
      groups={classTeacherGroups(klass)}
      className="[&>button]:text-sm [&>button]:font-semibold [&>button]:text-(--mws-charcoal)"
    />
  );
}
