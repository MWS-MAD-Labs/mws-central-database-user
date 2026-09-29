import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { cn } from "../../../lib/cn.js";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import {
  CheckboxField,
  DateField,
  Field,
  SearchableSelect,
  TextAreaInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { SelectFilter } from "./SelectFilter.jsx";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { studentsApi } from "../../students/api/studentsApi.js";
import {
  classesApi,
  enrollmentCloseStatuses,
  enrollmentsApi,
} from "../api/academicApi.js";
import {
  capitalizeWords,
  cleanPayload,
  dateInputFromIso,
  isoFromDateInput,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { fetchAllPages } from "../../../lib/pagination.js";
import { workforceTargetValue } from "../utils/selectOptions.js";

const PROMOTE_WINDOW_DAYS = 30;

function windowOpensAt(endDate) {
  return new Date(
    new Date(endDate).getTime() - PROMOTE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
}

function formatCountdown(remainingMs) {
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

function classAllowedGrades(klass) {
  if (!klass) return [];
  return [klass.grade, ...(klass.additional_grades || [])].filter(Boolean);
}

function promoteRuleSatisfyingGrades(klass, sourceLevel, isRetention, allowSkip) {
  if (sourceLevel === undefined) return classAllowedGrades(klass);
  return classAllowedGrades(klass).filter((grade) => {
    if (isRetention) return grade.level === sourceLevel;
    if (grade.level <= sourceLevel) return false;
    if (!allowSkip && grade.level > sourceLevel + 1) return false;
    return true;
  });
}

export function EnrollmentDialog({
  dialog,
  options,
  presetClassId,
  presetClassStatus,
  excludeStudentIds,
  isSubmitting,
  onClose,
  onSubmit,
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [manualStepPendingStudentId, setManualStepPendingStudentId] =
    useState(null);
  const record = dialog.record;
  const isBulkPromote = dialog.mode === "bulk-promote";
  const isBulkTransfer = dialog.mode === "bulk-transfer";
  const isBulkClose = dialog.mode === "bulk-close";
  const isBulkAction = isBulkPromote || isBulkTransfer || isBulkClose;
  const [values, setValues] = useState(() => {
    const presetClass = presetClassId
      ? (options?.classes || []).find((klass) => klass.id === presetClassId)
      : null;
    const presetYear = presetClass
      ? (options?.academicYears || []).find(
          (year) => year.id === presetClass.academic_year?.id,
        )
      : null;
    const closeAcademicYear = (options?.academicYears || []).find(
      (year) => year.id === resolveCloseAcademicYearId(record, dialog.records),
    );
    return {
      student_id: record?.student?.id || "",
      class_id: presetClassId || record?.class?.id || "",
      start_date:
        presetClass && dialog.mode === "create"
          ? dateInputFromIso(presetYear?.start_date)
          : "",
      effective_date: "",
      promote_grade_id: "",
      end_date: computeCloseEndDateDefault(
        "TRANSFERRED",
        closeAcademicYear,
        resolveCloseFloorStartDate(record, dialog.records),
      ),
      status: "TRANSFERRED",
      is_legacy: false,
      is_retention: false,
      retention_reason: "",
      allow_grade_skip: false,
      special_education_employee_id: "",
      graduation_grade: (record || dialog.records?.[0])?.grade_level || "",
      leave_year: (record || dialog.records?.[0])?.academic_year?.name || "",
    };
  });
  const [selectedStudentIds, setSelectedStudentIds] = useState(() =>
    record?.student?.id ? [record.student.id] : [],
  );
  const [studentSearch, setStudentSearch] = useState("");
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(10);
  const [bulkRecordSearch, setBulkRecordSearch] = useState("");
  const [bulkRecordPage, setBulkRecordPage] = useState(1);
  const [bulkRecordPageSize, setBulkRecordPageSize] = useState(10);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isPreviewingBackfill, setIsPreviewingBackfill] = useState(false);
  const [backfillPreview, setBackfillPreview] = useState(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  const [excludedEnrollmentIds, setExcludedEnrollmentIds] = useState(
    () => new Set(),
  );
  const showClassField =
    dialog.mode !== "close" && !isBulkClose && !presetClassId;
  const showRetentionReason =
    (dialog.mode === "promote" || isBulkPromote) && values.is_retention;
  const showGraduationFields =
    (dialog.mode === "close" || isBulkClose) && values.status === "COMPLETED";
  const rawSelectedClass = (options?.classes || []).find(
    (klass) => klass.id === values.class_id,
  );
  const showTargetGrade =
    (dialog.mode === "promote" || isBulkPromote) &&
    classAllowedGrades(rawSelectedClass).length > 1;
  const errors = hasAttemptedSubmit
    ? computeEnrollmentErrors(values, {
        showClassField,
        showRetentionReason,
        showGraduationFields,
        showTargetGrade,
      })
    : {};
  const includedRecords = (dialog.records || []).filter(
    (enrollment) => !excludedEnrollmentIds.has(enrollment.id),
  );

  const bulkRecordSearchTerm = bulkRecordSearch.trim().toLowerCase();
  const filteredBulkRecords = bulkRecordSearchTerm
    ? (dialog.records || []).filter((enrollment) =>
        `${enrollment.student.full_name} ${enrollment.student.nis || ""} ${enrollment.class.name}`
          .toLowerCase()
          .includes(bulkRecordSearchTerm),
      )
    : dialog.records || [];
  const bulkRecordTotalPages = Math.max(
    Math.ceil(filteredBulkRecords.length / bulkRecordPageSize),
    1,
  );
  const clampedBulkRecordPage = Math.min(
    bulkRecordPage,
    bulkRecordTotalPages,
  );
  const pagedBulkRecords = filteredBulkRecords.slice(
    (clampedBulkRecordPage - 1) * bulkRecordPageSize,
    clampedBulkRecordPage * bulkRecordPageSize,
  );

  function toggleExcludedEnrollment(id) {
    setExcludedEnrollmentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const presetClassIsBlocked =
    dialog.mode === "create" &&
    Boolean(presetClassId) &&
    presetClassStatus === "INACTIVE" &&
    !values.is_legacy;

  const { user } = useAuth();
  const legacyClassesQuery = useQuery({
    queryKey: ["enrollment-legacy-classes"],
    enabled: dialog.mode === "create" && values.is_legacy,
    queryFn: () => classesApi.list({ page: 1, size: 100 }),
  });

  const allClasses = values.is_legacy
    ? legacyClassesQuery.data?.data || []
    : (options?.classes || []).filter((klass) => klass.status !== "INACTIVE");
  const unitFilteredClasses =
    user?.role === "DATABASE_ADMIN"
      ? allClasses.filter(
          (klass) =>
            options?.unitIdByGradeId?.get(klass.grade.id) === user.unit_id,
        )
      : allClasses;
  const transferSourceAcademicYearId =
    dialog.mode === "transfer"
      ? record?.academic_year?.id
      : isBulkTransfer &&
          (dialog.records || []).every(
            (enrollment) => enrollment.academic_year?.id === dialog.records[0]?.academic_year?.id,
          )
        ? dialog.records?.[0]?.academic_year?.id
        : undefined;
  const transferSourceClassIds = new Set(
    dialog.mode === "transfer"
      ? [record?.class?.id].filter(Boolean)
      : isBulkTransfer
        ? (dialog.records || []).map((enrollment) => enrollment.class?.id).filter(Boolean)
        : [],
  );
  const gradeLevelByName = new Map(
    (options?.grades || []).map((grade) => [grade.name, grade.level]),
  );
  const promoteSourceGradeLevel =
    dialog.mode === "promote"
      ? gradeLevelByName.get(record?.grade_level)
      : isBulkPromote &&
          includedRecords.every(
            (enrollment) => enrollment.grade_level === includedRecords[0]?.grade_level,
          )
        ? gradeLevelByName.get(includedRecords[0]?.grade_level)
        : undefined;
  const bulkPromoteMixedSourceGrades =
    isBulkPromote &&
    new Set(includedRecords.map((enrollment) => enrollment.grade_level)).size > 1;
  const transferSourceGradeLevel =
    dialog.mode === "transfer"
      ? gradeLevelByName.get(record?.grade_level)
      : isBulkTransfer &&
          (dialog.records || []).every(
            (enrollment) => enrollment.grade_level === dialog.records[0]?.grade_level,
          )
        ? gradeLevelByName.get(dialog.records?.[0]?.grade_level)
        : undefined;
  const academicYearById = new Map(
    (options?.academicYears || []).map((year) => [year.id, year]),
  );
  const promoteSourceAcademicYearId =
    dialog.mode === "promote"
      ? record?.academic_year?.id
      : isBulkPromote &&
          includedRecords.every(
            (enrollment) => enrollment.academic_year?.id === includedRecords[0]?.academic_year?.id,
          )
        ? includedRecords[0]?.academic_year?.id
        : undefined;
  const promoteSourceAcademicYear = academicYearById.get(
    promoteSourceAcademicYearId,
  );
  const promoteSourceAcademicYearStart = promoteSourceAcademicYear?.start_date;
  const promoteTargetAcademicYearId = promoteSourceAcademicYearStart
    ? (options?.academicYears || [])
        .filter(
          (year) =>
            new Date(year.start_date) > new Date(promoteSourceAcademicYearStart),
        )
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))[0]
        ?.id
    : undefined;
  const noPromoteTargetYear =
    (dialog.mode === "promote" || isBulkPromote) &&
    !bulkPromoteMixedSourceGrades &&
    promoteSourceGradeLevel !== undefined &&
    !promoteTargetAcademicYearId;
  const promoteWindowRemainingMs =
    (dialog.mode === "promote" || isBulkPromote) &&
    promoteSourceAcademicYear?.end_date
      ? windowOpensAt(promoteSourceAcademicYear.end_date).getTime() -
        now.getTime()
      : null;
  const promoteWindowBlocked =
    promoteWindowRemainingMs !== null && promoteWindowRemainingMs > 0;
  const closeSourceAcademicYear = academicYearById.get(
    resolveCloseAcademicYearId(record, dialog.records),
  );
  const graduationWindowRemainingMs =
    (dialog.mode === "close" || isBulkClose) &&
    values.status === "COMPLETED" &&
    closeSourceAcademicYear?.end_date
      ? windowOpensAt(closeSourceAcademicYear.end_date).getTime() -
        now.getTime()
      : null;
  const graduationWindowBlocked =
    graduationWindowRemainingMs !== null && graduationWindowRemainingMs > 0;
  const classOptions = unitFilteredClasses.filter((klass) => {
    if (bulkPromoteMixedSourceGrades) return false;
    if (
      transferSourceAcademicYearId &&
      klass.academic_year?.id !== transferSourceAcademicYearId
    ) {
      return false;
    }
    if (transferSourceClassIds.has(klass.id)) return false;
    if (
      transferSourceGradeLevel !== undefined &&
      !classAllowedGrades(klass).some(
        (grade) => grade.level === transferSourceGradeLevel,
      )
    ) {
      return false;
    }
    if (promoteSourceGradeLevel !== undefined) {
      if (klass.academic_year?.id !== promoteTargetAcademicYearId) {
        return false;
      }
      if (
        promoteRuleSatisfyingGrades(
          klass,
          promoteSourceGradeLevel,
          values.is_retention,
          values.allow_grade_skip,
        ).length === 0
      ) {
        return false;
      }
    }
    return true;
  });

  const selectedClass = classOptions.find(
    (klass) => klass.id === values.class_id,
  );
  const selectedClassGradeIds = classAllowedGrades(selectedClass).map(
    (grade) => grade.id,
  );
  const classStudentOptionsQuery = useQuery({
    queryKey: [
      "students",
      "enrollment-candidates",
      { grade_ids: [...selectedClassGradeIds].sort() },
    ],
    enabled:
      dialog.mode === "create" &&
      !values.is_legacy &&
      selectedClassGradeIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        selectedClassGradeIds.flatMap((gradeId) => [
          fetchAllPages(studentsApi.list, {
            current_grade_id: gradeId,
            status: "REGISTERED",
          }),
          fetchAllPages(studentsApi.list, {
            current_grade_id: gradeId,
            status: "ACTIVE",
          }),
        ]),
      );
      const students = dedupeStudents(
        results.flatMap((result) => result.data || []),
      );
      return students.filter((student) => !student.academic.current_class_id);
    },
  });
  const legacyStudentOptionsQuery = useQuery({
    queryKey: [
      "students",
      "enrollment-candidates",
      {
        academic_year_id: selectedClass?.academic_year?.id,
        grade_ids: [...selectedClassGradeIds].sort(),
        legacy: true,
      },
    ],
    enabled:
      dialog.mode === "create" &&
      values.is_legacy &&
      Boolean(selectedClass?.academic_year?.id) &&
      selectedClassGradeIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        selectedClassGradeIds.map((gradeId) =>
          fetchAllPages(studentsApi.listBackfillCandidates, {
            academic_year_id: selectedClass.academic_year.id,
            grade_id: gradeId,
          }),
        ),
      );
      return dedupeStudents(results.flatMap((result) => result.data || []));
    },
  });
  const studentOptionsQuery = values.is_legacy
    ? legacyStudentOptionsQuery
    : classStudentOptionsQuery;
  const excludedStudentIdSet = new Set(excludeStudentIds || []);
  const selectedStudents = (studentOptionsQuery.data || []).filter(
    (student) => selectedStudentIds.includes(student.id),
  );
  const candidateStudents = (studentOptionsQuery.data || [])
    .filter((student) => !excludedStudentIdSet.has(student.id))
    .filter((student) =>
      studentGradeFilter
        ? student.academic.current_grade === studentGradeFilter
        : true,
    );
  const studentSearchTerm = studentSearch.trim().toLowerCase();
  const filteredCandidateStudents = studentSearchTerm
    ? candidateStudents.filter((student) =>
        `${student.identity.full_name} ${student.academic.nis || ""}`
          .toLowerCase()
          .includes(studentSearchTerm),
      )
    : candidateStudents;
  const studentTotalPages = Math.max(
    Math.ceil(filteredCandidateStudents.length / studentPageSize),
    1,
  );
  const clampedStudentPage = Math.min(studentPage, studentTotalPages);
  const pagedCandidateStudents = filteredCandidateStudents.slice(
    (clampedStudentPage - 1) * studentPageSize,
    clampedStudentPage * studentPageSize,
  );
  const allCandidatesSelected =
    filteredCandidateStudents.length > 0 &&
    filteredCandidateStudents.every((student) =>
      selectedStudentIds.includes(student.id),
    );

  const selectedAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === selectedClass?.academic_year?.id,
  );
  const recordAcademicYear = (options?.academicYears || []).find(
    (year) => year.id === record?.academic_year?.id,
  );

  function handleClassChange(classId) {
    const klass = classOptions.find((item) => item.id === classId);
    const year = (options?.academicYears || []).find(
      (item) => item.id === klass?.academic_year?.id,
    );
    const yearStartDate = dateInputFromIso(year?.start_date);
    const candidateGrades = klass
      ? promoteRuleSatisfyingGrades(
          klass,
          promoteSourceGradeLevel,
          values.is_retention,
          values.allow_grade_skip,
        )
      : [];

    setValues((current) => ({
      ...current,
      class_id: classId,
      student_id: "",
      ...(dialog.mode === "create" ? { start_date: yearStartDate } : {}),
      ...(dialog.mode === "promote" || isBulkPromote
        ? {
            effective_date: yearStartDate,
            promote_grade_id:
              candidateGrades.length === 1 ? candidateGrades[0].id : "",
          }
        : {}),
    }));
    if (dialog.mode === "create") {
      setSelectedStudentIds([]);
      setStudentSearch("");
      setStudentGradeFilter("");
      setStudentPage(1);
    }
  }

  function toggleStudent(studentId) {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  function toggleAllCandidates(checked) {
    setSelectedStudentIds((current) => {
      const filteredIds = new Set(filteredCandidateStudents.map((s) => s.id));
      if (checked) {
        return Array.from(new Set([...current, ...filteredIds]));
      }
      return current.filter((id) => !filteredIds.has(id));
    });
  }

  function submitCreate(studentIdsOverride) {
    const studentIds = studentIdsOverride ?? selectedStudentIds;
    onSubmit({
      studentId: studentIds[0],
      studentIds,
      students: selectedStudents
        .filter((student) => studentIds.includes(student.id))
        .map((student) => ({
          id: student.id,
          full_name: student.identity.full_name,
        })),
      payload: cleanPayload({
        class_id: values.class_id,
        academic_year_id: selectedClass?.academic_year?.id,
        start_date: isoFromDateInput(values.start_date),
        ...(values.is_legacy ? { is_legacy: true } : {}),
      }),
      specialEducationEmployeeId: values.is_legacy
        ? undefined
        : values.special_education_employee_id || undefined,
    });
  }

  async function handleManualStep(entry, step, klass) {
    setManualStepPendingStudentId(entry.student_id);
    try {
      await enrollmentsApi.create(entry.student_id, {
        class_id: klass.id,
        academic_year_id: step.academic_year_id,
        is_legacy: true,
      });
    } catch (error) {
      showErrorToast(error, "Couldn't create that enrollment.");
      setManualStepPendingStudentId(null);
      return;
    }
    setManualStepPendingStudentId(null);

    queryClient.invalidateQueries({ queryKey: ["enrollments"] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
    queryClient.invalidateQueries({ queryKey: ["classes"] });
    queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
    queryClient.invalidateQueries({ queryKey: ["class-detail-options"] });

    showSuccessToast(
      `${entry.full_name} enrolled into ${klass.name}. Promote them forward from there when ready.`,
    );

    const remainingStudentIds = selectedStudentIds.filter(
      (id) => id !== entry.student_id,
    );
    const remainingPreview = (backfillPreview || []).filter(
      (item) => item.student_id !== entry.student_id,
    );
    setSelectedStudentIds(remainingStudentIds);

    if (remainingPreview.length > 0) {
      setBackfillPreview(remainingPreview);
      return;
    }
    setBackfillPreview(null);
    if (remainingStudentIds.length > 0) {
      submitCreate(remainingStudentIds);
    } else {
      onClose();
    }
  }

  async function submit(event) {
    event.preventDefault();
    setHasAttemptedSubmit(true);
    if (
      Object.keys(
        computeEnrollmentErrors(values, {
          showClassField,
          showRetentionReason,
          showGraduationFields,
          showTargetGrade,
        }),
      ).length > 0
    ) {
      return;
    }
    if (isBulkAction && includedRecords.length === 0) return;
    if (dialog.mode === "create") {
      if (selectedStudentIds.length === 0) {
        showErrorToast("Select at least one student.");
        return;
      }
      if (!values.is_legacy) {
        setIsPreviewingBackfill(true);
        let preview = [];
        try {
          preview = await enrollmentsApi.previewBackfill({
            student_ids: selectedStudentIds,
            class_id: values.class_id,
            academic_year_id: selectedClass?.academic_year?.id,
          });
        } catch {
          // Preview failure must not block enrollment.
        }
        setIsPreviewingBackfill(false);
        if (preview.length > 0) {
          setBackfillPreview(preview);
          return;
        }
      }
      const confirmed = await confirm({
        title: `Enroll ${selectedStudents.length} student${
          selectedStudents.length === 1 ? "" : "s"
        } into ${selectedClass?.name}?`,
        wide: true,
        description: (
          <>
            <p>These students will get a new enrollment record:</p>
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-(--mws-line)">
              <table className="w-full text-left text-xs">
                <thead className="bg-(--mws-soft) font-semibold text-(--mws-muted)">
                  <tr>
                    <th className="px-3 py-2">Student</th>
                    <th className="px-3 py-2">NIS</th>
                    <th className="px-3 py-2">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedStudents.map((student) => (
                    <tr
                      key={student.id}
                      className="border-t border-(--mws-line)"
                    >
                      <td className="px-3 py-2">
                        {student.identity.full_name}
                      </td>
                      <td className="px-3 py-2">
                        {student.academic.nis || "-"}
                      </td>
                      <td className="px-3 py-2">
                        {student.academic.current_grade}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ),
        confirmLabel: "Enroll",
      });
      if (!confirmed) return;
      submitCreate();
      return;
    }

    if (dialog.mode === "transfer" || isBulkTransfer) {
      onSubmit(
        cleanPayload({ class_id: values.class_id }),
        isBulkTransfer ? includedRecords : undefined,
      );
      return;
    }

    if (dialog.mode === "promote" || isBulkPromote) {
      onSubmit(
        cleanPayload({
          class_id: values.class_id,
          academic_year_id: selectedClass?.academic_year?.id,
          grade_id: values.promote_grade_id || selectedClass?.grade?.id,
          effective_date: isoFromDateInput(values.effective_date),
          is_retention: values.is_retention,
          retention_reason: values.is_retention
            ? trimmedOrUndefined(values.retention_reason)
            : undefined,
          confirm_grade_skip: values.allow_grade_skip,
        }),
        isBulkPromote ? includedRecords : undefined,
      );
      return;
    }

    if (dialog.mode === "close" || isBulkClose) {
      onSubmit(
        cleanPayload({
          status: values.status,
          end_date: isoFromDateInput(values.end_date),
          ...(values.status === "COMPLETED"
            ? {
                graduation_grade: trimmedOrUndefined(values.graduation_grade),
                leave_year: trimmedOrUndefined(values.leave_year),
              }
            : {}),
        }),
        isBulkClose ? includedRecords : undefined,
      );
      return;
    }
  }

  return (
    <>
    <CrudDialog
      title={getEnrollmentDialogTitle(dialog.mode)}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            form="enrollment-form"
            type="submit"
            disabled={
              isSubmitting ||
              isPreviewingBackfill ||
              presetClassIsBlocked ||
              promoteWindowBlocked ||
              graduationWindowBlocked ||
              bulkPromoteMixedSourceGrades ||
              (isBulkAction && includedRecords.length === 0)
            }
            loading={isSubmitting || isPreviewingBackfill}
          >
            Save
          </Button>
        </>
      }
    >
      <form
        id="enrollment-form"
        onSubmit={submit}
        noValidate
        className="grid gap-4 md:grid-cols-2"
      >
        {dialog.mode === "create" ? (
          <CheckboxField
            className="md:col-span-2"
            label="Historical Data (Backfill A Past Enrollment)"
            description="Shows inactive classes too, for a student's very first enrollment, matched to their join grade. Always lands Active. Promote them forward from there to rebuild a Graduated, Transferred, or Withdrawn student's history one class at a time."
            checked={values.is_legacy}
            onChange={async (event) => {
              const checked = event.target.checked;
              if (selectedStudentIds.length > 0) {
                const confirmed = await confirm({
                  title: "Switch enrollment mode?",
                  description: `${selectedStudentIds.length} queued student${selectedStudentIds.length === 1 ? "" : "s"} will be cleared. The student list is different in ${checked ? "Historical Data" : "live enrollment"} mode.`,
                  confirmLabel: "Switch and clear",
                  tone: "danger",
                });
                if (!confirmed) return;
              }
              setValues((current) => ({
                ...current,
                is_legacy: checked,
                class_id: presetClassId || "",
              }));
              setSelectedStudentIds([]);
              setStudentSearch("");
              setStudentPage(1);
            }}
          />
        ) : null}

        {presetClassIsBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            This class is {formatStatus(presetClassStatus).toLowerCase()}, so
            it can't take a live enrollment. Check "Historical data" above to
            backfill a past record, or activate the class first.
          </div>
        ) : null}

        {bulkPromoteMixedSourceGrades ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            These students aren't all in the same grade, so they can't be
            promoted together. Exclude some, or promote them separately.
          </div>
        ) : null}

        {noPromoteTargetYear ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            {user?.role === "DATABASE_ADMIN" ? (
              <>
                The next academic year hasn't been created yet, so there's no
                class to promote into. Only a Super Admin can create an
                academic year - ask one to create it, then you can add this
                grade's class in Master Data.
              </>
            ) : (
              <>
                The next academic year hasn't been created yet, so there's no
                class to promote into. Create it (and this grade's class) in
                Master Data first.
              </>
            )}
          </div>
        ) : null}

        {promoteWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to promote. {promoteSourceAcademicYear?.name} doesn't
            end until {formatDate(promoteSourceAcademicYear.end_date)}.
            Opens in {formatCountdown(promoteWindowRemainingMs)}.
          </div>
        ) : null}

        {graduationWindowBlocked ? (
          <div className="rounded-xl border border-[#f3d7a3] bg-[#fff8e8] px-4 py-3 text-sm text-[#805b18] md:col-span-2">
            Too early to graduate. {closeSourceAcademicYear?.name} doesn't
            end until {formatDate(closeSourceAcademicYear.end_date)}.
            Opens in {formatCountdown(graduationWindowRemainingMs)}.
          </div>
        ) : null}

        {dialog.mode !== "close" && !isBulkClose && !presetClassId ? (
          <Field
            label="Class"
            className="md:col-span-2"
            error={errors.class_id}
            hint={
              errors.class_id
                ? undefined
                : dialog.mode === "create"
                  ? "Choose the destination class first."
                  : transferSourceAcademicYearId
                    ? "Only showing other classes in the same grade and academic year. To change grade, use Promote instead."
                    : promoteSourceGradeLevel !== undefined
                      ? values.is_retention
                        ? "Retention checked. Showing the same grade in the next academic year."
                        : values.allow_grade_skip
                          ? "Grade skip allowed. Showing every grade above the student's current one, in the next academic year."
                          : "Only showing the next grade up from the student's current one, in the next academic year. Check \"Allow Grade Skip\" below to jump further in grade."
                      : undefined
            }
          >
            <SearchableSelect
              required={hasAttemptedSubmit}
              value={values.class_id}
              onChange={handleClassChange}
              options={classSelectOptions(classOptions)}
              placeholder="Select Class"
              searchPlaceholder="Search Classes"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <div className="space-y-2 md:col-span-2">
            <Field
              label="Students"
              hint={
                values.is_legacy
                  ? selectedClass
                    ? "Only students with no enrollment yet, whose join year and join grade match this class. One-time only. After this, use Promote instead of backfilling again."
                    : "Select a class before adding students."
                  : selectedClass
                    ? `Showing ${classAllowedGrades(selectedClass).map((grade) => grade.name).join(" or ") || "matching"} students only. Check the ones to enroll, then save once.`
                    : "Select a class before adding students."
              }
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <TextInput
                    value={studentSearch}
                    onChange={(event) => {
                      setStudentSearch(event.target.value);
                      setStudentPage(1);
                    }}
                    disabled={!selectedClass || studentOptionsQuery.isLoading}
                    placeholder={
                      !selectedClass
                        ? "Select class first"
                        : studentOptionsQuery.isLoading
                          ? "Loading students..."
                          : "Search Name or NIS"
                    }
                  />
                </div>
                {selectedClass && classAllowedGrades(selectedClass).length > 1 ? (
                  <SelectFilter
                    value={studentGradeFilter}
                    onChange={(value) => {
                      setStudentGradeFilter(value);
                      setStudentPage(1);
                    }}
                    options={[
                      { value: "", label: "All Grades" },
                      ...classAllowedGrades(selectedClass).map((grade) => ({
                        value: grade.name,
                        label: grade.name,
                      })),
                    ]}
                    placeholder="All Grades"
                  />
                ) : null}
              </div>
            </Field>

            <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
              {filteredCandidateStudents.length > 0 ? (
                <label className="flex cursor-pointer items-center gap-3 border-b border-(--mws-line) bg-(--mws-soft) px-3 py-2 text-sm font-semibold text-(--mws-charcoal)">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                    checked={allCandidatesSelected}
                    onChange={(event) => toggleAllCandidates(event.target.checked)}
                  />
                  Select all {filteredCandidateStudents.length} matching
                  student{filteredCandidateStudents.length === 1 ? "" : "s"}
                </label>
              ) : null}
              {filteredCandidateStudents.length === 0 ? (
                <p
                  className={cn(
                    "p-3 text-sm text-(--mws-muted)",
                    !selectedClass || studentOptionsQuery.isLoading
                      ? "font-semibold"
                      : "leading-6",
                  )}
                >
                  {!selectedClass
                    ? "Select a class first."
                    : studentOptionsQuery.isLoading
                      ? "Loading students..."
                      : values.is_legacy
                        ? "No students match. This only lists students with no enrollment yet, whose join grade and join year match this class exactly."
                        : `No students currently at ${classAllowedGrades(selectedClass).map((grade) => grade.name).join(" or ") || "this grade"}. A student who already has an active enrollment elsewhere (even a Historical Data record) won't show here. Promote them forward from their current class instead.`}
                </p>
              ) : (
                <div className="divide-y divide-(--mws-line)">
                  {pagedCandidateStudents.map((student) => (
                    <div
                      key={student.id}
                      className="flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-(--mws-soft)"
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                          checked={selectedStudentIds.includes(student.id)}
                          onChange={() => toggleStudent(student.id)}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-display text-sm font-bold text-(--mws-charcoal)">
                            {student.identity.full_name}
                          </p>
                          <p className="truncate text-xs text-(--mws-muted)">
                            {[
                              student.academic.nis,
                              student.academic.current_grade,
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                          </p>
                        </div>
                      </label>
                      <Link
                        to={`/students/${student.id}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open student detail in a new tab"
                        className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                      >
                        <Eye size={15} />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              {filteredCandidateStudents.length > 0 ? (
                <PaginationBar
                  paging={{
                    current_page: clampedStudentPage,
                    total_page: studentTotalPages,
                    total_item: filteredCandidateStudents.length,
                    size: studentPageSize,
                  }}
                  itemLabel="students"
                  onPrevious={() => setStudentPage((page) => Math.max(page - 1, 1))}
                  onNext={() =>
                    setStudentPage((page) => Math.min(page + 1, studentTotalPages))
                  }
                  onPageSizeChange={(size) => {
                    setStudentPageSize(size);
                    setStudentPage(1);
                  }}
                />
              ) : null}
            </div>
            <p className="text-xs font-semibold text-(--mws-muted)">
              {selectedStudents.length} student
              {selectedStudents.length === 1 ? "" : "s"} selected.
            </p>
          </div>
        ) : null}

        {isBulkAction ? (
          <div className="space-y-2 md:col-span-2">
            <Field
              label="Selected Enrollments"
              hint={`${includedRecords.length} of ${dialog.records?.length || 0} selected enrollment(s) will be ${isBulkClose ? "closed" : "updated to this target class"}. Uncheck any you want to leave out.`}
            >
              <TextInput
                value={bulkRecordSearch}
                onChange={(event) => {
                  setBulkRecordSearch(event.target.value);
                  setBulkRecordPage(1);
                }}
                placeholder="Search Name, NIS, or Class"
              />
            </Field>

            <div className="overflow-hidden rounded-xl border border-(--mws-line) bg-white">
              {pagedBulkRecords.length === 0 ? (
                <p className="p-3 text-sm font-semibold text-(--mws-muted)">
                  No matching enrollments.
                </p>
              ) : (
                <div className="divide-y divide-(--mws-line)">
                  {pagedBulkRecords.map((enrollment) => {
                    const isExcluded = excludedEnrollmentIds.has(enrollment.id);
                    return (
                      <div
                        key={enrollment.id}
                        className={cn(
                          "flex min-w-0 items-center gap-3 px-3 py-2 hover:bg-(--mws-soft)",
                          isExcluded ? "opacity-50" : null,
                        )}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-(--mws-burgundy)"
                            checked={!isExcluded}
                            onChange={() => toggleExcludedEnrollment(enrollment.id)}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-display text-sm font-bold text-(--mws-charcoal)">
                              {enrollment.student.full_name}
                            </p>
                            <p className="truncate text-xs text-(--mws-muted)">
                              {[enrollment.student.nis, enrollment.class.name]
                                .filter(Boolean)
                                .join(" / ")}
                            </p>
                          </div>
                        </label>
                        <StatusBadge
                          tone={enrollmentStatusTone(enrollment.enrollment_status)}
                        >
                          {formatStatus(enrollment.enrollment_status)}
                        </StatusBadge>
                        <Link
                          to={`/students/${enrollment.student.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open student detail in a new tab"
                          className="shrink-0 rounded-lg p-1.5 text-(--mws-muted) hover:bg-white hover:text-(--mws-burgundy)"
                        >
                          <Eye size={15} />
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
              {filteredBulkRecords.length > 0 ? (
                <PaginationBar
                  paging={{
                    current_page: clampedBulkRecordPage,
                    total_page: bulkRecordTotalPages,
                    total_item: filteredBulkRecords.length,
                    size: bulkRecordPageSize,
                  }}
                  itemLabel="enrollments"
                  onPrevious={() =>
                    setBulkRecordPage((page) => Math.max(page - 1, 1))
                  }
                  onNext={() =>
                    setBulkRecordPage((page) =>
                      Math.min(page + 1, bulkRecordTotalPages),
                    )
                  }
                  onPageSizeChange={(size) => {
                    setBulkRecordPageSize(size);
                    setBulkRecordPage(1);
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}

        {dialog.mode === "create" && !values.is_legacy ? (
          <Field
            label="Special Education Teacher"
            className="md:col-span-2"
            hint="Student count shown is each teacher's current active caseload."
          >
            <SearchableSelect
              value={values.special_education_employee_id}
              onChange={(value) =>
                setValues({ ...values, special_education_employee_id: value })
              }
              options={specialEducationTeacherOptions(
                options?.specialEducationTeachers || [],
              )}
              placeholder="No Special Education teacher"
              searchPlaceholder="Search Employee"
            />
          </Field>
        ) : null}

        {dialog.mode === "create" ? (
          <Field
            label="Start Date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <DateField
              value={values.start_date}
              onChange={(event) =>
                setValues({ ...values, start_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <Field
            label="Effective Date"
            hint={academicYearRangeHint(selectedAcademicYear)}
          >
            <DateField
              value={values.effective_date}
              onChange={(event) =>
                setValues({ ...values, effective_date: event.target.value })
              }
            />
          </Field>
        ) : null}

        {showTargetGrade ? (
          <Field
            label="Target Grade"
            className="md:col-span-2"
            error={errors.promote_grade_id}
            hint="This class teaches more than one grade. Pick which one this promotion lands in."
          >
            <SearchableSelect
              required={hasAttemptedSubmit}
              value={values.promote_grade_id}
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  promote_grade_id: value,
                }))
              }
              options={promoteRuleSatisfyingGrades(
                selectedClass,
                promoteSourceGradeLevel,
                values.is_retention,
                values.allow_grade_skip,
              ).map((grade) => ({ value: grade.id, label: grade.name }))}
              placeholder="Select Grade"
              searchPlaceholder="Search Grades"
            />
          </Field>
        ) : null}

        {dialog.mode === "promote" || isBulkPromote ? (
          <>
            {!values.is_retention ? (
              <CheckboxField
                className="md:col-span-2"
                label="Allow Grade Skip"
                description="The Class picker above only shows the next grade up by default. Check this to also allow jumping more than one grade (e.g. Grade 7 straight to Grade 9)."
                checked={values.allow_grade_skip}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    allow_grade_skip: event.target.checked,
                  }))
                }
              />
            ) : null}
            <CheckboxField
              className="md:col-span-2"
              label="Retention (Repeat Grade)"
              description="Check this if the student is repeating the same grade, or moving to a lower grade, instead of a normal promotion."
              checked={values.is_retention}
              onChange={(event) =>
                setValues({ ...values, is_retention: event.target.checked })
              }
            />
            {values.is_retention ? (
              <Field
                label="Retention Reason"
                className="md:col-span-2"
                error={errors.retention_reason}
              >
                <TextAreaInput
                  invalid={Boolean(errors.retention_reason)}
                  value={values.retention_reason}
                  onChange={(event) =>
                    setValues({
                      ...values,
                      retention_reason: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
          </>
        ) : null}

        {dialog.mode === "close" || isBulkClose ? (
          <>
            <Field label="Close Status">
              <SearchableSelect
                value={values.status}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    status: value,
                    end_date: computeCloseEndDateDefault(
                      value,
                      (options?.academicYears || []).find(
                        (year) =>
                          year.id ===
                          resolveCloseAcademicYearId(record, dialog.records),
                      ),
                      resolveCloseFloorStartDate(record, dialog.records),
                    ),
                  }))
                }
                options={closeStatusOptions(enrollmentCloseStatuses)}
                placeholder="Select Status"
                searchPlaceholder="Search Status"
              />
            </Field>
            <Field
              label="End Date"
              hint={
                isBulkClose ? undefined : academicYearRangeHint(recordAcademicYear)
              }
            >
              <DateField
                value={values.end_date}
                onChange={(event) =>
                  setValues({ ...values, end_date: event.target.value })
                }
              />
            </Field>
            {values.status === "COMPLETED" ? (
              <>
                <Field
                  label="Graduation Grade"
                  error={errors.graduation_grade}
                  hint={
                    errors.graduation_grade
                      ? undefined
                      : "The grade the student is graduating from."
                  }
                >
                  <TextInput
                    invalid={Boolean(errors.graduation_grade)}
                    value={values.graduation_grade}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        graduation_grade: capitalizeWords(event.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Leave Year" error={errors.leave_year}>
                  <TextInput
                    invalid={Boolean(errors.leave_year)}
                    value={values.leave_year}
                    onChange={(event) =>
                      setValues({ ...values, leave_year: event.target.value })
                    }
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </form>
    </CrudDialog>
    {backfillPreview ? (
      <BackfillPreviewDialog
        entries={backfillPreview}
        pendingStudentId={manualStepPendingStudentId}
        onCancel={() => setBackfillPreview(null)}
        onManualStep={handleManualStep}
        onConfirm={() => {
          setBackfillPreview(null);
          submitCreate();
        }}
      />
    ) : null}
    </>
  );
}

const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";

function candidateClassOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    return {
      value: klass.id,
      label: klass.name,
      description: capacity.description,
      badge: capacity.badge,
      tone: capacity.tone,
      searchText: `${klass.name} ${capacity.description}`,
    };
  });
}

function candidateRealClasses(allClasses, step) {
  return allClasses.filter((klass) => {
    if (klass.name.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX)) return false;
    if (klass.academic_year?.id !== step.academic_year_id) return false;
    return [klass.grade, ...(klass.additional_grades || [])]
      .filter(Boolean)
      .some((grade) => grade.id === step.grade_id);
  });
}

function BackfillPreviewDialog({
  entries,
  pendingStudentId,
  onCancel,
  onManualStep,
  onConfirm,
}) {
  const [selectedClassByStudentId, setSelectedClassByStudentId] = useState({});
  const classesQuery = useQuery({
    queryKey: ["backfill-preview-classes"],
    queryFn: () => fetchAllPages(classesApi.list),
  });
  const allClasses = classesQuery.data?.data || [];
  const studentWord = entries.length === 1 ? "student" : "students";

  return (
    <CrudDialog
      title="This will also backfill earlier years"
      description={`${entries.length} of the selected ${studentWord} joined at a lower grade than this class. The gap years will land in placeholder classes since nobody knows which real class they were actually in. Pick one below if you already do.`}
      onClose={onCancel}
      panelClassName="max-w-3xl"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={Boolean(pendingStudentId)}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={Boolean(pendingStudentId)}
            onClick={onConfirm}
          >
            Enroll & Backfill
          </Button>
        </>
      }
    >
      <div className="max-h-72 overflow-y-auto rounded-lg border border-(--mws-line)">
        <table className="w-full text-left text-xs">
          <thead className="bg-(--mws-soft) font-semibold text-(--mws-muted)">
            <tr>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Backfilled Into</th>
              <th className="px-3 py-2">Real Class</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const [firstStep, ...laterSteps] = entry.steps;
              const candidates = classesQuery.isLoading
                ? []
                : candidateRealClasses(allClasses, firstStep);
              const selectedClassId =
                selectedClassByStudentId[entry.student_id] || "";
              const isPending = pendingStudentId === entry.student_id;
              return (
                <tr
                  key={entry.student_id}
                  className="border-t border-(--mws-line) align-top"
                >
                  <td className="px-3 py-2">{entry.full_name}</td>
                  <td className="px-3 py-2">
                    <p>
                      {firstStep.placeholder_class_id ? (
                        <Link
                          to={`/academic/classes/${firstStep.placeholder_class_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-(--mws-burgundy) hover:underline"
                        >
                          {firstStep.grade_name} ({firstStep.academic_year_name})
                        </Link>
                      ) : (
                        <span>
                          {firstStep.grade_name} ({firstStep.academic_year_name})
                          <span className="text-(--mws-muted)"> (new)</span>
                        </span>
                      )}
                    </p>
                    {laterSteps.length > 0 ? (
                      <p className="mt-1 text-(--mws-muted)">
                        Then{" "}
                        {laterSteps
                          .map(
                            (step) =>
                              `${step.grade_name} (${step.academic_year_name})`,
                          )
                          .join(", ")}{" "}
                        - Promote forward once the first year is real.
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {classesQuery.isLoading ? null : candidates.length === 0 ? (
                      <p className="text-(--mws-muted)">
                        None yet.{" "}
                        <Link
                          to={`/academic?tab=classes&academic_year_id=${firstStep.academic_year_id}&grade_id=${firstStep.grade_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-(--mws-burgundy) hover:underline"
                        >
                          View/create it
                        </Link>
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <SearchableSelect
                          value={selectedClassId}
                          onChange={(value) =>
                            setSelectedClassByStudentId((current) => ({
                              ...current,
                              [entry.student_id]: value,
                            }))
                          }
                          options={candidateClassOptions(candidates)}
                          placeholder="Pick a class"
                          searchPlaceholder="Search classes"
                          className="w-40 shrink-0"
                          buttonClassName="h-8 text-xs"
                          disabled={isPending}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!selectedClassId}
                          loading={isPending}
                          onClick={() =>
                            onManualStep(
                              entry,
                              firstStep,
                              candidates.find((k) => k.id === selectedClassId),
                            )
                          }
                          className="shrink-0 whitespace-nowrap"
                        >
                          Use this
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-(--mws-muted)">
        Left as a placeholder for now? Fix it later from that class's own
        page (Fix Class button) once the real one is known.
      </p>
    </CrudDialog>
  );
}

function computeEnrollmentErrors(
  values,
  { showClassField, showRetentionReason, showGraduationFields, showTargetGrade },
) {
  const errors = {};
  if (showClassField && !values.class_id) errors.class_id = "Class is required.";
  if (showTargetGrade && !values.promote_grade_id) {
    errors.promote_grade_id = "Grade is required.";
  }
  if (showRetentionReason && !values.retention_reason.trim()) {
    errors.retention_reason = "Retention reason is required.";
  }
  if (showGraduationFields && !values.graduation_grade.trim()) {
    errors.graduation_grade = "Graduation grade is required when status is Graduated.";
  }
  if (showGraduationFields && !values.leave_year.trim()) {
    errors.leave_year = "Leave year is required when status is Graduated.";
  }
  return errors;
}

function resolveCloseFloorStartDate(record, records) {
  if (record) return record.start_date;
  return (records || []).reduce(
    (latest, item) =>
      item?.start_date && (!latest || item.start_date > latest)
        ? item.start_date
        : latest,
    null,
  );
}

function resolveCloseAcademicYearId(record, records) {
  if (record) return record.academic_year?.id;
  if (!records || records.length === 0) return undefined;
  const firstYearId = records[0]?.academic_year?.id;
  return records.every((item) => item.academic_year?.id === firstYearId)
    ? firstYearId
    : undefined;
}

function computeCloseEndDateDefault(status, academicYear, enrollmentStartDate) {
  const today = dateInputFromIso(new Date().toISOString());
  if (status === "COMPLETED") {
    return dateInputFromIso(academicYear?.end_date) || today;
  }
  if (status === "TRANSFERRED" || status === "WITHDRAWN") {
    const startDate = dateInputFromIso(enrollmentStartDate);
    const yearStart = dateInputFromIso(academicYear?.start_date);
    const floor = startDate && startDate > yearStart ? startDate : yearStart;
    if (floor && today < floor) return floor;
    const yearEnd = dateInputFromIso(academicYear?.end_date);
    if (yearEnd && today > yearEnd) return yearEnd;
    return today;
  }
  return "";
}

function closeStatusOptions(values) {
  return values.map((value) => ({
    value,
    label: value === "COMPLETED" ? "Graduated" : formatStatus(value),
  }));
}

function specialEducationTeacherOptions(employees) {
  return employees.map((employee) => {
    const count = employee.active_student_count || 0;
    const type = employee.workforce_type || "EMPLOYEE";
    return {
      value: workforceTargetValue(type, employee.id),
      label: `${employee.identity.full_name}${type === "INTERN" ? " (Intern)" : ""}`,
      description: employee.identity.email,
      badge: `${count} student${count === 1 ? "" : "s"}`,
      tone: count > 0 ? "amber" : "green",
      searchText: `${employee.identity.full_name} ${type}`,
    };
  });
}

function dedupeStudents(students) {
  const byId = new Map();
  students.forEach((student) => {
    byId.set(student.id, student);
  });
  return Array.from(byId.values()).sort((left, right) =>
    left.identity.full_name.localeCompare(right.identity.full_name),
  );
}

function classSelectOptions(classes) {
  return classes.map((klass) => {
    const capacity = getClassCapacityLabel(klass);
    const isUpcoming = klass.status === "UPCOMING";
    return {
      value: klass.id,
      label: klass.name,
      description: [
        klass.grade?.name,
        klass.academic_year?.name,
        isUpcoming ? "Upcoming" : null,
        capacity.description,
      ]
        .filter(Boolean)
        .join(" / "),
      badge: capacity.badge ?? (isUpcoming ? "Upcoming" : null),
      tone: capacity.badge ? capacity.tone : isUpcoming ? "amber" : capacity.tone,
      searchText: `${klass.name} ${klass.grade?.name || ""} ${klass.academic_year?.name || ""} ${capacity.description}`,
    };
  });
}

function getClassCapacityLabel(klass) {
  if (klass.capacity === null || klass.capacity === undefined) {
    return { description: "No capacity limit", badge: null, tone: "neutral" };
  }

  const activeCount = klass.active_enrollment_count ?? 0;
  const remaining = Math.max(klass.capacity - activeCount, 0);
  if (remaining === 0) {
    return {
      description: `${activeCount}/${klass.capacity} students`,
      badge: "Full",
      tone: "red",
    };
  }

  return {
    description: `${activeCount}/${klass.capacity} students, ${remaining} seats left`,
    badge: `${remaining} seats`,
    tone: remaining <= 3 ? "amber" : "green",
  };
}

function academicYearRangeHint(academicYear) {
  if (!academicYear?.start_date || !academicYear?.end_date) return undefined;
  return `Must fall within ${academicYear.name}: ${formatDate(academicYear.start_date)} - ${formatDate(academicYear.end_date)}`;
}

function getEnrollmentDialogTitle(mode) {
  switch (mode) {
    case "create":
      return "New Enrollment";
    case "transfer":
      return "Move to Another Class";
    case "promote":
      return "Promote Student";
    case "bulk-promote":
      return "Promote Selected Students";
    case "bulk-transfer":
      return "Move Selected Students";
    case "close":
      return "Close Enrollment";
    case "bulk-close":
      return "Close Selected Enrollments";
    default:
      return "Enrollment";
  }
}

function enrollmentStatusTone(status) {
  switch (status) {
    case "ACTIVE":
      return "green";
    case "COMPLETED":
      return "neutral";
    case "TRANSFERRED":
      return "amber";
    case "WITHDRAWN":
      return "red";
    default:
      return statusTone(status);
  }
}
