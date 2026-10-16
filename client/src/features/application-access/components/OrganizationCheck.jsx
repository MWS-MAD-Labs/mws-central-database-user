// Whether the application sends the Organization ID Central made, from its .env, when it calls Central.
export function OrganizationCheck({ organization }) {
  if (!organization) return null;
  if (organization.check === "matches") return <span className="font-semibold text-[#3b5d36]">Matches</span>;
  if (organization.check === "mismatch") {
    return (
      <span className="font-semibold text-[#a43c41]">
        Does Not Match, it sent <span className="font-mono text-xs">{organization.reported}</span>
      </span>
    );
  }
  return <span className="text-(--mws-muted)">Not Reported Yet. Add CENTRAL_ORGANIZATION_ID to its .env and restart it.</span>;
}
