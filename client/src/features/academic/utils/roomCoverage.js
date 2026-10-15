const part = (items, one, many, skipWhenEmpty = true) => {
  if (items.length === 0) return skipWhenEmpty ? null : one;
  if (items.length === 1) return items[0].name;
  return `${items.length} ${many}`;
};

// One line for a room: only what narrows it, so a room open to everything reads "All Units".
export function coverageSummary(room) {
  const units = part(room.units, "All Units", "Units", false);
  const grades = part(room.grades, "", "Grades");
  const classes = part(room.classes, "", "Classes");
  const narrowed = room.units.length > 0 || room.grades.length > 0 || room.classes.length > 0;
  if (!narrowed) return "All Units";
  return [room.units.length > 0 ? units : null, grades, classes].filter(Boolean).join(" · ");
}

// The full lists behind the summary, an empty one says what it means.
export function coverageGroups(room) {
  return [
    { title: "Units", items: room.units.length ? room.units.map((item) => item.name) : ["All units"], hideCount: !room.units.length },
    { title: "Grades", items: room.grades.length ? room.grades.map((item) => item.name) : ["Any grade"], hideCount: !room.grades.length },
    { title: "Classes", items: room.classes.length ? room.classes.map((item) => item.name) : ["Any class"], hideCount: !room.classes.length },
  ];
}
