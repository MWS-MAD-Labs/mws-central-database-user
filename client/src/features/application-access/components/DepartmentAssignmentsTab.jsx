import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, FolderTree, Search, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../../components/ui/Button.jsx";
import { CrudDialog } from "../../../components/ui/CrudDialog.jsx";
import { TextInput } from "../../../components/ui/FormControls.jsx";
import { PanelMessage } from "../../../components/ui/PanelMessage.jsx";
import { showErrorToast, showSuccessToast } from "../../../lib/toast.js";
import { applicationAccessApi } from "../api/applicationAccessApi.js";

function canUseApplication(person) {
  return person.own_access ? person.own_access.is_active : Boolean(person.inherited_role);
}

async function allCandidates(applicationId) {
  const rows = [];
  let page = 1;
  while (true) {
    const response = await applicationAccessApi.listCandidates({
      application_id: applicationId,
      coverage: "ANY",
      page,
      size: 100,
    });
    rows.push(...(response.data || []).filter(canUseApplication));
    const totalPage = response.paging?.total_page || 1;
    if (page >= totalPage) break;
    page += 1;
  }
  return rows;
}

function explicitAssignees(unit, permissionKey) {
  return unit.assignments
    .filter((assignment) => assignment.permission_key === permissionKey)
    .map((assignment) => ({
      ...assignment.person,
      active: assignment.active,
      inactive_reason: assignment.inactive_reason,
    }));
}

function assigneesFor(unit, responsibility, responsibilities, candidates) {
  const explicit = explicitAssignees(unit, responsibility.key);
  if (responsibility.mode !== "derived_home_unit") return explicit;

  const exclusiveKeys = new Set(
    responsibilities
      .filter((item) => item.mode === "explicit" && item.exclusive_group === responsibility.exclusive_group)
      .map((item) => item.key),
  );
  const leaders = new Set(
    unit.assignments
      .filter((assignment) => assignment.active && exclusiveKeys.has(assignment.permission_key))
      .map((assignment) => assignment.person.id),
  );
  return candidates
    .filter((person) => person.unit_id === unit.id && !leaders.has(person.person_id))
    .map((person) => ({ id: person.person_id, full_name: person.full_name, email: person.email }));
}

function personName(person) {
  return person.full_name || person.email;
}

