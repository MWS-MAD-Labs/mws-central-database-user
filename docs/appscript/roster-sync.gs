// Google Apps Script - pulls the flat student roster from mws-data-center
// and merges it into the school's existing report-card Google Sheet, in
// that sheet's original column layout (same header text/order it already
// has - see https://docs.google.com/spreadsheets/d/1G7PsyA7-NQyR-1lbPNg-MvHHkcD-LdOjvusj3M4yrQo),
// except Emails has been split into separate Father Email / Mother Email
// columns (ensureHeaderMigrated() performs that one-time migration
// automatically, inserting a real new column so existing rows shift
// along with it instead of misaligning).
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
// - Photo ID (Column B) is overwritten with central's link ONLY when
//   central actually has one - if central has no photo on file for that
//   student, whatever's already in the cell (e.g. something
//   updateProfilePhotoLinks_Optimized found by matching a Drive folder)
//   is left alone rather than blanked out.
// - Row 1's formatting (colors, fonts, column widths, frozen rows) is
//   never touched - only cell text changes when the header migration runs.
//
// Everything below lives inside the MwsRosterSync namespace object except
// the two entry points Apps Script needs as plain global functions
// (syncRosterFromCentral, setupMwsRosterSyncTrigger) - this project already
// has other scripts in it (photo links, Workspace user creation), and Apps
// Script shares one global scope across every .gs file, so a bare
// top-level name can collide with something already declared elsewhere.
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
//    UrlFetchApp permission prompt, perform the one-time header migration,
//    and confirm it writes rows correctly.
// 5. Run setupMwsRosterSyncTrigger to install the schedule - safe to run
//    more than once (by accident or on purpose after changing the
//    schedule below), it always clears out any existing trigger on this
//    function first so there's never more than one active.
// 6. (Only if an earlier version of this script already ran and wrote
//    MinIO links into Photo ID) Run clearStaleMinioPhotoLinks once to
//    blank those out, then run updateProfilePhotoLinks_Optimized to
//    refill them properly from the Drive folder.
//
// Endpoint reference: GET /api/internal/students/roster-export
// (returns every status by default - active, graduated, etc. all in one
// pull. Pass ?status=ACTIVE, ?status=GRADUATED, etc. to narrow it down if
// a particular sheet/tab only needs one status).

