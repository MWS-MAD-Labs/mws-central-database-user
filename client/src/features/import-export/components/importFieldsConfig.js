import {
  capitalizeWords,
  formatBankAccountNumber,
  formatBpjsEmploymentNumber,
  formatBpjsNumber,
  formatEmployeeId,
  formatKpjNumber,
  formatNik,
  formatNpwp,
  phoneDigitsOnly,
} from "../../../lib/form.js";
import {
  educationLevels,
  employeeStatuses,
  employmentTypes,
  genderOptions,
  maritalStatuses,
  religionOptions,
} from "../../employees/api/employeesApi.js";
import { studentEntryTypes, studentStatuses } from "../../students/api/studentsApi.js";
import { vaccineTypes } from "../../students/api/studentSensitiveApi.js";

export const entityLabels = {
  students: "students",
  employees: "employees",
};

export const GENDER_VALUE_ALIASES = {
  m: "MALE",
  f: "FEMALE",
  l: "MALE",
  p: "FEMALE",
};

export const RELIGION_VALUE_ALIASES = {
  islam: "ISLAM",
  kristen: "PROTESTANTISM",
  christian: "PROTESTANTISM",
  christianity: "PROTESTANTISM",
  "christianity - protestant": "PROTESTANTISM",
  "christianity - prosestant": "PROTESTANTISM",
  "kristen - protestan": "PROTESTANTISM",
  protestant: "PROTESTANTISM",
  protestan: "PROTESTANTISM",
  "christianity - catholic": "CATHOLICISM",
  "christianity - chatholic": "CATHOLICISM",
  "christianity - chatolic": "CATHOLICISM",
  catholic: "CATHOLICISM",
  katolik: "CATHOLICISM",
  hindu: "HINDUISM",
  buddha: "BUDDHISM",
  budha: "BUDDHISM",
  buddhist: "BUDDHISM",
  konghucu: "CONFUCIANISM",
  confucian: "CONFUCIANISM",
  confucianism: "CONFUCIANISM",
  other: "OTHER",
};

export const STUDENT_STATUS_VALUE_ALIASES = {
  "left school": "WITHDRAWN",
};

export const BLOOD_TYPE_VALUE_ALIASES = {
  a: "A",
  "a+": "A",
  "a-": "A",
  b: "B",
  "b+": "B",
  "b-": "B",
  ab: "AB",
  "ab+": "AB",
  "ab-": "AB",
  o: "O",
  "o+": "O",
  "o-": "O",
  "tidak diketahui": "UNKNOWN",
  "-": "UNKNOWN",
};

export const FIELD_VALUE_ALIASES = {
  gender: GENDER_VALUE_ALIASES,
  religion: RELIGION_VALUE_ALIASES,
  status: STUDENT_STATUS_VALUE_ALIASES,
  blood_type: BLOOD_TYPE_VALUE_ALIASES,
};

export const MONTH_NAME_TO_INDEX = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maret: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  agustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
  desember: 11,
};

