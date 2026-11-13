# Student Reports Engine — scope and repository assessment

**Date:** 2026-10-06  
**Status:** Planning scope; not an implemented feature or a production-readiness claim.

This document records the proposed general academic Student Reports Engine, the repository assessment, and the subsequent product decisions. Explicit owner decisions are distinguished from recommended implementation defaults and unresolved details. It does not reorder the [implementation roadmap](ROADMAP.md), authorize deployment, or replace architecture/security review.

## 1. Purpose and domain boundary

Replace external Google Sheets, Slides, Docs, and Apps Script report workflows with native LearnSpace data assembly, drafting, review, auditing, publication, and media handling.

**This initiative is general academic reporting. The existing weekly reports are IEP-specific reports for students receiving special-education support.** They remain a separate authoring and approval domain and can supply evidence for an IEP section in a general academic report. Do not repurpose the existing `WeeklyReport` model as the general report model.

The general report engine consumes:

- student profiles, enrollment, and attendance;
- general academic assessments and rubrics, which require a new data foundation;
- approved generic narratives and deterministic individualization rules;
- classroom or student-subject photos;
- approved weekly IEP evidence, where applicable.

### Navigation

- **Analytics:** school-wide dashboards, enrollment trends, attendance metrics, and assessment analytics. Existing aggregate reporting belongs here; the proposed label does not imply every requested analytic already exists.
- **Student Reports:** general academic report cycles, templates, drafting, subject/report review, audits, sign-offs, publication, and exports.
- Existing specialist IEP authoring remains intact. Whether its navigation is relocated is not yet decided.

### Report types

Monthly, Mid-Semester, Full Semester, IEP evidence sections, and Passion Connection are in the proposed scope. IEP evidence sections are not a replacement for annual IEP plans or weekly IEP reports. Passion Connection requires a content definition before implementation; do not assume it is equivalent to a Learning Journey.

## 2. Repository assessment

The architecture is compatible, but this is a major new module rather than an existing report generator enhancement. Findings are based on source inspection, not runtime verification.

| Capability | Existing foundation | Work required |
| --- | --- | --- |
| Navigation and analytics | Aggregate Reports & Analytics screen; specialist IEP and weekly-report screens | Separate general reporting workspace and navigation |
| Templates and responsive output | React screens, browser printing, minimal print CSS | Versioned structured templates, A4/16:9 rendering, mobile reflow |
| Data assembly | Profiles, enrollment, attendance, observations, IEPs, weekly goal progress | General academic assessment inputs, report snapshots, provenance |
| Individualization | No evidence-based generic-to-student narrative engine found | Approved generic revisions, rule versions, selective generation, manual-edit protection |
| Workflow | Transactional IEP/weekly-report transitions, version checks, workflow history | Subject/report approval granularity, report responsibilities, new lifecycle |
| Audit | Request and domain validation | Completeness, token, media, rendered-layout checks and revision-bound results |
| Family access | Staff authentication and scoped permissions | Verified child-access relationships and published-only endpoints |
| PDF | Browser `window.print()` | Durable jobs, isolated renderer, private artifacts, protected downloads |
| Media | Avatar URL fields | Uploads, private storage, ownership, validation, retention and backup |
| Local AI / photo recognition | No active integration found | Optional server-side adapters in Phase 2 |

### Reusable code and constraints

- [Prisma schema](../prisma/schema.prisma): authoritative domain model. `WeeklyReport` requires an IEP and has student/week uniqueness; it is not a generic reporting-period model.
- [Weekly report routes](../apps/api/src/weeklyReportRoutes.ts): transactional persistence, workflow events, actor attribution, and optimistic concurrency patterns.
- [Weekly report contracts](../packages/contracts/src/weeklyReport.ts): runtime-validated request/response patterns.
- [IEP routes](../apps/api/src/iepRoutes.ts): existing specialist lifecycle and access patterns.
- [Weekly report editor](../apps/web/src/components/special-ed/WeeklyReportView.tsx) and [tracker](../apps/web/src/components/special-ed/WeeklyReportStatusTracker.tsx): specialist UI patterns, not a general report engine.
- [Analytics view](../apps/web/src/components/dashboard/ReportsAnalyticsView.tsx): existing aggregate reporting.
- [Authorization](../apps/api/src/authorization.ts) and [session service](../apps/api/src/sessionService.ts): staff access foundations, not family access.

