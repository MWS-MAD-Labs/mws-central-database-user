import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatStatus, statusTone } from "../../../lib/format.js";
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
            options={[
              { value: "", label: "All statuses" },
              ...classStatuses.map((status) => ({
                value: status,
                label: formatStatus(status),
              })),
            ]}
            placeholder="All statuses"
          />
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
                    {klass.homeroom_teachers?.length ||
                    klass.supporting_homeroom_teachers?.length ? (
                      <div className="space-y-0.5">
                        {klass.homeroom_teachers.map((teacher) => (
                          <p key={teacher.id}>{teacher.employee.full_name}</p>
                        ))}
                        {klass.supporting_homeroom_teachers.map((teacher) => (
                          <p
                            key={teacher.id}
                            className="text-xs text-[var(--mws-muted)]"
                          >
                            {teacher.employee.full_name} (Supporting)
                          </p>
                        ))}
                      </div>
                    ) : (
                      "-"
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
                      disableDelete={!canDelete}
                      onView={() => navigate(`/academic/classes/${klass.id}`)}
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
          isSubmitting={createMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(payload) => createMutation.mutate(payload)}
          user={user}
        />
      ) : null}
    </PanelFrame>
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
