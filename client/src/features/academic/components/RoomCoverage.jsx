import { ListPopover } from "../../../components/ui/ListPopover.jsx";
import { NameList } from "../../../components/ui/NameList.jsx";
import { coverageGroups, coverageSummary } from "../utils/roomCoverage.js";

// Where a room reaches, in one line. A click opens the full units, grades and classes.
export function RoomCoverage({ room }) {
  const name = room.display_name || room.name;
  const count = room.units.length + room.grades.length + room.classes.length;
  return (
    <ListPopover
      label={coverageSummary(room)}
      count={count}
      dialogLabel={`Coverage of ${name}`}
      icon={false}
      mono={false}
      groups={coverageGroups(room)}
      className="[&>button]:text-sm [&>button]:font-semibold [&>button]:text-(--mws-charcoal)"
    />
  );
}

// Mentors of a room, same count chip.
export function RoomMentors({ room }) {
  return (
    <NameList
      names={room.mentors.map((mentor) => mentor.name)}
      noun="mentors"
      title={`Mentors of ${room.display_name || room.name}`}
      plain="No mentor"
    />
  );
}
