// Google Apps Script - pulls the flat student roster from mws-data-center
// and writes it into the school's existing report-card Google Sheet, in
// that sheet's original column layout (same header text/order it already
// has - see https://docs.google.com/spreadsheets/d/1YSF4MuxOmo7BVzUK-Ya51Oc240vIQ4L3xMMsgVFsv0U).
//
// Deliberately does NOT touch row 1 or any existing formatting (colors,
// fonts, column widths, frozen rows) - the target sheet already looks the
// way it should. Only the data rows (row 2 onward) get replaced each sync.
//
// Setup:
// 1. Open the target Google Sheet -> Extensions > Apps Script.
// 2. Paste this whole file in as Code.gs (or a new script file).
// 3. Project Settings (gear icon) > Script Properties > add:
//      API_BASE_URL = https://db-stg.mws.web.id  (or the prod domain)
//      API_TOKEN    = the token shown once when the API Client was created
//                      in mws-data-center (Access > API Clients), for a
//                      client granted the students:roster_export:read scope
//      SHEET_GID    = the numeric gid of the target tab (the "gid=..." in
//                      the sheet's URL) - only needed if this script runs
//                      bound to a spreadsheet with more than one tab, or
//                      the tab isn't the active one when triggers fire.
//                      Leave unset to just use the active sheet.
// 4. Run syncRosterFromCentral once manually from the editor to grant the
//    UrlFetchApp permission prompt and confirm it writes rows correctly.
// 5. Run setupDailyTrigger ONCE to install the schedule. Don't call it from
//    syncRosterFromCentral - it stacks a duplicate trigger every sync. To
//    change the schedule later, delete the old trigger first (Triggers -
//    the clock icon in the left sidebar), then run setupDailyTrigger again.
//
// Endpoint reference: GET /api/internal/students/roster-export
// (returns every status by default - active, graduated, etc. all in one
// pull. Pass ?status=ACTIVE, ?status=GRADUATED, etc. to narrow it down if
// a particular sheet/tab only needs one status).

// The sheet's own header, left exactly as-is - this is what row 1 already
// says, not something this script invents or restyles.
const HEADER = [
  "NIS", "Photo ID", "Full Name", "Nick Name", "Gender", "Current status",
  "Student MWS Email", "Current grade (If Active)", "Class Name",
  "Join Academic year", "Leave year (If Graduated)", "SN", "Join Grade",
  "Graduation Grade", "Previous School", "NISN", "Religion",
  "Place, Date of birth", "Father", "Mother", "Father's Phone", "Emails",
  "Mother's Phone", "Address", "Health Information", "Blood Type",
  "Special Needs, Psychological / Physical", "Media Consent Form SIGNED",
  "Media Consent YES", "parent consent sign", "PC Monday", "PC Tuesday",
  "PC Wednesday", "PC Thursday",
];

function syncRosterFromCentral() {
  const props = PropertiesService.getScriptProperties();
  const rawBaseUrl = props.getProperty("API_BASE_URL");
  const token = props.getProperty("API_TOKEN");
  const sheetGid = props.getProperty("SHEET_GID");

  if (!rawBaseUrl || !token) {
    throw new Error("Set API_BASE_URL and API_TOKEN in Script Properties first.");
  }

  const baseUrl = rawBaseUrl.replace(/\/+$/, "");

  const response = UrlFetchApp.fetch(`${baseUrl}/api/internal/students/roster-export`, {
    method: "get",
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error(`Roster export failed (${status}): ${response.getContentText()}`);
  }

  const body = JSON.parse(response.getContentText());
  const rows = body.data;

  const sheet = resolveTargetSheet(sheetGid);

  // Overwrite the data area only - row 1 (the header, and whatever
  // formatting lives there) is never touched.
  const existingRows = sheet.getLastRow() - 1;
  if (existingRows > 0) {
    sheet.getRange(2, 1, existingRows, HEADER.length).clearContent();
  }

  if (rows.length > 0) {
    const values = rows.map(toLegacyRow);
    sheet.getRange(2, 1, values.length, HEADER.length).setValues(values);
  }

  Logger.log(`Synced ${rows.length} students at ${new Date().toISOString()}`);
}

function resolveTargetSheet(sheetGid) {
  const active = SpreadsheetApp.getActive();
  if (!sheetGid) return active.getActiveSheet();

  const targetGid = Number(sheetGid);
  const match = active
    .getSheets()
    .find((sheet) => sheet.getSheetId() === targetGid);
  if (!match) {
    throw new Error(`No sheet with gid ${sheetGid} found in this spreadsheet.`);
  }
  return match;
}

// Maps one roster-export JSON row onto the sheet's original 34 columns -
// this is where the "one flat cell per legacy column" reshaping happens
// (splitting current_grade/current_class, recombining birth_place +
// birth_date, joining father/mother email back into one Emails cell,
// mirroring the single media_consent_signed boolean into both of the old
// sheet's two consent columns), not in the API response itself.
function toLegacyRow(row) {
  return [
    row.nis || row.legacy_nis || "",
    row.photo_url || "",
    row.full_name,
    row.nick_name,
    titleCase(row.gender),
    titleCase(row.status),
    row.email,
    row.current_grade || "",
    row.current_class || "",
    row.join_academic_year,
    row.leave_year || "",
    row.sn || "",
    row.join_grade,
    row.graduation_grade || "",
    row.previous_school || "",
    row.nisn || "",
    titleCase(row.religion),
    formatBirthPlaceDate(row.birth_place, row.birth_date),
    row.father_name || "",
    row.mother_name || "",
    row.father_phone || "",
    joinEmails(row.father_email, row.mother_email),
    row.mother_phone || "",
    row.address || "",
    row.health_information || "",
    row.blood_type || "",
    row.special_needs || "",
    row.media_consent_signed,
    row.media_consent_signed,
    row.parent_consent_signed,
    row.pc_monday || "",
    row.pc_tuesday || "",
    row.pc_wednesday || "",
    row.pc_thursday || "",
  ];
}

function titleCase(value) {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function joinEmails(fatherEmail, motherEmail) {
  return [fatherEmail, motherEmail].filter(Boolean).join("; ");
}

function formatBirthPlaceDate(place, isoDate) {
  if (!place && !isoDate) return "";
  const formattedDate = isoDate
    ? Utilities.formatDate(new Date(isoDate), "GMT", "dd MMM yyyy")
    : "";
  return [place, formattedDate].filter(Boolean).join(", ");
}

function setupDailyTrigger() {
  ScriptApp.newTrigger("syncRosterFromCentral")
    .timeBased()
    .everyHours(6) // adjust: everyHours(1), atHour(0) for midnight, etc.
    .create();
}
