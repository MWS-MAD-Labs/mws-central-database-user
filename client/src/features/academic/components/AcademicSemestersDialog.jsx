import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { DateField, Field, TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { useConfirm } from "../../../components/ui/useConfirm.js";
import { dateInputFromIso, isoFromDateInput } from "../../../lib/form.js";
import { formatDate } from "../../../lib/format.js";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { academicYearsApi } from "../api/academicApi.js";

const EMPTY = { id: null, name: "", start_date: "", end_date: "" };

// The parts of one academic year. Applications that report on a part of the year, like Learnspace, take them from here.
export function AcademicSemestersDialog({ year, canWrite, onClose }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [form, setForm] = useState(null);
  const key = ["academic-years", year.id, "semesters"];
  const semestersQuery = useQuery({ queryKey: key, queryFn: () => academicYearsApi.semesters(year.id) });
  const semesters = semestersQuery.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const defaults = useMutation({
    mutationFn: () => academicYearsApi.addDefaultSemesters(year.id),
    onSuccess: () => {
      refresh();
      showSuccessToast("Semester 1 and Semester 2 added.");
    },
    onError: (error) => showErrorToast(error, "Could not add the semesters."),
  });
  const save = useMutation({
    mutationFn: (values) => {
      const payload = { name: values.name.trim(), start_date: isoFromDateInput(values.start_date), end_date: isoFromDateInput(values.end_date) };
      return values.id ? academicYearsApi.updateSemester(values.id, payload) : academicYearsApi.addSemester(year.id, payload);
    },
    onSuccess: () => {
      refresh();
      setForm(null);
      showSuccessToast("Semester saved.");
    },
    onError: (error) => showErrorToast(error, "Could not save the semester."),
  });
  const remove = useMutation({
    mutationFn: (id) => academicYearsApi.deleteSemester(id),
    onSuccess: () => {
      refresh();
      showSuccessToast("Semester deleted.");
    },
    onError: (error) => showErrorToast(error, "Could not delete the semester."),
  });

  async function askDelete(semester) {
    const confirmed = await confirm({
      title: "Delete Semester",
      description: `${semester.name} of ${year.name} is deleted. Applications that took it from here keep their copy.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (confirmed) remove.mutate(semester.id);
  }

  const problem = form && (!form.name.trim() ? "Name is required." : !form.start_date || !form.end_date ? "Both dates are required." : form.start_date > form.end_date ? "The start date cannot be after the end date." : null);

  return (
    <CrudDialog
      title={`Semesters of ${year.name}`}
      description={`${formatDate(year.start_date)} to ${formatDate(year.end_date)}`}
      onClose={onClose}
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {semestersQuery.isLoading ? <PanelMessage>Loading…</PanelMessage> : null}
      {semestersQuery.isError ? <PanelMessage tone="error">The semesters could not be loaded.</PanelMessage> : null}
      {semestersQuery.isSuccess && semesters.length === 0 && !form ? (
        <PanelMessage>No semesters yet. Applications that need a part of the year cannot use this year until it has some.</PanelMessage>
      ) : null}
      {semesters.length > 0 ? (
        <ul className="divide-y divide-(--mws-line) rounded-2xl border border-(--mws-line)">
          {semesters.map((semester) => (
            <li key={semester.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-semibold text-(--mws-charcoal)">{semester.name}</p>
                <p className="text-xs text-(--mws-muted)">
                  {formatDate(semester.start_date)} to {formatDate(semester.end_date)}
                </p>
              </div>
              {canWrite ? (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setForm({ id: semester.id, name: semester.name, start_date: dateInputFromIso(semester.start_date), end_date: dateInputFromIso(semester.end_date) })}
                  >
                    Edit
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => askDelete(semester)}>
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite && !form && semestersQuery.isSuccess ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {semesters.length === 0 ? (
            <Button type="button" onClick={() => defaults.mutate()} loading={defaults.isPending}>
              Add Semester 1 And 2
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={() => setForm({ ...EMPTY })}>
            Add Semester
          </Button>
        </div>
      ) : null}

      {form ? (
        <form
          className="mt-4 grid gap-4 rounded-2xl border border-(--mws-line) p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problem) save.mutate(form);
          }}
        >
          <Field label="Name" required className="md:col-span-2">
            <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Start Date" required>
            <DateField value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
          </Field>
          <Field label="End Date" required>
            <DateField value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} />
          </Field>
          {problem ? <p className="text-xs text-[#a43c41] md:col-span-2">{problem}</p> : null}
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button type="button" variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={Boolean(problem)}>
              Save
            </Button>
          </div>
        </form>
      ) : null}
    </CrudDialog>
  );
}
