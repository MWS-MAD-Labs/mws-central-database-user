import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Layers, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { PaginationBar } from "../../../components/ui/PaginationBar.jsx";
import { StatusBadge } from "../../../components/ui/StatusBadge.jsx";
import { formatDate, formatStatus, statusTone } from "../../../lib/format.js";
import { showBulkFailureToast, showSuccessToast } from "../../../lib/toast.js";
import { useAuth } from "../../auth/hooks/useAuth.js";
import { HeaderCell } from "../../master-data/components/HeaderCell.jsx";
import { LoadingRows } from "../../master-data/components/LoadingRows.jsx";
import { PanelFrame } from "../../master-data/components/PanelFrame.jsx";
import { RowActions } from "../../master-data/components/RowActions.jsx";
import { SearchBox } from "../../master-data/components/SearchBox.jsx";
import { defaultPaging } from "../../master-data/utils/params.js";
import { academicYearStatuses, academicYearsApi } from "../api/academicApi.js";
import { AcademicYearBulkCreateDialog } from "./AcademicYearBulkCreateDialog.jsx";
import { AcademicYearDialog } from "./AcademicYearDialog.jsx";
import { SelectFilter } from "./SelectFilter.jsx";
import { nextAcademicYearStartYear } from "../utils/Format.js";

