"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type {
  Dashboard as DashboardData,
  DataPlanPlanTotal,
  DataPlanRange,
  DataPlanSales,
  DataPlanSeriesPoint,
  Transaction,
} from "@/lib/types";

const ngn = (n: number) => "₦" + (n || 0).toLocaleString("en-NG");
const statusColor: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};
const providerLabel: Record<string, string> = {
  mock: "Mock",
  vtpass: "VTPass",
  ebulksms: "eBulkSMS",
  pairgate: "Pairgate",
  peyflex: "Peyflex",
};

const PLAN_RANGES: { key: DataPlanRange; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

/** Stable palette for the N most-purchased plans; anything else folds into "Other". */
const PLAN_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-lime-500",
];
const OTHER_COLOR = "bg-slate-300";

type PlanMetric = "count" | "price";

const bucketLabel = (bucket: string) => {
  const parts = bucket.split("-").map(Number);
  if (parts.length === 2) {
    // Monthly bucket (%Y-%m)
    return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-GB", { month: "short" });
  }
  // Daily bucket (%Y-%m-%d)
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
};

interface ChartSegment {
  key: string;
  label: string;
  value: number;
  count: number;
  revenue: number;
  color: string;
}

interface ChartColumn extends DataPlanSeriesPoint {
  segs: ChartSegment[];
  total: number;
}

