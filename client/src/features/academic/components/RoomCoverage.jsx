import { NameList } from "../../../components/ui/NameList.jsx";

const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-(--mws-muted)";

// Units, grades and classes a room covers: nothing picked reads as everything, one shows its
// name and several a count that opens the list.
export function RoomCoverage({ room }) {
  const name = room.display_name || room.name;
  const parts = [
    { label: "Units", items: room.units, noun: "units", plain: "All" },
    { label: "Grades", items: room.grades, noun: "grades", plain: "Any" },
    { label: "Classes", items: room.classes, noun: "classes", plain: "Any" },
  ];
  return (
    <dl aria-label={`Coverage of ${name}`} className="flex flex-wrap gap-x-5 gap-y-1">
      {parts.map((part) => (
        <div key={part.label} className="min-w-0 max-w-44">
          <dt className={labelClass}>{part.label}</dt>
          <dd>
            <NameList
              names={part.items.map((item) => item.name)}
              noun={part.noun}
              title={`${part.label} of ${name}`}
              plain={part.plain}
            />
          </dd>
        </div>
      ))}
    </dl>
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