export function AcademicYearsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [params, setParams] = useState({
    page: 1,
    size: 10,
    search: "",
    status: "",
    sort_by: "start_date",
    sort_order: "desc",
  });
  const [dialog, setDialog] = useState(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);

  const yearsQuery = useQuery({
    queryKey: ["academic-years", params],
    queryFn: () => academicYearsApi.list(params),
  });

  // Separate from the paginated table query above - this just needs every
  // year's name to compute the "next year" suggestion, regardless of what
  // page/sort the table is currently showing.
  const allYearsQuery = useQuery({
    queryKey: ["academic-years", "all-names"],
    queryFn: () => academicYearsApi.list({ page: 1, size: 100 }),
  });
  const suggestedStartYear = useMemo(
    () => nextAcademicYearStartYear(allYearsQuery.data?.data || []),
    [allYearsQuery.data?.data],
  );

  const createMutation = useMutation({
    mutationFn: academicYearsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      setDialog(null);
    },
  });

  const bulkCreateMutation = useMutation({
    mutationFn: academicYearsApi.bulkCreate,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      setBulkDialogOpen(false);
      if (result.success_count > 0) {
        showSuccessToast(`${result.success_count} academic year(s) created.`);
      }
      if (result.failed_count > 0) {
        showBulkFailureToast("academic year(s) failed to create", result);
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => academicYearsApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      setDialog(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: academicYearsApi.remove,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });

  const canWrite = user?.role === "SUPER_ADMIN";
  const paging = yearsQuery.data?.paging || defaultPaging(params);

  function updateParams(patch) {
    setParams((current) => ({ ...current, ...patch }));
  }

  function resetPageAndUpdate(patch) {
    updateParams({ ...patch, page: 1 });
  }

  // Leaving ACTIVE cascade-deactivates the year's classes server-side and
  // ends any still-open teacher assignment in them (see
  // academic-year-service.ts's update()) - if students still have an active
  // enrollment, or teachers an active assignment, warn with real counts
  // before stranding students / silently ending assignments, rather than
  // letting the plain 400 be the first the admin hears of it.
  async function handleSubmit(payload) {
    // Guards against the dialog having closed (e.g. Escape, backdrop
    // click) between this async function starting and reaching here -
    // dialog is a closure-captured value, but a defensive check is cheap
    // insurance against any path that can call this after close.
    if (!dialog) return;

    const isLeavingActive =
      dialog.mode === "edit" &&
      dialog.record.status === "ACTIVE" &&
      payload.status &&
      payload.status !== "ACTIVE";

    if (isLeavingActive) {
      const counts = await academicYearsApi.getUnresolvedEnrollmentCount(
        dialog.record.id,
      );
      if (
        counts.active_enrollment_count > 0 ||
        counts.active_teacher_assignment_count > 0
      ) {
        const proceed = await confirm({
          title: "Classes still have active students or teachers",
          wide: true,
          description: (
            <>
              <p>
                Moving to {formatStatus(payload.status)} will deactivate{" "}
                {counts.class_count} class(es) below
                {counts.active_enrollment_count > 0
                  ? `, stranding ${counts.active_enrollment_count} student(s) mid-year`
                  : ""}
                {counts.active_teacher_assignment_count > 0
                  ? `${counts.active_enrollment_count > 0 ? " and" : ","} ending ${counts.active_teacher_assignment_count} active teacher assignment(s)`
                  : ""}
                . Promote, transfer, or close the students, and end the
                teacher assignments yourself first if you'd rather not have
                them ended automatically.
              </p>
              <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-[var(--mws-line)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--mws-soft)] font-display font-bold text-[var(--mws-muted)]">
                    <tr>
                      <th className="px-3 py-2">Class</th>
                      <th className="px-3 py-2">Grade</th>
                      <th className="px-3 py-2 text-right">Students</th>
                      <th className="px-3 py-2 text-right">Teachers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts.classes.map((klass) => (
                      <tr
                        key={klass.class_id}
                        className="border-t border-[var(--mws-line)]"
                      >
                        <td className="px-3 py-2 font-semibold">
                          <Link
                            to={`/academic/classes/${klass.class_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--mws-burgundy)] hover:underline"
                          >
                            {klass.class_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{klass.grade_name}</td>
                        <td className="px-3 py-2 text-right">
                          {klass.active_student_count}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {klass.active_teacher_assignment_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ),
          confirmLabel: "Continue Anyway",
          tone: "danger",
        });
        if (!proceed) return;
        payload = { ...payload, confirm_unresolved_enrollments: true };
      }
    }

    // Narrowing (or newly setting) either date can leave existing
    // enrollments dated outside the year's own new boundaries - mirrors
    // academic-year-service.ts's update() guard, which judges against
    // whichever date actually changed, falling back to the existing one.
    const nextStartDate =
      payload.start_date !== undefined
        ? payload.start_date
        : dialog.record?.start_date;
    const nextEndDate =
      payload.end_date !== undefined ? payload.end_date : dialog.record?.end_date;
    const datesChanged =
      dialog.mode === "edit" &&
      ((payload.start_date !== undefined &&
        payload.start_date !== dialog.record.start_date) ||
        (payload.end_date !== undefined &&
          payload.end_date !== dialog.record.end_date));

    if (datesChanged) {
      const { count } = await academicYearsApi.getOutOfRangeEnrollmentCount(
        dialog.record.id,
        { start_date: nextStartDate, end_date: nextEndDate || undefined },
      );
      if (count > 0) {
        const proceed = await confirm({
          title: "Enrollment dates fall outside the new range",
          description: `${count} enrollment(s) in this year have a start or end date outside the new range. Nothing about those enrollments changes automatically. Update them yourself if needed.`,
          confirmLabel: "Continue Anyway",
          tone: "danger",
        });
        if (!proceed) return;
        payload = { ...payload, confirm_date_range_change: true };
      }
    }

    if (dialog.mode === "create") createMutation.mutate(payload);
    else updateMutation.mutate({ id: dialog.record.id, payload });
  }

  async function handleDelete(year) {
    if (
      await confirm({
        title: "Delete academic year",
        description: `"${year.name}" will be deleted.`,
        confirmLabel: "Delete",
        tone: "danger",
      })
    ) {
      deleteMutation.mutate(year.id);
    }
  }

  return (
    <PanelFrame
      title="Academic Years"
      icon={CalendarDays}
      isFetching={yearsQuery.isFetching}
      action={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={!canWrite}
            onClick={() => setBulkDialogOpen(true)}
          >
            <Layers size={16} />
            Bulk Create
          </Button>
          <Button
            type="button"
            disabled={!canWrite}
            onClick={() => setDialog({ mode: "create" })}
          >
            <Plus size={16} />
            New Year
          </Button>
        </>
      }
      toolbar={
        <>
          <SearchBox
            value={params.search}
            placeholder="Search Years"
            onChange={(value) => resetPageAndUpdate({ search: value })}
          />
          <SelectFilter
            value={params.status}
            onChange={(value) => resetPageAndUpdate({ status: value })}
            options={[
              { value: "", label: "All Statuses" },
              ...academicYearStatuses.map((status) => ({
                value: status,
                label: formatStatus(status),
              })),
            ]}
            placeholder="All Statuses"
          />
        </>
      }
      error={yearsQuery.error || deleteMutation.error}
    >
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[var(--mws-soft)] font-display text-xs font-bold text-[var(--mws-muted)]">
          <tr>
            <HeaderCell
              label="Name"
              column="name"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Start"
              column="start_date"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="End"
              column="end_date"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <HeaderCell
              label="Status"
              column="status"
              params={params}
              onSort={resetPageAndUpdate}
            />
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          <LoadingRows
            isLoading={yearsQuery.isLoading}
            isEmpty={(yearsQuery.data?.data || []).length === 0}
            colSpan={5}
            label="academic years"
          />
          {!yearsQuery.isLoading
            ? (yearsQuery.data?.data || []).map((year) => (
                <tr
                  key={year.id}
                  className="border-t border-[var(--mws-line)] bg-white hover:bg-[var(--mws-soft)]"
                >
                  <td className="px-4 py-3 font-semibold text-[var(--mws-charcoal)]">
                    {year.name}
                  </td>
                  <td className="px-4 py-3">{formatDate(year.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(year.end_date)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={statusTone(year.status)}>
                      {formatStatus(year.status)}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      disabled={!canWrite}
                      onEdit={() => setDialog({ mode: "edit", record: year })}
                      onDelete={() => handleDelete(year)}
                    />
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>

      <PaginationBar
        paging={paging}
        itemLabel="years"
        isLoading={yearsQuery.isLoading}
        onPrevious={() => updateParams({ page: params.page - 1 })}
        onNext={() => updateParams({ page: params.page + 1 })}
        onPageSizeChange={(size) => updateParams({ page: 1, size })}
      />

      {dialog ? (
        <AcademicYearDialog
          dialog={dialog}
          suggestedStartYear={suggestedStartYear}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          onClose={() => setDialog(null)}
          onSubmit={handleSubmit}
        />
      ) : null}

      {bulkDialogOpen ? (
        <AcademicYearBulkCreateDialog
          suggestedStartYear={suggestedStartYear}
          existingYears={allYearsQuery.data?.data || []}
          isSubmitting={bulkCreateMutation.isPending}
          onClose={() => setBulkDialogOpen(false)}
          onSubmit={(payload) => bulkCreateMutation.mutate(payload)}
        />
      ) : null}
    </PanelFrame>
  );
}