/** Build stacked-bar data for a series: top plans keep stable colours, the rest → "Other". */
function buildColumns(
  series: DataPlanSeriesPoint[] | undefined,
  featured: DataPlanPlanTotal[],
  colorByKey: Map<string, string>,
  metric: PlanMetric,
): ChartColumn[] {
  if (!series) return [];
  const featuredKeys = new Set(featured.map((p) => p.key));

  return series.map((pt) => {
    const segs: ChartSegment[] = [];
    let otherCount = 0;
    let otherRevenue = 0;

    for (const p of featured) {
      const d = pt.plans[p.key];
      if (!d) continue;
      segs.push({
        key: p.key,
        label: p.label,
        value: metric === "price" ? d.revenue : d.count,
        count: d.count,
        revenue: d.revenue,
        color: colorByKey.get(p.key) ?? OTHER_COLOR,
      });
    }
    for (const [key, d] of Object.entries(pt.plans)) {
      if (featuredKeys.has(key)) continue;
      otherCount += d.count;
      otherRevenue += d.revenue;
    }
    if (otherCount > 0) {
      segs.push({
        key: "__other__",
        label: "Other plans",
        value: metric === "price" ? otherRevenue : otherCount,
        count: otherCount,
        revenue: otherRevenue,
        color: OTHER_COLOR,
      });
    }

    const total = segs.reduce((sum, s) => sum + s.value, 0);
    return { ...pt, segs, total };
  });
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const [planData, setPlanData] = useState<DataPlanSales | null>(null);
  const [planError, setPlanError] = useState("");
  const [planRange, setPlanRange] = useState<DataPlanRange>("30d");
  const [planMetric, setPlanMetric] = useState<PlanMetric>("count");

  useEffect(() => {
    apiFetch<DashboardData>("/admin/dashboard")
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<DataPlanSales>(`/admin/data-plan-sales?range=${planRange}`)
      .then((res) => {
        if (!cancelled) {
          setPlanError("");
          setPlanData(res);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setPlanError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [planRange]);

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
    );
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Loading dashboard…</p>;
  }

  const maxVolume = Math.max(1, ...data.byService.map((s) => s.volume));

  const stats = [
    { label: "Total users", value: data.totalUsers.toLocaleString(), tint: "bg-blue-500" },
    { label: "Volume (successful)", value: ngn(data.totals.volume), tint: "bg-emerald-500" },
    { label: "Commission earned", value: ngn(data.totals.commission), tint: "bg-violet-500" },
    { label: "Successful txn count", value: data.totals.count.toLocaleString(), tint: "bg-amber-500" },
    { label: "Pending", value: data.counts.pending.toLocaleString(), tint: "bg-amber-400" },
    { label: "Failed", value: data.counts.failed.toLocaleString(), tint: "bg-red-500" },
  ];

  // ---- Data plan chart ----
  const featuredPlans = planData?.plans.slice(0, PLAN_COLORS.length) ?? [];
  const colorByKey = new Map(featuredPlans.map((p, i) => [p.key, PLAN_COLORS[i]]));
  const columns = buildColumns(planData?.series, featuredPlans, colorByKey, planMetric);
  const maxBucket = Math.max(1, ...columns.map((c) => c.total));
  const labelStep = Math.max(1, Math.ceil(columns.length / 12));

  const rankedPlans = planData
    ? [...planData.plans]
        .sort((a, b) =>
          planMetric === "price"
            ? b.revenue - a.revenue || b.count - a.count
            : b.count - a.count || b.revenue - a.revenue,
        )
        .slice(0, 8)
    : [];

  const planSection = (() => {
    if (planError) {
      return (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {planError}
        </div>
      );
    }
    if (!planData || planData.range !== planRange) {
      if (planData) {
        return (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            Loading data plan sales…
          </div>
        );
      }
      return <p className="text-sm text-slate-500">Loading data plan sales…</p>;
    }
    if (columns.length === 0) {
      return <p className="text-sm text-slate-400">No successful data purchases in this period.</p>;
    }

    return (
      <>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            <span className="font-semibold text-slate-700">
              {planData.totals.count.toLocaleString()}
            </span>{" "}
            data purchases
          </span>
          <span>
            <span className="font-semibold text-slate-700">{ngn(planData.totals.revenue)}</span>{" "}
            revenue
          </span>
        </div>
        {/* Stacked bar chart: one bucket per column, top plans stacked by colour */}
        <div className="mt-4">
          <div className="flex items-end gap-1">
            {columns.map((col, idx) => (
              <div key={col.bucket} className="group relative flex-1 min-w-0">
                <div className="flex h-40 items-end">
                  <div
                    className="flex w-full flex-col-reverse rounded-t-sm bg-slate-100"
                    style={{ height: `${Math.max(2, (col.total / maxBucket) * 100)}%` }}
                  >
                    {col.segs.map((s) => (
                      <div
                        key={s.key}
                        className={s.color}
                        style={{ height: `${(s.value / Math.max(1, col.total)) * 100}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-1 truncate text-center text-[10px] text-slate-400">
                  {idx % labelStep === 0 || idx === columns.length - 1
                    ? bucketLabel(col.bucket)
                    : "\u00A0"}
                </div>

                {/* Hover tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-56 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-2 text-[11px] text-white shadow-lg group-hover:block">
                  <p className="mb-1 font-semibold">{bucketLabel(col.bucket)}</p>
                  {col.segs.map((s) => (
                    <p key={s.key} className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.label}</span>
                      <span className="shrink-0 font-medium">
                        {s.count} · {ngn(s.revenue)}
                      </span>
                    </p>
                  ))}
                  <p className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 pt-1">
                    <span>Total</span>
                    <span className="font-semibold">
                      {col.count} · {ngn(col.revenue)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {planMetric === "count"
                ? "Segments scale by purchases"
                : "Segments scale by revenue"}
            </span>
            <span className="text-slate-300">hover a bar for the breakdown</span>
          </div>
        </div>
        {/* Legend: top plans with colours + lifetime count/revenue */}
        <div className="mt-4 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {featuredPlans.map((p) => (
            <div key={p.key} className="flex items-center gap-2 text-xs text-slate-600">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${colorByKey.get(p.key)}`} />
              <span className="truncate" title={p.label}>
                {p.label}
              </span>
              <span className="ml-auto shrink-0 text-slate-400">
                {p.count.toLocaleString()} · {ngn(p.revenue)}
              </span>
            </div>
          ))}
          {planData.plans.length > featuredPlans.length ? (
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${OTHER_COLOR}`} />
              <span
                className="truncate"
                title={`${planData.plans.length - featuredPlans.length} less-purchased plans`}
              >
                Other plans ({planData.plans.length - featuredPlans.length})
              </span>
            </div>
          ) : null}
        </div>

        {/* Top plans table, ranked by the active metric (count or price) */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Top plans by {planMetric === "price" ? "revenue" : "purchases"}
          </h3>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-slate-400">
              <tr>
                <th className="pb-2 pr-2 font-medium">Plan</th>
                <th className="pb-2 pr-2 text-right font-medium">Purchases</th>
                <th className="pb-2 pr-2 text-right font-medium">Revenue</th>
                <th className="pb-2 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {rankedPlans.map((p, i) => {
                const metricTotal =
                  planMetric === "price" ? planData.totals.revenue : planData.totals.count;
                const metricValue = planMetric === "price" ? p.revenue : p.count;
                const share = metricTotal > 0 ? (metricValue / metricTotal) * 100 : 0;
                return (
                  <tr key={p.key} className="border-t border-slate-100">
                    <td className="max-w-0 py-2 pr-2">
                      <span className="mr-1.5 text-xs text-slate-400">{i + 1}</span>
                      <span className="font-medium text-slate-700" title={p.label}>
                        {p.label}
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-right text-slate-600">{p.count.toLocaleString()}</td>
                    <td className="py-2 pr-2 text-right text-slate-600">{ngn(p.revenue)}</td>
                    <td className="py-2 pl-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${colorByKey.get(p.key) ?? OTHER_COLOR}`}
                            style={{ width: `${Math.min(100, share)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs text-slate-400">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-1.5 justify-end">
          {data.vendorConfigs.map((c) => (
            <span
              key={c.service}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                c.supported ? "bg-slate-200 text-slate-600" : "bg-red-100 text-red-700"
              }`}
              title={c.supported ? undefined : `${providerLabel[c.provider] ?? c.provider} does not support ${c.service}`}
            >
              {c.service}: {providerLabel[c.provider] ?? c.provider}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Data plan sales over time */}
      <div className="rounded-xl bg-white border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Data plan sales over time</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="mr-1 flex gap-1.5">
              {(["count", "price"] as PlanMetric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setPlanMetric(m)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    planMetric === m
                      ? "bg-blue-600 text-white"
                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  By {m === "count" ? "count" : "price"}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {PLAN_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setPlanRange(r.key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    planRange === r.key
                      ? "bg-blue-600 text-white"
                      : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {planSection}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Volume by service</h2>
          <div className="mt-4 space-y-3">
            {data.byService.map((s) => (
              <div key={s._id}>
                <div className="flex justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{s._id}</span>
                  <span>{ngn(s.volume)} · {s.count} txns</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-blue-500"
                    style={{ width: `${Math.max(4, (s.volume / maxVolume) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {data.byService.length === 0 ? (
              <p className="text-sm text-slate-400">No successful transactions yet.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.recent.map((t: Transaction) => (
              <div key={t._id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {t.service} · {t.user?.name ?? "unknown"}
                  </p>
                  <p className="truncate text-xs text-slate-400">{t.reference}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-semibold text-slate-700">{ngn(t.amount)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor[t.status] ?? "bg-slate-100 text-slate-600"}`}>{t.status}</span>
                </div>
              </div>
            ))}
            {data.recent.length === 0 ? (
              <p className="text-sm text-slate-400">No recent activity.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}