Existing approval-themed UI text is not evidence of parent publication. Browser printing is not a reproducible PDF pipeline. Sample narrative defaults are not verified student evidence. Existing tests were identified during assessment but were not run.

Authorization review and regression coverage for report list filters must precede extending report access. Handle specific security findings through the repository's [private reporting process](../SECURITY.md).

## 3. Priority and implementation matrix

| Module | Phase 1 — core replacement | Phase 2 — optional automation |
| --- | --- | --- |
| Template and renderer | A4 and 16:9, responsive React view, controlled PDF layout | Additional capabilities only after core validation |
| Assembly and individualization | Native data aggregation and deterministic rules | No AI dependency for the core path |
| Tracker and approval | Generic approval, individualized drafts, editorial review, audits, final sign-offs | — |
| Validation | Required evidence, tokens, media, rendered overflow | — |
| Family access and PDF | Published-only web view and PDF download | — |
| Media | Direct classroom and student-subject uploads | LensFlow/Immich discovery and facial-recognition-assisted selection |
| Narrative assistant | Manual generic drafting | Local LLM REST adapter for generic drafting |

Phase 1 includes prerequisite data, access, storage, and worker infrastructure. It is not only a UI delivery.

## 4. Confirmed product decisions

| Topic | Owner decision |
| --- | --- |
| Semester editorial approval | Per subject. The report proceeds only after all required subjects clear editorial review. |
| Monthly editorial approval | Whole report. |
| Teacher also acting as PIC for another subject | Not allowed. Enforce the restriction in report responsibility assignments. |
| Return-to-draft authority | PIC, Principal, and Director can return work to draft. |
| Editor behavior | Request changes rather than directly editing teacher narratives. |
| Targeted changes | Personal-data fields and affected individualization may change without rewriting unrelated content. |
| Teacher edits | Preserve manual edits during regeneration. |
| Approval validity | Relevant score, content, photo, or template changes invalidate affected checks and approvals. |

### Recommended workflow interpretation

These defaults follow the instruction to use the assessment recommendations for other areas. Remaining policy details are listed in section 12.

- Require a reason when returning work or requesting changes.
- For semester reports, reopen only the affected subject where possible. Retain unaffected subject approvals, but invalidate whole-report audits and final sign-offs whose approved content changed.
- For Monthly reports, return the whole report to draft.
- An editor change request creates a revision-required editorial stage. It is distinct from the formal return-to-draft action reserved for PIC, Principal, and Director.
- Mid-Semester uses the semester subject-level editorial model.
- Use scoped report responsibilities rather than display titles or broad existing leadership roles. Current membership has one canonical role; PIC, Editor, and Unit Head are not existing canonical roles.

### Proposed end-to-end lifecycle

1. Teacher prepares a generic narrative for the relevant grade/class/subject scope.
2. PIC reviews and approves a specific generic revision.
3. The engine assembles student evidence and generates individualized sections.
4. Teacher inspects and adjusts the individual draft.
5. Editorial review follows Draft 1 → Review 1 → Draft 2 → Review 2, using change requests rather than direct editor modifications.
6. Automated audits validate the relevant revision.
7. Unit Head performs Sign-off 1; Principal performs Sign-off 2.
8. An authorized publication action exposes an immutable revision to the family and makes its PDF available.

