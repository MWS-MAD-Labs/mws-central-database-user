import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { Field, SearchableSelect } from "../../../components/ui/FormControls.jsx";
import { classesApi } from "../api/academicApi.js";
import { classSelectOptions } from "../utils/selectOptions.js";

// Mirrors UNKNOWN_LEGACY_CLASS_PREFIX in server/src/service/enrollment-service.ts.
const UNKNOWN_LEGACY_CLASS_PREFIX = "Unknown (Legacy Import)";

function classAllowedGrades(klass) {
  if (!klass) return [];
  return [klass.grade, ...(klass.additional_grades || [])].filter(Boolean);
}

// Corrects a single placeholder-class enrollment in place, once the real
// class is known - any status, any position in the promote/backfill chain,
// no effect on anything else in the student's history. See
// EnrollmentService.fixPlaceholderClass.
export function FixPlaceholderClassDialog({
  enrollment,
  onClose,
  onSubmit,
  isSubmitting,
}) {
  const [classId, setClassId] = useState("");

  // No status filter - a real historical class is almost always INACTIVE by
  // now (cascade-deactivated with its academic year), and that's exactly
  // the kind of class this dialog needs to offer.
  const classesQuery = useQuery({
    queryKey: ["fix-placeholder-classes"],
    queryFn: () => classesApi.list({ page: 1, size: 100 }),
  });

  const candidateClasses = (classesQuery.data?.data || []).filter((klass) => {
    if (klass.name.startsWith(UNKNOWN_LEGACY_CLASS_PREFIX)) return false;
    if (klass.academic_year?.id !== enrollment.academic_year?.id) return false;
    return classAllowedGrades(klass).some(
      (grade) => grade.name === enrollment.grade_level,
    );
  });

  function handleSubmit(event) {
    event.preventDefault();
    if (!classId) return;
    onSubmit({ class_id: classId });
  }

  return (
    <CrudDialog
      title="Fix Placeholder Class"
      description={`Point "${enrollment.class.name}" at the real class, now that it's known. Only this record changes. Nothing else in ${enrollment.student.full_name}'s history is touched.`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="fix-placeholder-class-form"
            disabled={!classId || isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </>
      }
    >
      <form
        id="fix-placeholder-class-form"
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-4"
      >
        <Field label="Student">
          <p className="text-sm font-semibold text-[var(--mws-charcoal)]">
            {enrollment.student.full_name}
          </p>
        </Field>
        <Field label="Academic Year">
          <p className="text-sm text-[var(--mws-charcoal)]">
            {enrollment.academic_year.name}
          </p>
        </Field>
        <Field label="Grade">
          <p className="text-sm text-[var(--mws-charcoal)]">
            {enrollment.grade_level}
          </p>
        </Field>
        <Field
          label="Real Class"
          hint={
            classesQuery.isLoading
              ? undefined
              : candidateClasses.length === 0
                ? "No matching class found for this academic year and grade yet. Create the class first, then come back here."
                : "Only showing classes in the same academic year and grade as this record."
          }
        >
          <SearchableSelect
            required
            value={classId}
            onChange={setClassId}
            options={classSelectOptions(candidateClasses)}
            placeholder="Select Class"
            searchPlaceholder="Search Classes"
          />
        </Field>
      </form>
    </CrudDialog>
  );
}
