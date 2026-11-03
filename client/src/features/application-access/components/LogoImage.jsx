import { useQuery } from "@tanstack/react-query";
import { applicationLogosApi } from "../api/applicationLogosApi.js";
import { cn } from "../../../lib/cn.js";

// A logo of the master data. Every logo is square and the same size, so it only needs the size it is drawn at.
export function LogoImage({ id, version = 1, alt = "", size = 40, className }) {
  const { data } = useQuery({
    queryKey: ["application-access", "logo-image", id, version],
    queryFn: () => applicationLogosApi.image(id),
    staleTime: Infinity,
    enabled: Boolean(id),
  });
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg", className)}
      style={{ width: size, height: size }}
    >
      {data ? <img src={data} alt={alt} width={size} height={size} className="size-full object-contain" /> : null}
    </span>
  );
}
