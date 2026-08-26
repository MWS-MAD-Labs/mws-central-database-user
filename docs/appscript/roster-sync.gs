// Google Apps Script - pulls the flat student roster from mws-data-center
// and merges it into the school's existing report-card Google Sheet, in
// that sheet's original column layout (same header text/order it already
// has - see https://docs.google.com/spreadsheets/d/1YSF4MuxOmo7BVzUK-Ya51Oc240vIQ4L3xMMsgVFsv0U).
//
// This is a MERGE, not a wipe-and-rewrite:
// - A central row is matched to an existing sheet row by NIS first, then by
//   email if NIS is blank (not every central student has an NIS yet) or
//   didn't match. Matched rows are updated in place - their row position in
//   the sheet doesn't change.
// - A central row with no match becomes a new row appended at the bottom.
// - A sheet row with NO matching central record (e.g. typed in by hand,
//   not in central yet) is left completely untouched - nothing gets
//   cleared just because central doesn't know about it.
// - Column B (Photo ID) is never changed for any row, matched or not -
//   that sheet already has its own updateProfilePhotoLinks_Optimized()
//   script matching a Drive folder of photos to student names and writing
//   a HYPERLINK formula there. A brand new appended row starts with a
//   blank Photo ID; that script fills it in on its own next run.
// - Row 1 (the header) and all existing formatting (colors, fonts, column
//   widths, frozen rows) are never touched.
//
// Everything below lives inside the MwsRosterSync namespace object except
// the two entry points Apps Script needs as plain global functions
// (syncRosterFromCentral, setupMwsRosterSyncTrigger) - this project already
// has other scripts in it (photo links, Workspace user creation), and Apps
// Script shares one global scope across every .gs file, so a bare
// top-level name can collide with something already declared elsewhere
// (this is exactly what happened with a plain top-level HEADER before).
//
// Setup:
// 1. Open the target Google Sheet -> Extensions > Apps Script.
// 2. Add this as a NEW script file (e.g. SyncCentral.gs) - don't overwrite
//    the existing Code.gs, the two coexist fine.
// 3. Project Settings (gear icon) > Script Properties > add:
//      API_BASE_URL = https://db-stg.mws.web.id  (or the prod domain)
//      API_TOKEN    = the token shown once when the API Client was created
//                      in mws-data-center (Access > API Clients), for a
//                      client granted the students:roster_export:read scope
//      SHEET_NAME   = optional, defaults to "Complete Database" (the tab
//                      the photo-link script already targets by name) -
//                      set this if the target tab is actually named
//                      something else.
//      SHEET_GID    = optional - the numeric gid of the target tab (the
//                      "gid=..." in the sheet's URL). Takes priority over
//                      SHEET_NAME if both are set.
// 4. Run syncRosterFromCentral once manually from the editor to grant the
//    UrlFetchApp permission prompt and confirm it writes rows correctly.
// 5. Run setupMwsRosterSyncTrigger ONCE to install the schedule. Don't call
//    it from syncRosterFromCentral - it stacks a duplicate trigger every
//    sync. To change the schedule later, delete the old trigger first
//    (Triggers - the clock icon in the left sidebar), then run
//    setupMwsRosterSyncTrigger again.
//
// Endpoint reference: GET /api/internal/students/roster-export
// (returns every status by default - active, graduated, etc. all in one
// pull. Pass ?status=ACTIVE, ?status=GRADUATED, etc. to narrow it down if
// a particular sheet/tab only needs one status).

