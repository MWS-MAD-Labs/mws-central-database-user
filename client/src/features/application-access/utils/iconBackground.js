// Colours offered behind the icon or logo on the Hub card. Empty means the Hub default.
export const ICON_BG_PRESETS = [
  { value: "#FFFFFF", label: "White" },
  { value: "#E9EDF6", label: "Navy tint" },
  { value: "#EFF8FE", label: "Sky tint" },
  { value: "#EDF3EB", label: "Green tint" },
  { value: "#FBF2DF", label: "Amber tint" },
  { value: "#F5E7E8", label: "Red tint" },
  { value: "#1F2A44", label: "Navy" },
  { value: "#7E1518", label: "Burgundy" },
];

export const isHexColor = (value) => /^#[0-9a-fA-F]{6}$/.test(value ?? "");

// Dark text on a light colour, light text on a dark one.
export function readableOn(hex) {
  if (!isHexColor(hex)) return undefined;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1F2A44" : "#FFFFFF";
}
