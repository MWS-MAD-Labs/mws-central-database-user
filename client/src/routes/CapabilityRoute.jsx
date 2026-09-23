import { Outlet } from "react-router";
import { PageHeader } from "../components/layout/PageHeader.jsx";
import { PanelMessage } from "../components/ui/PanelMessage.jsx";
import { useAuth } from "../features/auth/hooks/useAuth.js";

export function CapabilityRoute({ allowed, title, description }) {
  const { user } = useAuth();

  if (!allowed(user)) {
    return (
      <div className="min-w-0">
        <PageHeader title={title} description={description} />
        <PanelMessage tone="error">
          Contact a Super Admin if this access is required for your work.
        </PanelMessage>
      </div>
    );
  }

  return <Outlet />;
}
