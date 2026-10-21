import { Mail, Phone } from "lucide-react";
import { ListPopover } from "../../../components/ui/ListPopover.jsx";
import { SensitiveHiddenNote, SensitiveToggle } from "../../../components/ui/SensitiveToggle.jsx";
import { formatDate, formatEducationLevel, formatStatus, formatTenure } from "../../../lib/format.js";
import { ContactRow } from "../../employees/components/ContactRow.jsx";
import { DetailRow } from "../../employees/components/DetailRow.jsx";
import { describeChildren } from "../../employees/utils/childrenRules.js";

const card = "min-w-0 rounded-2xl border border-(--mws-line) bg-white p-5 shadow-[0_18px_40px_-34px_rgba(36,23,24,0.5)]";

function CardTitle({ children, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-xs font-bold uppercase tracking-wide text-(--mws-muted)">{children}</h2>
      {action}
    </div>
  );
}

// The person's own employee record, read only. Anything to change goes through a change request.
export function PersonalPanel({ employee, pii, revealed, revealing, onShow, onHide }) {
  const identity = employee.identity;
  return (
    <div className="space-y-5">
      <section className={card}>
        <CardTitle>Contact</CardTitle>
        <div className="space-y-3 text-sm">
          <ContactRow icon={Mail} value={identity.email} />
          <ContactRow icon={Phone} value={identity.mobile_phone || "-"} />
        </div>
        <dl className="mt-3 border-t border-(--mws-line) pt-1">
          <DetailRow compact label="Nick Name" value={identity.nick_name} />
          {"residential_address" in identity ? <DetailRow compact label="Address" value={identity.residential_address} /> : null}
        </dl>
        {identity.can_view_pii ? (
          <dl className="mt-3 border-t border-(--mws-line) pt-1">
            <DetailRow compact label="Education Level" value={formatEducationLevel(identity.education_level)} />
            <DetailRow compact label="Institution" value={identity.institution_name} />
            <DetailRow compact label="Major" value={identity.major} />
            <DetailRow compact label="Graduation Year" value={identity.graduation_year} />
          </dl>
        ) : null}
      </section>

      {identity.can_view_pii ? (
        <section className={card}>
          <CardTitle action={<SensitiveToggle revealed={revealed} loading={revealing} onShow={onShow} onHide={onHide} />}>
            Sensitive Details
          </CardTitle>
          {revealed && pii ? (
            <dl className="grid gap-x-6 sm:grid-cols-2">
              <DetailRow compact label="Gender" value={formatStatus(pii.gender)} />
              <DetailRow compact label="Religion" value={formatStatus(pii.religion)} />
              <DetailRow compact label="Birth Place" value={pii.birth_place} />
              <DetailRow compact label="Birth Date" value={formatDate(pii.birth_date)} />
              <DetailRow compact label="Marital Status" value={formatStatus(pii.marital_status)} />
              <DetailRow compact label="NIK" value={pii.nik} />
              <DetailRow compact label="NPWP" value={pii.npwp} />
              <DetailRow compact label="Bank Account" value={pii.bank_account_number} />
              <DetailRow compact label="BPJS Kesehatan" value={pii.bpjs_number} />
              <DetailRow compact label="BPJS Ketenagakerjaan" value={pii.bpjs_employment_number} />
              <DetailRow compact label="KPJ Number" value={pii.kpj_number} />
            </dl>
          ) : (
            <SensitiveHiddenNote />
          )}
        </section>
      ) : null}
    </div>
  );
}

export function EmploymentPanel({ employee }) {
  const employment = employee.employment;
  const status = employee.status_info;
  return (
    <section className={card}>
      <CardTitle>Employment</CardTitle>
      <dl>
        <DetailRow label="Employee ID" value={employment.employee_id} />
        <DetailRow label="Status" value={formatStatus(status.status)} />
        <DetailRow label="Employment Type" value={formatStatus(status.employment_type)} />
        <DetailRow label="Unit" value={employment.unit} />
        <DetailRow label="Job Position" value={employment.job_position} />
        <DetailRow label="Job Level" value={employment.job_level} />
        <DetailRow label="Building" value={employment.building} />
        <DetailRow label="Join Date" value={formatDate(employment.join_date)} />
        <DetailRow label="Days Worked" value={formatTenure(employment.join_date, status.last_working_date)} />
        {status.employment_type !== "PERMANENT" ? <DetailRow label="Contract End Date" value={formatDate(status.contract_end_date)} /> : null}
        {employment.is_pc_mentor_eligible ? (
          <DetailRow
            label="PC Mentor"
            value={employment.pc_mentor_units?.length ? `Yes (${employment.pc_mentor_units.map((unit) => unit.name).join(", ")})` : "Yes (own unit only)"}
          />
        ) : null}
      </dl>
    </section>
  );
}

export function FamilyPanel({ employee, pii, revealed, revealing, onShow, onHide }) {
  const children = pii?.children;
  const canView = Boolean(employee.identity.can_view_pii);
  return (
    <section className={card}>
      <CardTitle action={canView ? <SensitiveToggle revealed={revealed} loading={revealing} onShow={onShow} onHide={onHide} /> : null}>
        Family
      </CardTitle>
      {revealed && children ? (
        <dl>
          <DetailRow
            compact
            label="Children"
            value={describeChildren(children.summary)}
            action={
              children.items?.length ? (
                <ListPopover
                  label="List"
                  count={children.items.length}
                  dialogLabel="Children"
                  mono={false}
                  groups={[
                    {
                      hideCount: true,
                      items: children.items.map((child, index) => ({
                        label: `${index + 1}. ${formatDate(child.birth_date)}`,
                        hint: formatStatus(child.relation),
                      })),
                    },
                  ]}
                />
              ) : null
            }
          />
          {children.summary?.total ? (
            <DetailRow compact label="Allowance" value={`${children.summary.allowance_eligible} of ${children.summary.total}`} />
          ) : null}
          {children.mode === "COUNTS" ? (
            <DetailRow
              compact
              label="Children Recorded"
              value={`As numbers on ${formatDate(children.declared_at)}`}
              warning={children.needs_review ? "Needs review, last confirmed more than a year ago" : undefined}
            />
          ) : null}
        </dl>
      ) : (
        <SensitiveHiddenNote />
      )}
    </section>
  );
}