function toISODate(year, monthIndex, day) {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateStringToISO(dateStr) {
  const raw = (dateStr || "").trim();
  if (!raw) return "";

  const ddMonthNameYYYY = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (ddMonthNameYYYY) {
    const [, day, monthStr, year] = ddMonthNameYYYY;
    const monthIndex = MONTH_NAME_TO_INDEX[monthStr.toLowerCase()];
    if (monthIndex === undefined) return "";
    return toISODate(Number(year), monthIndex, Number(day));
  }

  const ddMMYYYY = raw.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (ddMMYYYY) {
    const [, day, month, year] = ddMMYYYY;
    return toISODate(Number(year), Number(month) - 1, Number(day));
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  return "";
}

export const requiredImportFields = {
  employees: [
    "employee_id",
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "unit",
    "job_position",
    "job_level",
    "building",
    "join_date",
    "employment_type",
    "marital_status",
  ],
  students: [
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "entry_type",
    "current_grade",
  ],
};

export const defaultPreviewFields = {
  employees: [
    "employee_id",
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "unit",
    "job_position",
    "job_level",
    "building",
    "join_date",
    "employment_type",
    "contract_end_date",
    "marital_status",
    "status",
  ],
  students: [
    "full_name",
    "nick_name",
    "email",
    "gender",
    "religion",
    "birth_place",
    "birth_date",
    "nisn",
    "entry_type",
    "current_grade",
    "join_academic_year",
    "status",
    "father_name",
    "father_phone",
    "mother_name",
    "mother_phone",
    "blood_type",
  ],
};

export const OVERRIDE_REASON_TEMPLATES = [
  "Verified via report card",
  "Confirmed with parent",
  "Confirmed with school",
  "Not verified",
  "Sheet mismatch",
  "Imported as-is",
];

export const importFields = {
  employees: [
    { key: "employee_id", label: "Employee ID" },
    { key: "full_name", label: "Full Name" },
    { key: "nick_name", label: "Nick" },
    { key: "email", label: "Email" },
    { key: "gender", label: "Gender", options: genderOptions },
    { key: "religion", label: "Religion", options: religionOptions },
    { key: "religion_other", label: "Religion (Other)" },
    { key: "birth_place", label: "Birth Place" },
    { key: "birth_date", label: "Birth Date", type: "date" },
    { key: "unit", label: "Unit", optionSource: "units" },
    {
      key: "job_position",
      label: "Job Position",
      optionSource: "jobPositions",
    },
    { key: "job_level", label: "Job Level", optionSource: "jobLevels" },
    { key: "building", label: "Building", optionSource: "buildings" },
    { key: "join_date", label: "Join Date", type: "date" },
    {
      key: "employment_type",
      label: "Employment Type",
      options: employmentTypes,
    },
    {
      key: "contract_end_date",
      label: "Contract End Date",
      type: "date",
    },
    {
      key: "marital_status",
      label: "Marital Status",
      options: maritalStatuses,
    },
    { key: "status", label: "Status", options: employeeStatuses },
    { key: "last_working_date", label: "Last Working Date", type: "date" },
    { key: "notes", label: "Notes" },
    { key: "photo_url", label: "Photo ID" },
    { key: "mobile_phone", label: "Mobile Phone" },
    { key: "residential_address", label: "Residential Address" },
    { key: "nik", label: "NIK" },
    { key: "npwp", label: "NPWP" },
    { key: "bank_account_number", label: "Bank Account Number" },
    { key: "bpjs_number", label: "BPJS Kesehatan Number" },
    { key: "bpjs_employment_number", label: "BPJS Ketenagakerjaan Number" },
    { key: "kpj_number", label: "KPJ Number" },
    {
      key: "education_level",
      label: "Education Level",
      options: educationLevels,
    },
    { key: "institution_name", label: "Institution Name" },
    { key: "major", label: "Major" },
    { key: "graduation_year", label: "Graduation Year" },
  ],
  students: [
    { key: "full_name", label: "Full Name" },
    { key: "nick_name", label: "Nick Name" },
    { key: "email", label: "Email" },
    { key: "gender", label: "Gender", options: genderOptions },
    { key: "religion", label: "Religion", options: religionOptions },
    { key: "religion_other", label: "Religion (Other)" },
    { key: "birth_place", label: "Birth Place" },
    { key: "birth_date", label: "Birth Date", type: "date" },
    { key: "nis", label: "NIS" },
    { key: "nisn", label: "NISN" },
    { key: "entry_type", label: "Entry Type", options: studentEntryTypes },
    { key: "current_grade", label: "Current Grade", optionSource: "grades" },
    {
      key: "join_academic_year",
      label: "Join Academic Year",
      optionSource: "academicYears",
    },
    { key: "previous_school", label: "Previous School" },
    { key: "status", label: "Status", options: studentStatuses },
    { key: "photo_url", label: "Photo ID" },
    { key: "leave_year", label: "Leave Year" },
    { key: "sn", label: "SN", options: ["TRUE", "FALSE"] },
    { key: "join_grade", label: "Join Grade", optionSource: "grades" },
    {
      key: "graduation_grade",
      label: "Graduation Grade",
      optionSource: "grades",
    },
    {
      key: "override_too_far_ahead_reason",
      label: "Grade Consistency Override Reason (Super Admin)",
      options: OVERRIDE_REASON_TEMPLATES,
      creatable: true,
    },
    {
      key: "pickup_drop_service",
      label: "Pickup Drop Service",
      options: ["TRUE", "FALSE"],
    },
    {
      key: "catering_service",
      label: "Catering Service",
      options: ["TRUE", "FALSE"],
    },
    { key: "psb_guide", label: "PSB Guide", options: ["TRUE", "FALSE"] },
    { key: "father_name", label: "Father" },
    { key: "father_phone", label: "Father's Phone" },
    { key: "father_email", label: "Father's Email" },
    { key: "mother_name", label: "Mother" },
    { key: "mother_phone", label: "Mother's Phone" },
    { key: "mother_email", label: "Mother's Email" },
    { key: "parent_address", label: "Address" },
    { key: "health_info", label: "Health Information" },
    { key: "special_needs", label: "Special Needs" },
    {
      key: "blood_type",
      label: "Blood Type",
      options: ["A", "B", "AB", "O", "UNKNOWN"],
    },
    { key: "media_consent_sign", label: "Media Consent Sign" },
    {
      key: "media_consent_yes",
      label: "Media Consent YES",
      options: ["YES", "NO"],
    },
    { key: "parent_consent_sign", label: "Parent Consent Sign" },
    { key: "pc_monday", label: "PC Monday" },
    { key: "pc_tuesday", label: "PC Tuesday" },
    { key: "pc_wednesday", label: "PC Wednesday" },
    { key: "pc_thursday", label: "PC Thursday" },
    { key: "vaccine_type", label: "Vaccine Type", options: vaccineTypes },
    {
      key: "vaccine_received",
      label: "Vaccine Received",
      options: ["TRUE", "FALSE"],
    },
    { key: "vaccine_date", label: "Vaccine Date", type: "date" },
    { key: "current_class", label: "Current Class", optionSource: "classes" },
    {
      key: "current_class_start_date",
      label: "Class Start Date",
      type: "date",
    },
    { key: "current_class_end_date", label: "Class End Date", type: "date" },
  ],
};

export const FIELD_KEYSTROKE_FILTERS = {
  employee_id: formatEmployeeId,
  full_name: capitalizeWords,
  nick_name: capitalizeWords,
  institution_name: capitalizeWords,
  major: capitalizeWords,
  mobile_phone: phoneDigitsOnly,
  nik: formatNik,
  npwp: formatNpwp,
  bank_account_number: formatBankAccountNumber,
  bpjs_number: formatBpjsNumber,
  bpjs_employment_number: formatBpjsEmploymentNumber,
  kpj_number: formatKpjNumber,
  graduation_year: (raw) => raw.replace(/\D/g, "").slice(0, 4),
};

export const IMPORT_FIELD_LABEL_TO_KEY = Object.fromEntries(
  [...importFields.employees, ...importFields.students].map((field) => [
    field.label,
    field.key,
  ]),
);
