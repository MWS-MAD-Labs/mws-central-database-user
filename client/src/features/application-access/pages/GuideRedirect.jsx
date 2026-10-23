import { Navigate, useLocation, useParams } from "react-router";
import { START_GUIDE_PATH } from "../utils/startGuide.js";

// The old guide addresses open the Guides page, with the same part and the application of the address.
const PART_OF = { start: "how", troubleshooting: "problems" };

export function GuideRedirect() {
  const { applicationId } = useParams();
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  const part = query.get("part");
  if (part && PART_OF[part]) query.set("part", PART_OF[part]);
  if (applicationId) query.set("app", applicationId);
  const text = query.toString();
  return <Navigate to={`${START_GUIDE_PATH}${text ? `?${text}` : ""}`} replace />;
}
