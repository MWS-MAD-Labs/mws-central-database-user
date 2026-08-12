function getClassName(classes, classId) {
  if (!classId) return "-";
  return classes.find((klass) => klass.id === classId)?.name || classId;
}

function getYearName(years, yearId) {
  if (!yearId) return "-";
  return years.find((year) => year.id === yearId)?.name || yearId;
}

export {
    getClassName,
    getYearName,
}