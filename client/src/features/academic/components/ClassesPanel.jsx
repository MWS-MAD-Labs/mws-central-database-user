import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
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
import { ClassTeachers } from "./ClassTeachers.jsx";
import { classGradeNames } from "../utils/classTeachers.js";
import { NameList } from "../../../components/ui/NameList.jsx";
import { SelectFilter } from "./SelectFilter.jsx";
import { FilterResetButton } from "../../../components/ui/FilterResetButton.jsx";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";

export function ClassesPanel() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [searchParams] = useSearchParams();
  const [params, setParams] = useState(() => {
    const gradeId = searchParams.get("grade_id") || "";
    const academicYearId = searchParams.get("academic_year_id") || "";
    return {
      page: 1,
      size: 10,
      search: "",
      grade_id: gradeId,
      academic_year_id: academicYearId,
      status: gradeId || academicYearId ? "" : "ACTIVE",
      sort_by: "created_at",
      sort_order: "desc",
    };
  });
  const [dialog, setDialog] = useState(null);

  const classesQuery = useQuery({
    queryKey: ["classes", params],
    queryFn: () => classesApi.list(params),
  });
  const optionsQuery = useClassOptionsQuery();

  const createMutation = useMutation({
    meta: { successMessage: "Class created." },
    mutationFn: classesApi.create,
    onSuccess: (created) => {
      invalidateClassData(queryClient);
      setDialog(null);
      navigate(`/academic/classes/${created.id}`);
    },
  });

  const deleteMutation = useMutation({
    meta: { successMessage: "Class deleted." },
    mutationFn: classesApi.remove,
    onSuccess: () => invalidateClassData(queryClient),
  });

  const canWrite =
    user?.role === "SUPER_ADMIN" ||
    (user?.role === "DATABASE_ADMIN" && user?.can_write_student_data);
  const canDelete = user?.role === "SUPER_ADMIN";
  const paging = classesQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }
  const hasActiveFilters = Boolean(
    params.search ||
      params.grade_id ||
      params.academic_year_id ||
      params.status !== "ACTIVE",
  );

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
          <FilterResetButton
            visible={hasActiveFilters}
            onReset={() =>
              updateParams({
                page: 1,
                search: "",
                grade_id: "",
                academic_year_id: "",
                status: "ACTIVE",
              })
            }
          />
        </>
      }
      error={classesQuery.error || optionsQuery.error || deleteMutation.error}
    >
      <div className="space-y-3 md:hidden">
        {classesQuery.isLoading ? (
          <p className="px-1 py-6 text-center text-sm text-(--mws-muted)">
            Loading classes...
          </p>
        ) : (classesQuery.data?.data || []).length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-(--mws-muted)">
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
        <thead className="bg-(--mws-soft) font-display text-xs font-bold text-(--mws-muted)">
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
                return (
                  <tr
                    key={klass.id}
                    className="border-t border-(--mws-line) bg-white hover:bg-(--mws-soft)"
                  >
                    <td className="px-4 py-3 font-semibold text-(--mws-charcoal)">
                      {klass.name}
                    </td>
                    <td className="px-4 py-3">
                      <NameList names={classGradeNames(klass)} noun="Grades" title={`Grades of ${klass.name}`} />
                    </td>
                    <td className="px-4 py-3">{klass.academic_year.name}</td>
                    <td className="px-4 py-3">
                      <ClassTeachers klass={klass} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={statusTone(klass.status)}>
                        {formatStatus(klass.status)}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-(--mws-charcoal)">
                        {klass.active_enrollment_count ?? 0}
                        {klass.capacity ? `/${klass.capacity}` : ""} Students
                        <PastEnrollments klass={klass} />
                      </p>
                      {klass.capacity ? (
                        <p className="text-xs text-(--mws-muted)">
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

// People who were in the class and moved on, as a count that opens how they left.
function PastEnrollments({ klass }) {
  const label = formatEnrollmentHistoryCounts(klass.enrollment_history_counts);
  if (!label) return null;
  return (
    <span className="ml-1.5 align-middle">
      <ListPopover
        label={`+${sumEnrollmentHistoryCounts(klass.enrollment_history_counts)} Past`}
        count={sumEnrollmentHistoryCounts(klass.enrollment_history_counts)}
        dialogLabel={`Past enrollments of ${klass.name}`}
        icon={false}
        mono={false}
        groups={[{ title: "Left The Class", items: label.split(" · "), hideCount: true }]}
      />
    </span>
  );
}

function ClassCard({ klass, canDelete, deleteTitle, onView, onDelete }) {
  return (
    <div className="rounded-xl border border-(--mws-line) bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display font-bold text-(--mws-charcoal)">
            {klass.name}
          </p>
          <p className="text-xs text-(--mws-muted)">
            {classGradeNames(klass).join(" + ")} · {klass.academic_year.name}
          </p>
        </div>
        <StatusBadge tone={statusTone(klass.status)} className="shrink-0">
          {formatStatus(klass.status)}
        </StatusBadge>
      </div>

      <div className="mt-3">
        <ClassTeachers klass={klass} empty="No teachers assigned" />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-(--mws-line) pt-3">
        <div>
          <p className="text-sm font-semibold text-(--mws-charcoal)">
            {klass.active_enrollment_count ?? 0}
            {klass.capacity ? `/${klass.capacity}` : ""} Students
            <PastEnrollments klass={klass} />
          </p>
          {klass.capacity ? (
            <p className="text-xs text-(--mws-muted)">
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
  queryClient.invalidateQueries({ queryKey: ["class-detail-options"] });
}