Generic approval and individual report approval apply to different records. Do not represent both as one long status field on an existing weekly IEP report. Director has explicit return-to-draft authority; its other responsibilities and the mapping of Unit Head responsibilities need a permission matrix before implementation.

### Batch approvals explained

If a Principal selects 30 reports and two are ineligible, the recommended behavior is to approve the 28 eligible reports and report the two failures individually, rather than silently failing or rejecting all 30.

Example: **28 approved; 2 not approved** — one report changed after audit; another lacks Mathematics editorial approval.

Each report independently checks permission, expected revision, workflow state, required approvals, and audit validity. Retrying must not duplicate approvals. Batch actions must return explicit per-report results. This is a recommended default; the owner requested clarification rather than explicitly selecting batch semantics.

## 5. Academic data and individualization

### New prerequisite: general academic assessments

The repository has specialist observations and weekly IEP goal ratings, not a general gradebook. Add:

- subject offerings and expected subjects per student/reporting window;
- versioned rubrics, criteria, performance bands, and score mappings;
- student assessment results and score finalization/correction rules;
- native entry or controlled initial import;
- missing-data and exemption policies.

A weekly IEP goal rating must not be treated as a semester subject score. Completeness checks need an expected evidence set; checking only existing rows cannot establish that 100% of required scores exist.

### Structured narrative rules

Deterministic individualization requires more than free-form generic prose. Define approved phrase variants, performance-band mappings, strengths/growth selection rules, required evidence, fallback behavior, and rule versions.

Separate content into:

| Content | Behavior |
| --- | --- |
| Personal-data fields | Resolve from authoritative student data into the report revision |
| Approved generic narrative | Shared baseline with explicit revision and PIC approval |
| Individualized narrative | Evidence-derived content that teachers can refine |

Store the source evidence and rule version used to generate each section.

### Selective regeneration

1. Recalculate affected fields/sections only.
2. Preserve unrelated content and teacher-edited blocks.
3. Where new evidence conflicts with a manual edit, flag it and show a proposed replacement.
4. Require explicit acceptance before replacing manual text.
5. Invalidate affected audits and approvals.

A newly approved generic revision should identify affected reports and show proposed differences before application. Do not silently overwrite individualized drafts. Published reports never regenerate in place; corrections create a new revision.

## 6. IEP evidence section in a general report

The owner described the IEP section as the last weekly report in a reporting window and gave an aggregation example: **Monthly August 2026 includes July–August 2026 IEP evidence**.

The recommended interpretation is to aggregate eligible weekly IEP reports across that evidence window and use the latest eligible report as the latest-progress reference, rather than copying only the last report. This reconciles the example but remains an interpretation to confirm before implementing the aggregation algorithm.

| Setting | Example |
| --- | --- |
| General academic report | Monthly — August 2026 |
| IEP evidence window | July–August 2026 |
| Sources | Existing student-specific weekly IEP reports in the window |
| Output | Aggregated IEP progress section within the general report |

The IEP evidence window must be configurable separately from the general reporting period.

Recommended content:

- goals addressed and progress over the window;
- achievements and dates;
- relevant observations;
- current support needs and home recommendations.

Recommended source rules:

- Use approved weekly IEP reports by default.
- Retain source report IDs and versions.
- Flag missing/unapproved expected reports; do not invent progress.
- Define week-boundary inclusion and handle windows spanning replacement IEPs explicitly.
- Snapshot the approved section at publication.

Current IEP goal projections can reflect draft weekly-report changes. Aggregate from eligible source reports; do not assume current goal summaries represent approved-only evidence.

## 7. Templates, rendering, and automated audits

### Templates and dual output

- Support admin-selected A4 document and 16:9 presentation layouts.
- Store validated structured content and versioned layout configuration, not executable JSX or arbitrary React code.
- Render through trusted React components.
- Desktop shows presentation pages or paginated A4 sheets; mobile reflows into a readable single column rather than shrinking pages.
- Phase 1 template configuration is constrained to approved blocks, ordering, branding, and layout selection. A freeform slide designer is not included.
- Use the same content revision for the responsive web view and PDF.

