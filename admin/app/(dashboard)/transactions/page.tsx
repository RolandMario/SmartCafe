"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Paged, Transaction } from "@/lib/types";

const ngn = (n: number) => "₦" + (n || 0).toLocaleString("en-NG");
const statusColor: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
};
const SERVICES = ["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "WAEC", "JAMB", "SMS"];

export default function TransactionsPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [service, setService] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (service) params.set("service", service);
      if (status) params.set("status", status);
      const data = await apiFetch<Paged<Transaction>>(`/admin/transactions?${params}`);
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(1, Math.ceil(data.total / data.limit)));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [service, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const requery = async (id: string) => {
    try {
      await apiFetch(`/admin/transactions/${id}/requery`, { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Requery failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={service}
          onChange={(e) => {
            setService(e.target.value);
            setPage(1);
            setExpanded(null);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All services</option>
          {SERVICES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
            setExpanded(null);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Profit</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((t) => (
              <tr key={t._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button
                    onClick={() => setExpanded(expanded === t._id ? null : t._id)}
                    className="font-mono text-xs text-blue-700 hover:underline"
                  >
                    {t.reference}
                  </button>
                </td>
                <td className="px-4 py-3 font-medium text-slate-800">{t.service}</td>
                <td className="px-4 py-3 text-slate-600">{t.user?.name ?? "—"}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{ngn(t.amount)}</td>
                <td
                  className={`px-4 py-3 text-right font-semibold ${
                    t.providerCost != null
                      ? t.amount - t.providerCost >= 0
                        ? "text-emerald-700"
                        : "text-red-700"
                      : "text-slate-400"
                  }`}
                >
                  {t.providerCost != null ? ngn(t.amount - t.providerCost) : "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor[t.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {t.status === "pending" ? (
                    <button
                      onClick={() => void requery(t._id)}
                      className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600"
                    >
                      Requery
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  No transactions found
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} · {total} transactions · 20 per page
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
              setExpanded(null);
              setPage((p) => Math.max(1, p - 1));
            }}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              onClick={() => {
              setExpanded(null);
              setPage((p) => Math.min(totalPages, p + 1));
            }}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="rounded-xl bg-white border border-slate-200 p-5 text-sm">
          {(() => {
            const t = items.find((x) => x._id === expanded);
            if (!t) return null;
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <DetailRow label="Request ID" value={t.meta?.requestId ? String(t.meta.requestId) : "—"} mono />
                <DetailRow label="Phone" value={t.meta?.phone ? String(t.meta.phone) : "—"} />
                <DetailRow label="Provider" value={t.meta?.providerLabel ? String(t.meta.providerLabel) : "—"} />
                <DetailRow label="Vendor cost" value={t.providerCost != null ? ngn(t.providerCost) : "—"} />
                <DetailRow label="Failure reason" value={t.failureReason ?? "—"} />
                <DetailRow label="Electricity token" value={t.providerMeta?.mainToken ?? t.providerMeta?.token ?? "—"} mono />
                <DetailRow label="Electricity units" value={t.providerMeta?.units != null ? String(t.providerMeta.units) : "—"} />
                <DetailRow label="WAEC PIN" value={t.providerMeta?.pin ?? "—"} mono />
                <DetailRow label="Serial" value={t.providerMeta?.serial ?? "—"} mono />
                <DetailRow label="Customer name" value={t.providerMeta?.customerName ?? "—"} />
              </div>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}