"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { MarginCategory, ProfitRange, ProfitReport } from "@/lib/types";

const ngn = (n?: number | null) =>
  n == null ? "—" : "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 2 });
const pct = (n?: number) => (n == null ? "—" : `${n.toFixed(1)}%`);

const RANGES: { key: ProfitRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

export default function ProfitsPage() {
  const [range, setRange] = useState<ProfitRange>("all");
  const [data, setData] = useState<ProfitReport | null>(null);
  const [error, setError] = useState("");
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const load = useCallback(async (r: ProfitRange) => {
    try {
      const params = r === "all" ? "" : `?range=${r}`;
      const res = await apiFetch<ProfitReport>(`/admin/profits${params}`);
      setData(res);
      setOpenCategories(Object.fromEntries(res.margins.map((m) => [m.category, true])));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profits");
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const toggle = (category: string) =>
    setOpenCategories((o) => ({ ...o, [category]: !o[category] }));

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-slate-500">Loading profits…</p>;
  }

  const { totals, byCategory, margins, recent } = data;

  const stats = [
    { label: "Total sales", value: ngn(totals.sales), tint: "bg-blue-500" },
    { label: "Provider cost", value: ngn(totals.providerCost), tint: "bg-rose-500" },
    { label: "Total profit", value: ngn(totals.profit), tint: "bg-emerald-500" },
    { label: "Commission profit", value: ngn(totals.commission), tint: "bg-cyan-500" },
    { label: "Margin", value: pct(totals.margin), tint: "bg-violet-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Profits</h1>
        <div className="flex flex-wrap gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                range === r.key
                  ? "bg-blue-600 text-white"
                  : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-white border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">{s.label}</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      {totals.unmeasuredCount > 0 ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          {totals.unmeasuredCount.toLocaleString()} successful{" "}
          {totals.unmeasuredCount === 1 ? "transaction" : "transactions"} in this period have no
          recorded provider cost (older records) — their profit is not included above.
        </div>
      ) : null}

      {/* Realized profit by service */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">
            Profit by service (successful settlements)
          </h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3 text-right">Txns</th>
              <th className="px-4 py-3 text-right">Sales</th>
              <th className="px-4 py-3 text-right">Vendor cost</th>
              <th className="px-4 py-3 text-right">Profit</th>
              <th className="px-4 py-3 text-right">Commission</th>
              <th className="px-4 py-3 text-right">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {byCategory.map((c) => (
              <tr key={c.category}>
                <td className="px-4 py-3 font-medium text-slate-800">{c.category}</td>
                <td className="px-4 py-3 text-right text-slate-600">{c.count.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">{ngn(c.sales)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{ngn(c.providerCost)}</td>
                <td
                  className={`px-4 py-3 text-right font-semibold ${
                    c.profit >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {ngn(c.profit)}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{ngn(c.commission)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{pct(c.margin)}</td>
              </tr>
            ))}
            {byCategory.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No successful transactions in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
{/* Current live margins */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Current live margins</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sales price (admin set) − provider&apos;s current API price, per catalog product.
          </p>
        </div>
        <div className="divide-y divide-slate-100">
          {margins.map((m) => (
            <div key={m.category}>
              <button
                onClick={() => toggle(m.category)}
                className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-slate-50"
              >
                <span className="text-sm font-semibold text-slate-800">{m.category}</span>
                <span className="text-xs text-slate-500">
                  {ngn(m.profitTotal)} on {m.covered}/{m.total} priced · {m.total} products
                </span>
              </button>
              {openCategories[m.category] ? (
                <div className="px-5 pb-4">
                  <MarginTable category={m} />
                </div>
              ) : null}
            </div>
          ))}
          {margins.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-400">
              No products with fixed prices in the catalog.
            </p>
          ) : null}
        </div>
      </div>

      {/* Recent profitable transactions */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Recent successful transactions</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3 text-right">Sales</th>
              <th className="px-4 py-3 text-right">Vendor cost</th>
              <th className="px-4 py-3 text-right">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recent.map((t) => {
              const profit = t.providerCost != null ? t.amount - t.providerCost : null;
              return (
                <tr key={t._id}>
                  <td className="px-4 py-3 font-mono text-xs text-blue-700">{t.reference}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{t.service}</td>
                  <td className="px-4 py-3 text-slate-600">{t.user?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">{ngn(t.amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{ngn(t.providerCost)}</td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      profit != null && profit >= 0 ? "text-emerald-700" : "text-slate-400"
                    }`}
                  >
                    {profit != null ? ngn(profit) : "—"}
                  </td>
                </tr>
              );
            })}
            {recent.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No successful transactions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MarginTable({ category }: { category: MarginCategory }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-slate-400">
        <tr>
          <th className="py-2 pr-3">Product</th>
          <th className="py-2 px-3 text-right">Sales price</th>
          <th className="py-2 px-3 text-right">Provider price</th>
          <th className="py-2 pl-3 text-right">Margin</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {category.items.map((i) => (
          <tr key={i.productId}>
            <td className="py-2 pr-3">
              <span className="block font-medium text-slate-700">{i.name}</span>
              <span className="block text-xs text-slate-400">{i.productCode}</span>
            </td>
            <td className="py-2 px-3 text-right text-slate-600">{ngn(i.salesPrice)}</td>
            <td className="py-2 px-3 text-right text-slate-600">{ngn(i.providerPrice)}</td>
            <td
              className={`py-2 pl-3 text-right font-semibold ${
                i.margin != null && i.margin >= 0 ? "text-emerald-700" : "text-slate-400"
              }`}
            >
              {ngn(i.margin)}
            </td>
          </tr>
        ))}
        <tr className="bg-slate-50">
          <td className="py-2 pr-3 text-xs font-semibold text-slate-500 uppercase">
            Subtotal ({category.covered} priced)
          </td>
          <td className="py-2 px-3 text-right text-slate-700">{ngn(category.salesTotal)}</td>
          <td className="py-2 px-3 text-right text-slate-700">{ngn(category.providerTotal)}</td>
          <td className="py-2 pl-3 text-right font-semibold text-slate-800">
            {ngn(category.profitTotal)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}