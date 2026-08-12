import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import {
  Field,
  SearchableSelect,
  SelectInput,
  TextInput,
} from "../../../components/ui/FormControls.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import {
  cleanPayload,
  optionalNumber,
  trimmedOrUndefined,
} from "../../../lib/form.js";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { employeesApi } from "../../employees/api/employeesApi.js";
import { jobLevelsApi } from "../../master-data/api/masterDataApi.js";
import { HeaderCell } from "../../master-data/components/HeaderCell.jsx";
import { LoadingRows } from "../../master-data/components/LoadingRows.jsx";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { RowActions } from "../../master-data/components/RowActions.jsx";
import { SearchBox } from "../../master-data/components/SearchBox.jsx";
import { defaultPaging } from "../../master-data/utils/params.js";
import {
  academicYearsApi,
  classesApi,
  classStatuses,
  classTeacherRoles,
  gradesApi,
} from "../api/academicApi.js";
import {
  academicYearSelectOptions,
  employeeSelectOptions,
  gradeSelectOptions,
} from "../utils/selectOptions.js";
import { SelectFilter } from "./SelectFilter.jsx";

export function ClassesPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    grade_id: "",
    academic_year_id: "",
    status: "",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);

  const classesQuery = useQuery({
    queryKey: ["classes", params],
    queryFn: () => classesApi.list(params),
  });
  const optionsQuery = useClassOptionsQuery();
  const teacherAssignmentsQuery = useQuery({
    queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
    queryFn: () => classesApi.teacherAssignments(dialog.record.id),
    enabled: Boolean(dialog?.record?.id),
  });

  const assignTeacherMutation = useMutation({
    mutationFn: ({ classId, payload }) =>
      classesApi.assignTeacher(classId, payload),
    onSuccess: () => {
      invalidateClassData(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
      });
    },
  });

  const endTeacherAssignmentMutation = useMutation({
    mutationFn: ({ classId, assignmentId }) =>
      classesApi.endTeacherAssignment(classId, assignmentId),
    onSuccess: () => {
      invalidateClassData(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["classes", dialog?.record?.id, "teacher-assignments"],
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: (created) => {
      invalidateClassData(queryClient);
      setDialog({ mode: "edit", record: created });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => classesApi.update(id, payload),
    onSuccess: () => {
      invalidateClassData(queryClient);
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  });

  const canWrite = user?.role === "SUPER_ADMIN";
  const paging = classesQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  function handleDelete(klass) {
    if (window.confirm(`Delete class "${klass.name}"?`)) {
      deleteMutation.mutate(klass.id);
    }
  }

  return (
    <PanelFrame
      title="Classes"
      icon={BookOpen}
      isFetching={classesQuery.isFetching || optionsQuery.isFetching}
      action={
        <Button
          type="button"
          disabled={!canWrite || optionsQuery.isLoading}
          onClick={() => setDialog({ mode: "create" })}
        >
          <Plus size={16} />
          New Class
        </Button>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search classes"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SelectFilter
            value={params.academic_year_id}
            onChange={(value) =>
              resetPageAndUpdate({ academic_year_id: value })
            }
            options={[
              { value: "", label: "All years" },
              ...academicYearSelectOptions(
                optionsQuery.data?.academicYears || [],
              ),
            ]}
            placeholder="All years"
          />
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: "", label: "All grades" },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
            placeholder="All grades"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
          >
            <option value="">All statuses</option>
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectFilter>
        </>
      }
      error={classesQuery.error || optionsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Grade"
              column="grade_level"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Academic Year</th>
            <th className="px-4 py-3">Homeroom</th>
            <HeaderCell
              label="Status"
              column="status"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Capacity</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={classesQuery.isLoading}
            isEmpty={(classesQuery.data?.data || []).length === 0}
            colSpan={7}
            label="classes"
          />
          {!classesQuery.isLoading
            ? (classesQuery.data?.data || []).map((klass) => (
                <tr
                  key={klass.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {klass.name}
                  </td>
                  <td className="px-4 py-3">{klass.grade.name}</td>
                  <td className="px-4 py-3">{klass.academic_year.name}</td>
                  <td className="px-4 py-3">
                    {klass.homeroom_teachers?.length
                      ? klass.homeroom_teachers
                          .map((teacher) => teacher.employee.full_name)
                          .join(", ")
                      : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(klass.status)}>
                      {formatStatus(klass.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    {klass.capacity ? (
                      <div>
                        <p className="font-semibold text-[var(--mws-charcoal)]">
                          {klass.active_enrollment_count ?? 0}/{klass.capacity}{" "}
                          students
                        </p>
                        <p className="text-xs text-[var(--mws-muted)]">
                          {Math.max(
                            klass.capacity -
                              (klass.active_enrollment_count ?? 0),
                            0,
                          )}{" "}
                          seats left
                        </p>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: "edit", record: klass })}
                      onDelete={() => handleDelete(klass)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="classes"
        isLoading={classesQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <ClassDialog
          dialog={dialog}
          options={optionsQuery.data}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => {
            if (dialog.mode === "create") createMutation.mutate(payload);
            else updateMutation.mutate({ id: dialog.record.id, payload });
          }}
          assignments={teacherAssignmentsQuery.data || []}
          isLoadingAssignments={teacherAssignmentsQuery.isLoading}
          assignmentsError={teacherAssignmentsQuery.error}
          teachingEmployees={optionsQuery.data?.teachingEmployees || []}
          canWrite={canWrite}
          isAssigning={assignTeacherMutation.isPending}
          isEnding={endTeacherAssignmentMutation.isPending}
          onAssign={(payload) =>
            assignTeacherMutation.mutate({ classId: dialog.record.id, payload })
          }
          onEnd={(assignmentId) =>
            endTeacherAssignmentMutation.mutate({
              classId: dialog.record.id,
              assignmentId,
            })
          }
        />
      ) : null}
    </PanelFrame>
  );
}

function ClassDialog({
  dialog,
  options,
  isSubmitting,
  onClose,
  onSubmit,
  assignments,
  isLoadingAssignments,
  assignmentsError,
  teachingEmployees,
  canWrite,
  isAssigning,
  isEnding,
  onAssign,
  onEnd,
}) {
  const record = dialog.record;
  const [values, setValues] = useState(() => ({
    name: record?.name || "",
    grade_id: record?.grade?.id || "",
    academic_year_id: record?.academic_year?.id || "",
    status: record?.status || "ACTIVE",
    capacity: record?.capacity ?? "",
  }));

  function submit(event) {
    event.preventDefault();
    onSubmit(
      cleanPayload({
        name: trimmedOrUndefined(values.name),
        grade_id: values.grade_id,
        academic_year_id: values.academic_year_id,
        status: values.status,
        capacity:
          values.capacity === "__clear__"
            ? null
            : optionalNumber(values.capacity),
      }),
    );
  }

  return (
    <CrudDialog
      title={dialog.mode === "create" ? "New Class" : "Edit Class"}
      description="Save the class, then manage its teachers below."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {record?.id ? "Close" : "Cancel"}
          </Button>
          <Button form="class-form" type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label="Name" className="md:col-span-2">
          <TextInput
            required
            value={values.name}
            onChange={(event) =>
              setValues({ ...values, name: event.target.value })
            }
          />
        </Field>
        <Field label="Grade">
          <SearchableSelect
            required
            value={values.grade_id}
            onChange={(value) => setValues({ ...values, grade_id: value })}
            options={gradeSelectOptions(options?.grades || [])}
            placeholder="Select grade"
            searchPlaceholder="Search grades"
          />
        </Field>
        <Field label="Academic year">
          <SearchableSelect
            required
            value={values.academic_year_id}
            onChange={(value) =>
              setValues({ ...values, academic_year_id: value })
            }
            options={academicYearSelectOptions(options?.academicYears || [])}
            placeholder="Select year"
            searchPlaceholder="Search years"
          />
        </Field>
        <Field label="Status">
          <SelectInput
            value={values.status}
            onChange={(event) =>
              setValues({ ...values, status: event.target.value })
            }
          >
            {classStatuses.map((status) => (
              <option key={status} value={status}>
                {formatStatus(status)}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Capacity">
          <TextInput
            type="number"
            min="1"
            value={values.capacity}
            onChange={(event) =>
              setValues({ ...values, capacity: event.target.value })
            }
          />
        </Field>
      </form>

      {record?.id ? (
        <TeacherAssignmentsSection
          assignments={assignments}
          isLoading={isLoadingAssignments}
          error={assignmentsError}
          teachingEmployees={teachingEmployees}
          canWrite={canWrite}
          isAssigning={isAssigning}
          isEnding={isEnding}
          onAssign={onAssign}
          onEnd={onEnd}
        />
      ) : (
        <p className="mt-6 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          Save the class first to add homeroom, supporting, or subject teachers.
        </p>
      )}
    </CrudDialog>
  );
}

function TeacherAssignmentsSection({
  assignments,
  isLoading,
  error,
  teachingEmployees,
  canWrite,
  isAssigning,
  isEnding,
  onAssign,
  onEnd,
}) {
  const [form, setForm] = useState({
    employee_id: "",
    role: "HOMEROOM",
    subject: "",
  });

  const nonSubjectTeachingPositions = new Set([
    "homeroom teacher",
    "special education teacher",
  ]);
  const assignableEmployees =
    form.role === "SUBJECT_TEACHER"
      ? teachingEmployees.filter(
          (employee) =>
            !nonSubjectTeachingPositions.has(
              employee.employment.job_position?.trim().toLowerCase(),
            ),
        )
      : teachingEmployees;

  function submitAssign(event) {
    event.preventDefault();
    if (!form.employee_id) return;
    onAssign({
      employee_id: form.employee_id,
      role: form.role,
      subject:
        form.role === "SUBJECT_TEACHER" ? form.subject || undefined : undefined,
    });
    setForm({ employee_id: "", role: form.role, subject: "" });
  }

  return (
    <div className="mt-6 border-t border-[var(--mws-line)] pt-6">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-[var(--mws-charcoal)]">
        <Users size={16} />
        Teachers
      </h3>

      {isLoading ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          Loading teacher assignments...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#f2c8cb] bg-[#fff6f7] px-4 py-3 text-sm font-semibold text-[#9f3d41]">
          Teacher assignments are unavailable.
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] px-4 py-8 text-center text-sm text-[var(--mws-muted)]">
          No teacher assigned to this class yet.
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-xl border border-[var(--mws-line)]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
              <tr>
                <th className="px-4 py-3">Teacher</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => (
                <tr
                  key={assignment.id}
                  className="border-t border-[var(--mws-line)]"
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--mws-charcoal)]">
                      {assignment.employee.full_name}
                    </p>
                    <p className="font-mono text-xs text-[var(--mws-muted)]">
                      {assignment.employee.employee_id}
                    </p>
                  </td>
                  <td className="px-4 py-3">{formatStatus(assignment.role)}</td>
                  <td className="px-4 py-3">{assignment.subject || "-"}</td>
                  <td className="px-4 py-3">
                    {formatDate(assignment.start_date)}
                  </td>
                  <td className="px-4 py-3">
                    {assignment.end_date
                      ? formatDate(assignment.end_date)
                      : "Current"}
                  </td>
                  <td className="px-4 py-3">
                    {canWrite && !assignment.end_date ? (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isEnding}
                        onClick={() => onEnd(assignment.id)}
                      >
                        End
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canWrite ? (
        <>
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setForm({ employee_id: "", role: "HOMEROOM", subject: "" })
              }
            >
              <Plus size={16} />
              Add homeroom teacher
            </Button>
          </div>
          <form
            onSubmit={submitAssign}
            className="mt-3 grid gap-3 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4 md:grid-cols-3"
          >
            <Field label="Teacher" className="md:col-span-1">
              <SearchableSelect
                value={form.employee_id}
                onChange={(value) => setForm({ ...form, employee_id: value })}
                options={employeeSelectOptions(assignableEmployees)}
                placeholder="Select teacher"
                searchPlaceholder="Search teachers"
              />
            </Field>
            <Field label="Role">
              <SelectInput
                value={form.role}
                onChange={(event) =>
                  setForm({
                    ...form,
                    role: event.target.value,
                    employee_id: "",
                  })
                }
              >
                {classTeacherRoles.map((role) => (
                  <option key={role} value={role}>
                    {formatStatus(role)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {form.role === "SUBJECT_TEACHER" ? (
              <Field label="Subject">
                <TextInput
                  placeholder="e.g. Visual Arts"
                  value={form.subject}
                  onChange={(event) =>
                    setForm({ ...form, subject: event.target.value })
                  }
                />
              </Field>
            ) : null}
            <div className="md:col-span-3">
              <Button type="submit" disabled={isAssigning || !form.employee_id}>
                <Plus size={16} />
                Add assignment
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}

function useClassOptionsQuery() {
  return useQuery({
    queryKey: ["class-form-options"],
    queryFn: async () => {
      const [grades, academicYears, employees, jobLevels] = await Promise.all([
        gradesApi.list({
          page: 1,
          size: 100,
          sort_by: "level",
          sort_order: "asc",
        }),
        academicYearsApi.list({
          page: 1,
          size: 100,
          sort_by: "start_date",
          sort_order: "desc",
        }),
        employeesApi.list({ page: 1, size: 100, status: "ACTIVE" }),
        jobLevelsApi.list({
          page: 1,
          size: 100,
          sort_by: "name",
          sort_order: "asc",
        }),
      ]);
      const teachingLevelNames = new Set(
        (jobLevels.data || [])
          .filter((level) => level.is_teaching_role)
          .map((level) => level.name),
      );
      const activeEmployees = employees.data || [];

      return {
        grades: grades.data || [],
        academicYears: academicYears.data || [],
        employees: activeEmployees,
        teachingEmployees: activeEmployees.filter((employee) =>
          teachingLevelNames.has(employee.employment.job_level),
        ),
      };
    },
  });
}

function invalidateClassData(queryClient) {
  queryClient.invalidateQueries({ queryKey: ["classes"] });
  queryClient.invalidateQueries({ queryKey: ["class-form-options"] });
  queryClient.invalidateQueries({ queryKey: ["student-form-options"] });
  queryClient.invalidateQueries({ queryKey: ["enrollment-form-options"] });
}
