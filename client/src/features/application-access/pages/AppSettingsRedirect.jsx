import { Navigate, useLocation, useParams } from "react-router";

// The old Settings address opens the application page. Without a tab it used to land on Overview.
export function AppSettingsRedirect() {
  const { applicationId } = useParams();
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  if (!query.get("tab")) query.set("tab", "overview");
  return <Navigate to={`/application-access/apps/${applicationId}?${query.toString()}`} replace />;
}