const MwsRosterSync = (() => {
  // The sheet's own header, left exactly as-is - this is what row 1
  // already says, not something this script invents or restyles.
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
  const NIS_COL = 0; // Column A, 0-based
  const EMAIL_COL = 6; // Column G, 0-based - "Student MWS Email"
  const DEFAULT_SHEET_NAME = "Complete Database";

  function run() {
    const props = PropertiesService.getScriptProperties();
    const rawBaseUrl = props.getProperty("API_BASE_URL");
    const token = props.getProperty("API_TOKEN");

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
    const centralRows = body.data;

    const sheet = resolveTargetSheet();
    const lastRow = sheet.getLastRow();
    const existingValues =
      lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues() : [];

    const nisIndex = new Map();
    const emailIndex = new Map();
    existingValues.forEach((rowValues, i) => {
      const nis = String(rowValues[NIS_COL] || "").trim();
      const email = String(rowValues[EMAIL_COL] || "").trim().toLowerCase();
      if (nis) nisIndex.set(nis, i);
      if (email) emailIndex.set(email, i);
    });

    // Start from a copy of what's already there - anything not matched by
    // a central row below stays exactly as it was, Photo ID included.
    const merged = existingValues.map((rowValues) => rowValues.slice());

    let matchedCount = 0;
    let appendedCount = 0;

    centralRows.forEach((row) => {
      const legacyRest = toLegacyRow(row); // [NIS, FullName, ...] - no Photo ID
      const nis = String(row.nis || row.legacy_nis || "").trim();
      const email = String(row.email || "").trim().toLowerCase();

      let targetIndex = nis && nisIndex.has(nis) ? nisIndex.get(nis) : undefined;
      if (targetIndex === undefined && email && emailIndex.has(email)) {
        targetIndex = emailIndex.get(email);
      }

      if (targetIndex === undefined) {
        const newRow = new Array(HEADER.length).fill("");
        applyLegacyRest(newRow, legacyRest);
        merged.push(newRow);
        appendedCount++;
      } else {
        applyLegacyRest(merged[targetIndex], legacyRest);
        matchedCount++;
      }
    });

    if (merged.length > 0) {
      sheet.getRange(2, 1, merged.length, HEADER.length).setValues(merged);
    }

    Logger.log(
      `Synced ${centralRows.length} students (${matchedCount} updated, ${appendedCount} appended, ` +
      `${existingValues.length - matchedCount} existing rows left untouched) at ${new Date().toISOString()}`,
    );
  }

  // Writes a toLegacyRow() result (index 0 = Column A, index 1 = Column C,
  // ...) into a full-width row array, in place - Column B (index 1 of the
  // full row) is always skipped, so whatever was already there survives.
  function applyLegacyRest(fullRow, legacyRest) {
    fullRow[0] = legacyRest[0];
    for (let i = 1; i < legacyRest.length; i++) {
      fullRow[i + 1] = legacyRest[i];
    }
  }

  function resolveTargetSheet() {
    const props = PropertiesService.getScriptProperties();
    const sheetGid = props.getProperty("SHEET_GID");
    const active = SpreadsheetApp.getActive();

    if (sheetGid) {
      const targetGid = Number(sheetGid);
      const match = active.getSheets().find((s) => s.getSheetId() === targetGid);
      if (!match) {
        throw new Error(`No sheet with gid ${sheetGid} found in this spreadsheet.`);
      }
      return match;
    }

    const sheetName = props.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME;
    const byName = active.getSheetByName(sheetName);
    if (!byName) {
      throw new Error(
        `No sheet named "${sheetName}" found - set SHEET_NAME or SHEET_GID in ` +
        `Script Properties to point at the right tab.`,
      );
    }
    return byName;
  }

  // Maps one roster-export JSON row onto the sheet's original columns,
  // minus Photo ID (B) which this script never writes. Index 0 here is
  // Column A, index 1 is Column C, and so on.
  function toLegacyRow(row) {
    return [
      row.nis || row.legacy_nis || "",
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

  return { run };
})();

function syncRosterFromCentral() {
  MwsRosterSync.run();
}

function setupMwsRosterSyncTrigger() {
  ScriptApp.newTrigger("syncRosterFromCentral")
    .timeBased()
    .everyHours(6) // adjust: everyHours(1), atHour(0) for midnight, etc.
    .create();
}
