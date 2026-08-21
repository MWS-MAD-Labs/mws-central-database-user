import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import {
  formatEnrollmentHistoryCounts,
  formatStatus,
  statusTone,
  sumEnrollmentHistoryCounts,
} from "../../../lib/format.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
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
  gradesApi,
} from "../api/academicApi.js";
import {
  academicYearSelectOptions,
  gradeSelectOptions,
} from "../utils/selectOptions.js";
import { ClassDialog } from "./ClassDialog.jsx";
import { SelectFilter } from "./SelectFilter.jsx";

export function ClassesPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    grade_id: "",
    academic_year_id: "",
    // ACTIVE by default - most classes an admin looks up day to day are
    // this year's live ones, not every UPCOMING/INACTIVE class ever
    // created. "All Statuses" is still one click away in the filter.
    status: "ACTIVE",
    sort_by: "created_at",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);

  const classesQuery = useQuery({
    queryKey: ["classes", params],
    queryFn: () => classesApi.list(params),
  });
  const optionsQuery = useClassOptionsQuery();

  // Teacher assignment and enrollment live on the class's own detail page -
  // this dialog only ever creates a class, then navigates there.
  const createMutation = useMutation({
    mutationFn: classesApi.create,
    onSuccess: (created) => {
      invalidateClassData(queryClient);
      setDialog(null);
      navigate(`/academic/classes/${created.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  });

  const canWrite =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && user?.can_write_data);
  const canDelete = user?.role === "SUPER_ADMIN";
  const paging = classesQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  async function handleDelete(klass) {
    if (
      await confirm({
        title: "Delete class",
        description: `"${klass.name}" will be deleted.`,
        confirmLabel: "Delete",
        tone: "danger",
      })
    ) {
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
            placeholder="Search Classes"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SelectFilter
            value={params.academic_year_id}
            onChange={(value) =>
              resetPageAndUpdate({ academic_year_id: value })
            }
            options={[
              { value: "", label: "All Years" },
              ...academicYearSelectOptions(
                optionsQuery.data?.academicYears || [],
              ),
            ]}
            placeholder="All Years"
          />
          <SelectFilter
            value={params.grade_id}
            onChange={(value) => resetPageAndUpdate({ grade_id: value })}
            options={[
              { value: "", label: "All Grades" },
              ...gradeSelectOptions(optionsQuery.data?.grades || []),
            ]}
            placeholder="All Grades"
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All Statuses" },
              ...classStatuses.map((status) => ({
                value: status,
                label: formatStatus(status),
              })),
            ]}
            placeholder="All Statuses"
          />
        </>
      }
      error={classesQuery.error || optionsQuery.error || deleteMutation.error}
    >
      {/* Below md: one card per class instead of a table row - scrolling a
      7-column table sideways on a phone isn't usable. md and up keeps the
      table, same data either way. */}
      <div className="space-y-3 md:hidden">
        {classesQuery.isLoading ? (
          <p className="px-1 py-6 text-center text-sm text-[var(--mws-muted)]">
            Loading classes...
          </p>
        ) : (classesQuery.data?.data || []).length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-[var(--mws-muted)]">
            No classes are ready to review.
          </p>
        ) : (
          (classesQuery.data?.data || []).map((klass) => (
            <ClassCard
              key={klass.id}
              klass={klass}
              canDelete={canDelete && !klass.has_dependents}
              deleteTitle={
                klass.has_dependents
                  ? "This class still has students, enrollments, or teacher assignments. Reassign or remove those first."
                  : undefined
              }
              onView={() => navigate(`/academic/classes/${klass.id}`)}
              onDelete={() => handleDelete(klass)}
            />
          ))
        )}
      </div>

      <table className="hidden w-full min-w-[920px] text-left text-sm md:table">
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
            <th className="px-4 py-3">Teachers</th>
            <HeaderCell
              label="Status"
              column="status"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3">Students</th>
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
            ? (classesQuery.data?.data || []).map((klass) => {
                const historyLabel = formatEnrollmentHistoryCounts(
                  klass.enrollment_history_counts,
                );
                return (
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
                      {/* All three roles get the same treatment - a count
                      badge, clickable straight to the employee's profile
                      when it's just one person, tooltip with names
                      otherwise. No role is singled out for full-name
                      treatment over the others, and the cell stays one
                      wrapped row regardless of how many are assigned. */}
                      {klass.homeroom_teachers?.length ||
                      klass.supporting_homeroom_teachers?.length ||
                      klass.subject_teachers?.length ? (
                        <div className="flex flex-wrap gap-1">
                          <TeacherRoleBadge
                            label="Homeroom"
                            teachers={klass.homeroom_teachers}
                            formatTooltip={(teacher) =>
                              teacher.employee.full_name
                            }
                          />
                          <TeacherRoleBadge
                            label="Supporting"
                            teachers={klass.supporting_homeroom_teachers}
                            formatTooltip={(teacher) =>
                              teacher.employee.full_name
                            }
                          />
                          <TeacherRoleBadge
                            label="Subject"
                            teachers={klass.subject_teachers}
                            formatTooltip={(teacher) =>
                              `${teacher.employee.full_name}${teacher.subject ? ` (${teacher.subject})` : ""}`
                            }
                          />
                        </div>
                      ) : (
                        <span className="text-[var(--mws-muted)]">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={statusTone(klass.status)}>
                        {formatStatus(klass.status)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--mws-charcoal)]">
                        {klass.active_enrollment_count ?? 0}
                        {klass.capacity ? `/${klass.capacity}` : ""} students
                        {historyLabel ? (
                          <span
                            className="ml-1 cursor-pointer text-xs font-normal text-[var(--mws-muted)] underline decoration-dotted underline-offset-2"
                            title={historyLabel}
                          >
                            (+
                            {sumEnrollmentHistoryCounts(
                              klass.enrollment_history_counts,
                            )}
                            )
                          </span>
                        ) : null}
                      </p>
                      {klass.capacity ? (
                        <p className="text-xs text-[var(--mws-muted)]">
                          {Math.max(
                            klass.capacity -
                              (klass.active_enrollment_count ?? 0),
                            0,
                          )}{" "}
                          seats left
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions
                        disableDelete={!canDelete || klass.has_dependents}
                        deleteTitle={
                          klass.has_dependents
                            ? "This class still has students, enrollments, or teacher assignments. Reassign or remove those first."
                            : undefined
                        }
                        onView={() => navigate(`/academic/classes/${klass.id}`)}
                        onDelete={() => handleDelete(klass)}
                      />
                    </td>
                  </tr>
                );
              })
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
          isSubmitting={createMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => createMutation.mutate(payload)}
          user={user}
        />
      ) : null}
    </PanelFrame>
  );
}

// Same rendering for Homeroom/Supporting/Subject - a single count badge,
// no role gets full names inline while the others don't. Links straight to
// the employee when there's exactly one (a single click destination makes
// sense there); otherwise it's a tooltip listing everyone.
function TeacherRoleBadge({ label, teachers, formatTooltip }) {
  if (!teachers?.length) return null;

  const content = `${teachers.length} ${label}`;
  const tooltip = teachers.map(formatTooltip).join(", ");

  if (teachers.length === 1) {
    return (
      <Link to={`/employees/${teachers[0].employee.id}`} title={tooltip}>
        <StatusBadge tone="neutral" className="hover:underline">
          {content}
        </StatusBadge>
      </Link>
    );
  }

  return (
    <StatusBadge tone="neutral" title={tooltip}>
      {content}
    </StatusBadge>
  );
}

// Mobile (<md) stand-in for one <tr> of the classes table - same fields,
// stacked instead of columned since there's no room to scroll sideways
// comfortably on a phone.
function ClassCard({ klass, canDelete, deleteTitle, onView, onDelete }) {
  const historyLabel = formatEnrollmentHistoryCounts(
    klass.enrollment_history_counts,
  );
  const hasTeachers =
    klass.homeroom_teachers?.length ||
    klass.supporting_homeroom_teachers?.length ||
    klass.subject_teachers?.length;

  return (
    <div className="rounded-xl border border-[var(--mws-line)] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display font-bold text-[var(--mws-charcoal)]">
            {klass.name}
          </p>
          <p className="text-xs text-[var(--mws-muted)]">
            {klass.grade.name} · {klass.academic_year.name}
          </p>
        </div>
        <StatusBadge tone={statusTone(klass.status)} className="shrink-0">
          {formatStatus(klass.status)}
        </StatusBadge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {hasTeachers ? (
          <>
            <TeacherRoleBadge
              label="Homeroom"
              teachers={klass.homeroom_teachers}
              formatTooltip={(teacher) => teacher.employee.full_name}
            />
            <TeacherRoleBadge
              label="Supporting"
              teachers={klass.supporting_homeroom_teachers}
              formatTooltip={(teacher) => teacher.employee.full_name}
            />
            <TeacherRoleBadge
              label="Subject"
              teachers={klass.subject_teachers}
              formatTooltip={(teacher) =>
                `${teacher.employee.full_name}${teacher.subject ? ` (${teacher.subject})` : ""}`
              }
            />
          </>
        ) : (
          <span className="text-sm text-[var(--mws-muted)]">
            No teachers assigned
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--mws-line)] pt-3">
        <div>
          <p className="text-sm font-semibold text-[var(--mws-charcoal)]">
            {klass.active_enrollment_count ?? 0}
            {klass.capacity ? `/${klass.capacity}` : ""} students
            {historyLabel ? (
              <span
                className="ml-1 text-xs font-normal text-[var(--mws-muted)] underline decoration-dotted underline-offset-2"
                title={historyLabel}
              >
                (+{sumEnrollmentHistoryCounts(klass.enrollment_history_counts)})
              </span>
            ) : null}
          </p>
          {klass.capacity ? (
            <p className="text-xs text-[var(--mws-muted)]">
              {Math.max(
                klass.capacity - (klass.active_enrollment_count ?? 0),
                0,
              )}{" "}
              seats left
            </p>
          ) : null}
        </div>
        <RowActions
          disableDelete={!canDelete}
          deleteTitle={deleteTitle}
          onView={onView}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function useClassOptionsQuery() {
  return useQuery({
    queryKey: ["class-form-options"],
    queryFn: async () => {
      const [grades, academicYears] = await Promise.all([
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
      ]);

      return {
        grades: grades.data || [],
        academicYears: academicYears.data || [],
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
