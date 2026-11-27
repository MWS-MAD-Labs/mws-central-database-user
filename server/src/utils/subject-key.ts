// What two writings of a subject have in common: "Art", " art " and "ART" are one subject. Made when a subject is created and never changed.
export function subjectKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
}

// A name as it is written: spaces tidied.
export const subjectName = (text: string): string => text.trim().replace(/\s+/g, " ");