### Audit gates

| Audit | Requirement |
| --- | --- |
| Academic completeness | Every expected subject/rubric result is recorded or explicitly exempted |
| Text/tokens | No unresolved template tokens or known placeholder/sample content |
| Monthly media | Required shared classroom learning photo per grade/section and reporting cycle |
| Semester/Mid-Semester media | Required student-subject evidence photos |
| Rendered layout | Detect clipping/overflow and failed image/font loading in the canonical output layout |

Character counts are warnings, not proof of layout fit. Run actual rendered-layout checks with controlled dimensions and fonts. Keep data checks distinct from browser-rendered checks.

Audit runs and sign-offs bind to a specific revision. Relevant changes invalidate their results. Define blocking errors, warnings, and any authorized exceptions before implementing sign-off gates.

## 8. Family access, publication, and PDF

### Recommended access model

Use separate guardian identities with verified, revocable child-access grants instead of shared child credentials. Guardian contact data alone must not grant access. Student login, if required independently, also needs an explicit user-to-student relationship.

Family-facing list, detail, photo, PDF, and export-status endpoints expose only authorized published content. Do not expose staff workflow history, internal comments, drafts, or unrelated source records.

### Publication

A live React view means responsive rendering, not mutable published evidence. Publish an immutable report revision containing content, relevant student-data snapshots, template/rule versions, and media/evidence references.

- Subsequent profile, score, or narrative changes do not silently alter publication.
- Corrections and withdrawal use explicit authorized workflows and preserve history.
- Distinguish approval, publication, notification dispatch, and confirmed delivery. Do not use “Sent” to imply delivery without evidence.
- Define who may publish, correct, or withdraw a report before implementation.

### PDF processing

Add durable render jobs, an isolated headless-browser worker, private artifact storage, bounded retries, concurrency limits, failure visibility, and authorized/audited downloads. Jobs must identify the exact report revision and be safe to retry.

Render the approved publication revision, not mutable current data. Restrict renderer network access and resource use. Define whether publication waits for PDF completion or allows a visible “PDF preparing” state.

## 9. Media and Phase 2 integrations

### Phase 1 private uploads

PostgreSQL is authoritative for metadata, ownership, permissions, and provenance. Private LearnSpace-managed storage holds image/PDF binaries. This is the recommended interpretation of relying on LearnSpace's own data rather than Google tools.

Provide:

- classroom/cycle associations for Monthly images;
- student/subject/cycle associations for semester evidence;
- upload type/size validation and a malware-handling policy;
- EXIF/location stripping and controlled derivatives;
- protected original/thumbnail delivery;
- retention, deletion, access logging, and backup/restore coverage;
- consent and disclosure rules for classroom photos containing other children.

Do not place student images in frontend public assets. Current static image delivery is not protected student-media storage. Review proxy routing and caching when introducing protected media endpoints.

### Phase 2 local narrative assistant

Use an optional server-side REST adapter for approved local LLM endpoints, such as Ollama or vLLM. Inputs are grade level, curriculum/unit goals, and tone; output populates a generic draft for human review.

Keep the non-AI path fully functional. Apply endpoint restrictions, timeouts, protected credentials, data minimization, prompt/output validation, and provenance. AI must not approve reports or make educational/clinical decisions.

### Phase 2 photo-server integration

Use server-side LensFlow/Immich adapters for recognition-assisted discovery and teacher selection. Do not expose service keys or treat external asset IDs as LearnSpace authorization. Define consent, retention, false-match handling, and whether selected assets are imported into private LearnSpace storage. Published reports must not depend on an ungoverned mutable external photo reference.

## 10. Proposed domain additions

These are conceptual entities, not existing Prisma models or a finalized migration design:

