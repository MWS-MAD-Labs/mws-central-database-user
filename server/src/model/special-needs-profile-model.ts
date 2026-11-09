import type { SpecialNeedType, StudentSpecialNeed, StudentSpecialNeedsProfile } from "../generated/prisma/client";
import type { AuditValue } from "./audit-log-model";
import { REDACTED_TEXT } from "../utils/sensitive-data";

export type SpecialNeedsProfileRequest = {
  needs: Array<{
    need_type: SpecialNeedType;
    description: string;
  }>;
  learning_support_summary?: string;
  accommodations?: string;
  has_professional_report?: boolean;
  report_date?: string;
  identified_date?: string;
};

export type SpecialNeedsProfileResponse = {
  id: string;
  student_id: string;
  needs: Array<{
    need_type: SpecialNeedType;
    description: string;
  }>;
  learning_support_summary: string | null;
  accommodations: string | null;
  has_professional_report: boolean;
  report_date: string | null;
  identified_date: string | null;
  updated_at: string;
};

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

export type SpecialNeedsProfileWithNeeds = StudentSpecialNeedsProfile & {
  needs: StudentSpecialNeed[];
};

export function toSpecialNeedsProfileResponse(profile: SpecialNeedsProfileWithNeeds): SpecialNeedsProfileResponse {
  return {
    id: profile.id,
    student_id: profile.student_id,
    needs: profile.needs.map((need) => ({
      need_type: need.need_type,
      description: need.description,
    })),
    learning_support_summary: profile.learning_support_summary,
    accommodations: profile.accommodations,
    has_professional_report: profile.has_professional_report,
    report_date: day(profile.report_date),
    identified_date: day(profile.identified_date),
    updated_at: profile.updated_at.toISOString(),
  };
}

// Effective eligibility: the legacy flag alone no longer allows new SE assignments.
export enum SpecialNeedsEligibilityStatus {
  NONE = "NONE",
  LEGACY_INCOMPLETE = "LEGACY_INCOMPLETE",
  PROFILED = "PROFILED",
}

export function specialNeedsEligibilityStatus(
  student: { sn: boolean; special_needs_profile?: { deleted_at: Date | null } | null },
): SpecialNeedsEligibilityStatus {
  if (!student.sn) return SpecialNeedsEligibilityStatus.NONE;
  const profile = student.special_needs_profile;
  return profile && !profile.deleted_at
    ? SpecialNeedsEligibilityStatus.PROFILED
    : SpecialNeedsEligibilityStatus.LEGACY_INCOMPLETE;
}

// Free text is fully redacted in audit snapshots, like health notes.
export function toSpecialNeedsProfileAuditSnapshot(profile: SpecialNeedsProfileWithNeeds, studentFullName?: string): AuditValue {
  return {
    student_id: profile.student_id,
    full_name: studentFullName ?? null,
    needs: profile.needs.map((need) => ({
      need_type: need.need_type,
      description: REDACTED_TEXT,
    })),
    learning_support_summary: profile.learning_support_summary ? REDACTED_TEXT : null,
    accommodations: profile.accommodations ? REDACTED_TEXT : null,
    has_professional_report: profile.has_professional_report,
    report_date: day(profile.report_date),
    identified_date: day(profile.identified_date),
    deleted_at: profile.deleted_at ? profile.deleted_at.toISOString() : null,
  };
}
