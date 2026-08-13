import { PieChart } from "@mui/x-charts/PieChart";
import { formatNumber } from "../utils/dashboardFormatters";

export function GenderMuiDonut({ title, rows }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const male = rows.find((row) => row.label === "Male")?.value || 0;
  const female = rows.find((row) => row.label === "Female")?.value || 0;

  const malePercentage = total > 0 ? ((male / total) * 100).toFixed(1) : 0;
  const femalePercentage = total > 0 ? ((female / total) * 100).toFixed(1) : 0;

  const pieData = [
    {
      id: 0,
      value: male,
      label: "Male",
      color: "var(--mws-burgundy)",
    },
    {
      id: 1,
      value: female,
      label: "Female",
      color: "#476b43",
    },
  ];

  return (
    <div className="flex h-full flex-col justify-between min-w-0 rounded-xl border border-[var(--mws-line)] bg-[var(--mws-soft)] p-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-bold text-[var(--mws-charcoal)]">
          {title}
        </p>
        <span className="text-xs font-semibold text-[var(--mws-muted)]">
          Total: {formatNumber(total)}
        </span>
      </div>

      {/* MUI Donut Chart Container */}
      <div className="my-auto flex h-48 w-full items-center justify-center">
        <PieChart
          series={[
            {
              data: pieData,
              innerRadius: 45,
              outerRadius: 70,
              paddingAngle: 3,
              cornerRadius: 5,
              highlightScope: { faded: "global", highlighted: "item" },
              faded: { innerRadius: 30, additionalRadius: -5, color: "gray" },
            },
          ]}
          height={180}
          margin={{ top: 10, bottom: 10, left: 10, right: 10 }}
          slotProps={{
            legend: { hidden: true }, // Legend kita bikin custom di bawah biar persis desain awal
          }}
        />
      </div>

      {/* Custom Legend & Stats */}
      <div className="grid grid-cols-2 gap-2 border-t border-[var(--mws-line)] pt-3 text-xs">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--mws-burgundy)] shrink-0" />
            <span className="font-semibold text-[var(--mws-muted)]">Male</span>
          </div>
          <span className="mt-1 font-display font-extrabold text-[var(--mws-charcoal)]">
            {formatNumber(male)} <span className="text-[10px] font-normal text-[var(--mws-muted)]">({malePercentage}%)</span>
          </span>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#476b43] shrink-0" />
            <span className="font-semibold text-[var(--mws-muted)]">Female</span>
          </div>
          <span className="mt-1 font-display font-extrabold text-[var(--mws-charcoal)]">
            {formatNumber(female)} <span className="text-[10px] font-normal text-[var(--mws-muted)]">({femalePercentage}%)</span>
          </span>
        </div>
      </div>
    </div>
  );
}