export function DepartmentAssignmentsTab({ applicationId, retired = false }) {
  const queryClient = useQueryClient();
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [unitSearch, setUnitSearch] = useState("");
  const [target, setTarget] = useState(null);
  const [selectedPeople, setSelectedPeople] = useState(new Set());
  const [personSearch, setPersonSearch] = useState("");

  const assignmentsQuery = useQuery({
    queryKey: ["application-access", applicationId, "unit-assignments"],
    queryFn: () => applicationAccessApi.getUnitAssignments(applicationId),
  });
  const candidatesQuery = useQuery({
    queryKey: ["application-access", applicationId, "assignment-candidates"],
    queryFn: () => allCandidates(applicationId),
  });

  const units = useMemo(() => assignmentsQuery.data?.units || [], [assignmentsQuery.data]);
  const responsibilities = useMemo(
    () => assignmentsQuery.data?.responsibilities || [],
    [assignmentsQuery.data],
  );
  const candidates = useMemo(() => candidatesQuery.data || [], [candidatesQuery.data]);
  const filteredUnits = useMemo(() => {
    const needle = unitSearch.trim().toLowerCase();
    return units.filter((unit) => !needle || unit.name.toLowerCase().includes(needle));
  }, [unitSearch, units]);
  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || units[0] || null;

  function updateUnitSearch(value) {
    setUnitSearch(value);
    const needle = value.trim().toLowerCase();
    const firstMatch = units.find((unit) => !needle || unit.name.toLowerCase().includes(needle));
    if (firstMatch) setSelectedUnitId(firstMatch.id);
  }

  const people = useMemo(() => {
    const byId = new Map(candidates.map((person) => [person.person_id, person]));
    for (const unit of units) {
      for (const assignment of unit.assignments) {
        if (assignment.active && !byId.has(assignment.person.id)) {
          byId.set(assignment.person.id, {
            person_id: assignment.person.id,
            full_name: assignment.person.full_name,
            email: assignment.person.email,
            unit: null,
            unit_id: null,
          });
        }
      }
    }
    return [...byId.values()].sort((left, right) => personName(left).localeCompare(personName(right)));
  }, [candidates, units]);

  const filteredPeople = useMemo(() => {
    const needle = personSearch.trim().toLowerCase();
    return people.filter((person) =>
      !needle || [person.full_name, person.email, person.unit].some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [people, personSearch]);

  function manage(unit, responsibility) {
    const current = assigneesFor(unit, responsibility, responsibilities, candidates)
      .filter((person) => person.active !== false);
    setSelectedPeople(new Set(current.map((person) => person.id)));
    setPersonSearch("");
    setTarget({ unit, responsibility });
  }

  const mutation = useMutation({
    mutationFn: () => applicationAccessApi.replaceUnitAssignments(applicationId, {
      unit_id: target.unit.id,
      permission_key: target.responsibility.key,
      person_ids: [...selectedPeople],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application-access", applicationId] });
      showSuccessToast("Department assignments updated.");
      setTarget(null);
    },
    onError: (error) => showErrorToast(error, "Could not update department assignments."),
  });

  if (assignmentsQuery.isLoading || candidatesQuery.isLoading) {
    return <PanelMessage>Loading department assignments…</PanelMessage>;
  }
  if (assignmentsQuery.isError || candidatesQuery.isError) {
    return <PanelMessage tone="error">Department assignments could not be loaded. Refresh the page and try again.</PanelMessage>;
  }

  const selectedRoles = selectedUnit
    ? Object.fromEntries(
        responsibilities.map((item) => [item.key, assigneesFor(selectedUnit, item, responsibilities, candidates)]),
      )
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-(--mws-charcoal)">
            <FolderTree size={20} className="text-(--mws-burgundy)" />
            Department structure
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-(--mws-muted)">
            Browse a Unit, then manage the responsibilities declared by this application. Home-Unit memberships are derived from Central employee data.
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link to="/master-data?tab=employment&section=units">
            <Building2 size={16} />
            Manage Units
          </Link>
        </Button>
      </div>

      {!units.length ? (
        <div className="rounded-2xl border border-dashed border-(--mws-line) bg-white px-6 py-12 text-center">
          <FolderTree size={36} className="mx-auto text-(--mws-muted)" />
          <p className="mt-3 font-display font-semibold text-(--mws-charcoal)">No Units available</p>
          <p className="mt-1 text-sm text-(--mws-muted)">Create a Unit in Master Data before assigning department roles.</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white">
            <div className="border-b border-(--mws-line) px-5 py-4">
              <h3 className="font-display text-base font-bold text-(--mws-charcoal)">Organisation navigator</h3>
              <div className="relative mt-3">
                <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-(--mws-muted)" />
                <TextInput value={unitSearch} onChange={(event) => updateUnitSearch(event.target.value)} placeholder="Find a Unit" className="pl-9" />
              </div>
            </div>
            <div className="mws-scrollbar max-h-[620px] space-y-1 overflow-y-auto p-3" aria-label="Department Units">
              {filteredUnits.length ? filteredUnits.map((unit) => {
                const counts = responsibilities.map((item) => assigneesFor(unit, item, responsibilities, candidates).length);
                const active = unit.id === selectedUnit.id;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setSelectedUnitId(unit.id)}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--mws-burgundy) ${active ? "border-(--mws-burgundy) bg-(--mws-soft)" : "border-transparent hover:border-(--mws-line) hover:bg-(--mws-soft)"}`}
                  >
                    <Building2 size={17} className="shrink-0 text-(--mws-burgundy)" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-(--mws-charcoal)">{unit.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-(--mws-muted)">{counts.join(" · ")}</span>
                  </button>
                );
              }) : <p className="px-3 py-10 text-center text-sm text-(--mws-muted)">No Units match this search.</p>}
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-(--mws-line) bg-white">
            {selectedUnit && selectedRoles ? (
              <>
                <div className="border-b border-(--mws-line) px-5 py-5">
                  <p className="text-sm text-(--mws-muted)">Master Unit / ProofPoint Department</p>
                  <h3 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-(--mws-charcoal)">
                    <Building2 size={21} className="text-(--mws-burgundy)" />
                    {selectedUnit.name}
                  </h3>
                </div>
                <div className="space-y-5 p-5">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {responsibilities.map((responsibility) => (
                      <Stat key={responsibility.key} label={responsibility.label} value={selectedRoles[responsibility.key].length} />
                    ))}
                  </div>
                  {responsibilities.map((responsibility) => (
                    <RolePanel
                      key={responsibility.key}
                      title={responsibility.label}
                      people={selectedRoles[responsibility.key]}
                      disabled={retired || responsibility.mode !== "explicit"}
                      derived={responsibility.mode === "derived_home_unit"}
                      onManage={() => manage(selectedUnit, responsibility)}
                    />
                  ))}
                </div>
              </>
            ) : <div className="px-6 py-12 text-center text-sm text-(--mws-muted)">Select a Unit to manage its assignments.</div>}
          </section>
        </div>
      )}

      {target ? (
        <CrudDialog
          title={`Manage ${target.responsibility.label.toLowerCase()}`}
          description={`Add or remove people for ${target.unit.name}. A person may be assigned to more than one department role.`}
          onClose={() => setTarget(null)}
          footer={(
            <>
              <span className="mr-auto self-center text-sm tabular-nums text-(--mws-muted)">{selectedPeople.size} selected</span>
              <Button type="button" variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="button" loading={mutation.isPending} onClick={() => mutation.mutate()}>Save assignments</Button>
            </>
          )}
        >
          <div className="space-y-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-(--mws-muted)" />
              <TextInput value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} placeholder="Search by name, email, or Unit" className="pl-9" />
            </div>
            <div className="mws-scrollbar max-h-[420px] divide-y divide-(--mws-line) overflow-y-auto rounded-xl border border-(--mws-line)">
              {filteredPeople.length ? filteredPeople.map((person) => {
                const checked = selectedPeople.has(person.person_id);
                return (
                  <button
                    key={person.person_id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => setSelectedPeople((current) => {
                      const next = new Set(current);
                      if (next.has(person.person_id)) next.delete(person.person_id);
                      else next.add(person.person_id);
                      return next;
                    })}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-(--mws-soft) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--mws-burgundy)"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${checked ? "border-(--mws-burgundy) bg-(--mws-burgundy) text-white" : "border-(--mws-line) bg-white"}`}>
                      {checked ? <Check size={14} /> : null}
                    </span>
                    <UserRound size={17} className="shrink-0 text-(--mws-muted)" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-(--mws-charcoal)">{personName(person)}</span>
                      <span className="block truncate text-xs text-(--mws-muted)">{person.email}{person.unit ? ` · ${person.unit}` : ""}</span>
                    </span>
                    {checked ? <Check size={16} className="shrink-0 text-(--mws-burgundy)" /> : null}
                  </button>
                );
              }) : <p className="p-8 text-center text-sm text-(--mws-muted)">No people match this search.</p>}
            </div>
          </div>
        </CrudDialog>
      ) : null}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-(--mws-soft) px-4 py-3">
      <p className="text-xs font-medium text-(--mws-muted)">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-(--mws-charcoal)">{value}</p>
    </div>
  );
}

