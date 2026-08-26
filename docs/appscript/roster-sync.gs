// Google Apps Script - pulls the flat student roster from mws-data-center
// into this spreadsheet on a schedule, for the report-card generation flow.
//
// Setup:
// 1. Open the target Google Sheet -> Extensions > Apps Script.
// 2. Paste this whole file in as Code.gs (or a new script file).
// 3. Project Settings (gear icon) > Script Properties > add:
//      API_BASE_URL = https://db-stg.mws.web.id  (or the prod domain)
//      API_TOKEN    = the token shown once when the API Client was created
//                      in mws-data-center (Access > API Clients), for a
//                      client granted the students:roster_export:read scope
// 4. Run syncRosterFromCentral once manually from the editor to grant the
//    UrlFetchApp permission prompt and confirm it writes rows correctly.
// 5. Run setupDailyTrigger ONCE to install the schedule. Don't call it from
//    syncRosterFromCentral - it stacks a duplicate trigger every sync. To
//    change the schedule later, delete the old trigger first (Triggers -
//    the clock icon in the left sidebar), then run setupDailyTrigger again.
//
// Endpoint reference: GET /api/internal/students/roster-export
// (defaults to ACTIVE students only - pass ?status=GRADUATED etc. for
// other statuses, e.g. by adding a second sheet/function with that query
// param if graduated students need their own tab).

const SHEET_NAME = "Roster Sync"; // change to match your tab name

const COLUMNS = [
  "nis", "legacy_nis", "nisn", "photo_url", "full_name", "nick_name",
  "gender", "status", "email", "current_grade", "current_class",
  "join_academic_year", "join_grade", "leave_year", "graduation_grade",
  "sn", "previous_school", "religion", "birth_place", "birth_date",
  "father_name", "mother_name", "father_phone", "father_email",
  "mother_phone", "mother_email", "address", "health_information",
  "blood_type", "special_needs", "media_consent_signed",
  "parent_consent_signed", "pc_monday", "pc_tuesday", "pc_wednesday",
  "pc_thursday",
];

function syncRosterFromCentral() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty("API_BASE_URL");
  const token = props.getProperty("API_TOKEN");

  if (!baseUrl || !token) {
    throw new Error("Set API_BASE_URL and API_TOKEN in Script Properties first.");
  }

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

  const sheet =
    SpreadsheetApp.getActive().getSheetByName(SHEET_NAME) ||
    SpreadsheetApp.getActive().insertSheet(SHEET_NAME);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);

  if (rows.length > 0) {
    const values = rows.map((row) => COLUMNS.map((key) => row[key] ?? ""));
    sheet.getRange(2, 1, values.length, COLUMNS.length).setValues(values);
  }

  Logger.log(`Synced ${rows.length} students at ${new Date().toISOString()}`);
}

function setupDailyTrigger() {
  ScriptApp.newTrigger("syncRosterFromCentral")
    .timeBased()
    .everyHours(6) // adjust: everyHours(1), atHour(0) for midnight, etc.
    .create();
}