const MwsRosterSync = (() => {
  // The sheet's header, post-migration (Father Email / Mother Email as
  // their own columns instead of one combined Emails column).
  const HEADER = [
    "NIS", "Photo ID", "Full Name", "Nick Name", "Gender", "Current status",
    "Student MWS Email", "Current grade (If Active)", "Class Name",
    "Join Academic year", "Leave year (If Graduated)", "SN", "Join Grade",
    "Graduation Grade", "Previous School", "NISN", "Religion",
    "Place, Date of birth", "Father", "Mother", "Father's Phone",
    "Father Email", "Mother's Phone", "Mother Email", "Address",
    "Health Information", "Blood Type",
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
    ensureHeaderMigrated(sheet);

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
    // a central row below stays exactly as it was.
    const merged = existingValues.map((rowValues) => rowValues.slice());

    let matchedCount = 0;
    let appendedCount = 0;

    centralRows.forEach((row) => {
      const nis = String(row.nis || row.legacy_nis || "").trim();
      const email = String(row.email || "").trim().toLowerCase();

      let targetIndex = nis && nisIndex.has(nis) ? nisIndex.get(nis) : undefined;
      if (targetIndex === undefined && email && emailIndex.has(email)) {
        targetIndex = emailIndex.get(email);
      }

      if (targetIndex === undefined) {
        const newRow = new Array(HEADER.length).fill("");
        applyCentralRow(newRow, row);
        merged.push(newRow);
        appendedCount++;
      } else {
        applyCentralRow(merged[targetIndex], row);
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

  // Grade name mws-data-center's import falls back to when a legacy row's
  // grade genuinely wasn't on file (server/src/model/grade-model.ts,
  // UNKNOWN_LEGACY_GRADE_NAME) - a real, non-blank value, so the plain
  // "only overwrite if truthy" guard below doesn't catch it on its own.
  const UNKNOWN_LEGACY_GRADE_NAME = "Unknown (Legacy Import)";

  // Writes one central roster-export row into a full-width sheet row
  // array, in place, in HEADER's exact column order.
  //
  // A number of Student fields fall back to a non-blank placeholder
  // during legacy import when the original data genuinely wasn't
  // available (birth_place "Unknown", birth_date "1900-01-01", the grade
  // name above) rather than being left null - see the
  // import-legacy-data-sentinel-defaults note in mws-data-center. Those
  // aren't "central's answer", they're "central doesn't know either", so
  // - like Photo ID and Class Name above - they're only written when they
  // look like real data, never used to clobber whatever the sheet
  // already has. Note: religion also has a placeholder ("OTHER") on
  // import, but OTHER is also a legitimate real answer (Baha'i, Sikh,
  // etc.) with no way to tell them apart from the data alone, so it's
  // NOT guarded here - it always overwrites, same as any other field.
  function applyCentralRow(fullRow, row) {
    // Photo ID - only overwrite when central actually has a link. Central
    // having nothing on file isn't a signal to erase whatever's already
    // there (e.g. from the Drive-folder-matching script).
    if (row.photo_url) fullRow[1] = row.photo_url;

    // Class Name - same rule. A blank current_class from central usually
    // just means this student hasn't been enrolled into a class there yet
    // (a known gap left for admins to backfill via Historical Data/
    // Promote, not a signal the sheet's existing class name is wrong) -
    // don't erase real legacy data over an in-progress migration gap.
    if (row.current_class) fullRow[8] = row.current_class;

    // NIS - central can have neither nis nor legacy_nis yet for a
    // student only matched here by email; don't blank out a real legacy
    // NIS the sheet already had on file.
    if (row.nis || row.legacy_nis) fullRow[0] = row.nis || row.legacy_nis;

    // Leave year / Graduation grade / Previous school / NISN - all
    // nullable fields with no guaranteed re-entry point after import;
    // central having nothing here doesn't mean the sheet's value is
    // wrong.
    if (row.leave_year) fullRow[10] = row.leave_year;
    if (row.graduation_grade) fullRow[13] = row.graduation_grade;
    if (row.previous_school) fullRow[14] = row.previous_school;
    if (row.nisn) fullRow[15] = row.nisn;

    // Join Grade - a required field, so central always sends something,
    // but that something can be the sentinel above rather than a real
    // grade.
    if (row.join_grade && row.join_grade !== UNKNOWN_LEGACY_GRADE_NAME) {
      fullRow[12] = row.join_grade;
    }

    // Place, Date of birth - skip the whole combined cell if either half
    // looks like the import sentinel, rather than writing a half-real,
    // half-placeholder string over whatever the sheet already had.
    const isSentinelBirthInfo =
      row.birth_place === "Unknown" ||
      String(row.birth_date || "").indexOf("1900-01-01") === 0;
    if (!isSentinelBirthInfo) {
      fullRow[17] = formatBirthPlaceDate(row.birth_place, row.birth_date);
    }

    fullRow[2] = row.full_name;
    fullRow[3] = row.nick_name;
    fullRow[4] = titleCase(row.gender);
    fullRow[5] = titleCase(row.status);
    fullRow[6] = row.email;
    fullRow[7] = row.current_grade || "";
    fullRow[9] = row.join_academic_year;
    fullRow[11] = row.sn || "";
    fullRow[16] = titleCase(row.religion);

    // Parent contact, health, and PC-activity fields - all backed by a
    // separate relation table that may simply not be migrated into
    // central yet for a given student, same reasoning as Class Name
    // above. Central having nothing here isn't proof the sheet is wrong.
    if (row.father_name) fullRow[18] = row.father_name;
    if (row.mother_name) fullRow[19] = row.mother_name;
    if (row.father_phone) fullRow[20] = row.father_phone;
    if (row.father_email) fullRow[21] = row.father_email;
    if (row.mother_phone) fullRow[22] = row.mother_phone;
    if (row.mother_email) fullRow[23] = row.mother_email;
    if (row.address) fullRow[24] = row.address;
    if (row.health_information) fullRow[25] = row.health_information;
    if (row.blood_type) fullRow[26] = row.blood_type;
    if (row.special_needs) fullRow[27] = row.special_needs;
    if (row.pc_monday) fullRow[31] = row.pc_monday;
    if (row.pc_tuesday) fullRow[32] = row.pc_tuesday;
    if (row.pc_wednesday) fullRow[33] = row.pc_wednesday;
    if (row.pc_thursday) fullRow[34] = row.pc_thursday;

    // Consent columns - NOT guarded like the rest above, and this is a
    // known gap: media_consent_signed/parent_consent_signed are plain
    // booleans, so "false" can't be told apart from "central has no
    // consent record for this student at all" (vs. a real, deliberate
    // decline). A student whose sheet already shows a signed consent
    // could have it flipped to unsigned here if their consent record
    // hasn't been migrated into central yet - spot-check consent columns
    // after a sync rather than trusting them blindly, until the API
    // exposes a real PENDING/not-on-file state instead of just true/false.
    fullRow[28] = row.media_consent_signed;
    fullRow[29] = row.media_consent_signed;
    fullRow[30] = row.parent_consent_signed;
  }

  // One-time migration: the sheet originally had a single "Emails" column
  // between Father's Phone and Mother's Phone. Splits it into Father
  // Email (renaming that cell in place) and Mother Email (a genuinely
  // new column inserted after Mother's Phone, so every existing row's
  // data to the right shifts along with it instead of misaligning under
  // the new header). Safe to call every run - it's a no-op once "Father
  // Email" is already present.
  function ensureHeaderMigrated(sheet) {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    if (headerRow.indexOf("Father Email") !== -1) return; // already migrated

    const emailsCol = headerRow.indexOf("Emails") + 1; // 1-based
    const mothersPhoneCol = headerRow.indexOf("Mother's Phone") + 1;

    if (emailsCol === 0 || mothersPhoneCol === 0) {
      throw new Error(
        "Couldn't find 'Emails' and \"Mother's Phone\" columns to migrate - " +
        "check the sheet's header row matches what this script expects.",
      );
    }

    sheet.getRange(1, emailsCol).setValue("Father Email");
    sheet.insertColumnAfter(mothersPhoneCol);
    sheet.getRange(1, mothersPhoneCol + 1).setValue("Mother Email");
    Logger.log("Migrated header: split Emails into Father Email / Mother Email.");
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

  function titleCase(value) {
    if (!value) return "";
    return value
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function formatBirthPlaceDate(place, isoDate) {
    if (!place && !isoDate) return "";
    const formattedDate = isoDate
      ? Utilities.formatDate(new Date(isoDate), "GMT", "dd MMM yyyy")
      : "";
    return [place, formattedDate].filter(Boolean).join(", ");
  }

  // One-time cleanup for links written by an earlier version of this
  // script, back when it fell back to a MinIO presigned URL instead of
  // leaving Photo ID alone. Those are already expired (or will be within
  // an hour of being written) and useless as a permanent sheet value -
  // this blanks any Photo ID cell that looks like one, so
  // updateProfilePhotoLinks_Optimized() (or a future sync once central
  // has a real Drive link for that student) can fill it in properly
  // instead of leaving stale junk behind. Safe to run more than once -
  // matched cells are already gone after the first pass.
  function clearStaleMinioLinks() {
    const sheet = resolveTargetSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    const photoRange = sheet.getRange(2, 2, lastRow - 1, 1);
    const values = photoRange.getValues();
    let clearedCount = 0;

    const updated = values.map(([value]) => {
      const text = String(value || "");
      if (text.includes("X-Amz-Signature=")) {
        clearedCount++;
        return [""];
      }
      return [value];
    });

    photoRange.setValues(updated);
    Logger.log(`Cleared ${clearedCount} stale MinIO photo link(s).`);
  }

  return { run, clearStaleMinioLinks };
})();

function syncRosterFromCentral() {
  MwsRosterSync.run();
}

// Run this ONCE manually to blank out any Photo ID cell left over from
// before this script stopped writing MinIO presigned URLs - see the
// comment on clearStaleMinioLinks() above.
function clearStaleMinioPhotoLinks() {
  MwsRosterSync.clearStaleMinioLinks();
}

// Safe to run any number of times - removes any trigger already pointed
// at syncRosterFromCentral before creating a new one, so an accidental
// second run (or a deliberate re-run after changing the schedule below)
// never results in duplicate triggers firing the sync multiple times per
// cycle.
function setupMwsRosterSyncTrigger() {
  const existing = ScriptApp.getProjectTriggers().filter(
    (trigger) => trigger.getHandlerFunction() === "syncRosterFromCentral",
  );
  existing.forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("syncRosterFromCentral")
    .timeBased()
    .everyHours(6) // adjust: everyHours(1), atHour(0) for midnight, etc.
    .create();

  Logger.log(
    `Removed ${existing.length} existing trigger(s), installed a fresh one.`,
  );
}