function RolePanel({ title, people, disabled, derived = false, onManage }) {
  return (
    <section className="rounded-xl border border-(--mws-line) px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 font-display font-bold text-(--mws-charcoal)">
          <Users size={17} className="text-(--mws-burgundy)" />
          {title}
        </h4>
        {!disabled ? (
          <Button type="button" size="sm" variant="secondary" className="whitespace-nowrap" onClick={onManage}>
            <span className="sm:hidden">Manage</span>
            <span className="hidden sm:inline">Manage {title.toLowerCase()}</span>
          </Button>
        ) : derived ? <span className="text-xs font-medium text-(--mws-muted)">From home Unit</span> : null}
      </div>
      {people.length ? (
        <div className="mt-3 divide-y divide-(--mws-line)">
          {people.map((person) => (
            <div key={person.id} className="flex min-w-0 items-center gap-2 py-2.5">
              <UserRound size={16} className="shrink-0 text-(--mws-muted)" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-(--mws-charcoal)">{personName(person)}</span>
              <span className="hidden max-w-[45%] truncate text-xs text-(--mws-muted) sm:block">{person.email}</span>
              {person.active === false ? <span className="text-xs font-medium text-amber-700">Inactive access</span> : null}
            </div>
          ))}
        </div>
      ) : <p className="mt-3 rounded-lg bg-(--mws-soft) px-3 py-3 text-sm italic text-(--mws-muted)">No {title.toLowerCase()} assigned.</p>}
    </section>
  );
}