| Area | Candidate records |
| --- | --- |
| Reporting setup | Report cycle/type and required sections |
| Academic inputs | Subject offering, rubric version, assessment result |
| Templates | Template and immutable template version |
| Shared drafting | Generic narrative revision and PIC approval |
| Student output | Student report, revision, section, evidence snapshot |
| Review | Scoped responsibility, feedback, approval event |
| Validation | Audit run and findings |
| Distribution | Publication, PDF artifact, render job |
| Access/media | Child-access grant, private asset, evidence association |

Reuse existing transaction, concurrency, tenant ownership, and audit patterns while preserving specialist IEP/weekly-report behavior. Update contracts, APIs, authorization, and tests together with schema changes.

## 11. Delivery sequence and migration

| Milestone | Deliverable |
| --- | --- |
| 1A — Contracts and prerequisites | Report-type matrix, sample outputs, data coverage, access/architecture decisions, migration plan |
| 1B — Foundations | Assessment inputs, cycles, templates, report revisions, responsibilities, navigation split |
| 1C — First complete report type | Monthly generic approval, individualization, editing, review, private uploads, audits |
| 1D — Publication/export | Family access, immutable publication, responsive view, PDF worker, protected downloads |
| 1E — Remaining types/cutover | Semester subject workflows, other defined types, batch operations, migration rehearsal, release qualification |
| Phase 2 | Optional local LLM and photo-server adapters |

Monthly is the recommended first vertical because its media requirements are simpler, provided its required academic inputs exist. It is an incremental milestone, not a reduction of the full Phase 1 commitment.

### Google workflow cutover

Existing import tooling targets legacy LearnSpace browser exports; it does not establish Sheets/Slides/Docs migration support. Inventory and decide which scores, narratives, templates, photos, and historical reports need migration. Add controlled import, reconciliation, pilot validation, rollback, and an agreed cutover criterion. Runtime report generation must not depend on the retired Google workflow.

### Roadmap and release alignment

This scope depends on capabilities currently listed as future work: guardian portal (`FUT-PROD-004`), attachments (`FUT-PROD-005`), PDF export (`FUT-PROD-006`), workers (`FUT-PLAT-002`), and object storage (`FUT-PLAT-003`). Promote them into numbered implementation tasks only through explicit roadmap planning.

LearnSpace remains pre-production. Feature completion does not waive existing real-data, privacy, security, accessibility, operational, or release-qualification gates.

## 12. Remaining decisions before implementation

1. Define sections, evidence, exemptions, media requirements, and approval policy for every report type, especially Passion Connection.
2. Confirm the IEP aggregate/latest-report interpretation, inclusion boundaries, and behavior for missing weekly reports or replacement IEPs.
3. Finalize the responsibility matrix, including Unit Head, Director, publication, correction, withdrawal, and the precise teacher/PIC incompatibility rule.
4. Specify how many editorial passes are mandatory and when change requests invalidate prior approvals.
5. Confirm batch partial-success semantics after the explanation in section 4.
6. Define rule mappings and approve representative individualization examples.
7. Define notification/delivery expectations and PDF-readiness behavior at publication.
8. Agree on cohort size, template limits, media limits, render performance targets, and migration volume before estimating delivery.

## 13. Validation expectations

Implementation acceptance should cover:

- deterministic generation, missing evidence, and preserved teacher edits;
- semester subject versus Monthly whole-report review;
- return permissions, required feedback, concurrency, and stale approvals;
- batch partial failures and retry safety;
- IEP evidence eligibility and source-version provenance;
- cross-organization and unauthorized-child denial across lists, details, media, and PDFs;
- exclusion of drafts/internal comments from family responses;
- immutable publication and explicit corrections;
- A4/16:9 output, mobile accessibility, long text, image failures, and overflow;
- worker retry/recovery and private artifact retention;
- reconciled migration and database/media restore rehearsal.

This document does not claim these checks currently pass.
