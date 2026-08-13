function formatGender(value) {
  return value === "MALE" ? "Male" : "Female";
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function toChartRows(values, formatLabel = (label) => label) {
  return Object.entries(values || {})
    .map(([label, value]) => ({
      label: formatLabel(label),
      value,
    }))
    .filter((row) => row.value > 0);
}

function formatBirthday(dateString) {
  if (!dateString) return "";

  const parts = dateString.split("-");
  let month = 0;
  let day = 0;

  if (parts.length === 2){
    month = parseInt(parts[0], 10) - 1;
    day = parseInt(parts [1], 10);
  }else if (parts.length === 3) {
    month = parseInt(parts[1], 10) - 1;
    day = parseInt(parts[2], 10);
  }else{
    return dateString;
    console.log(dateString)
  }
  const date = new Date(2000, month, day); // Year bebas hanya untuk formatting
  return date.toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

export {
    formatGender,
    formatNumber,
    greetingFor,
    formatTime,
    formatDay,
    toChartRows,
    formatBirthday

};