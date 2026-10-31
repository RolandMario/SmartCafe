"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { CashbackFundingConfig, Funding, Paged } from "@/lib/types";

const ngn = (n: number) => "₦" + n.toLocaleString("en-NG");
const statusColor: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  credited: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};
const providerBadge: Record<string, { cls: string; label: string }> = {
  paystack: { cls: "bg-purple-50 text-purple-700", label: "Paystack" },
  cashback: { cls: "bg-teal-50 text-teal-700", label: "Cashback" },
  manual: { cls: "bg-slate-100 text-slate-600", label: "Manual" },
};

export default function FundingPage() {
  const [items, setItems] = useState<Funding[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Cashback funding bonus rate (live, admin-editable).
  const [configPct, setConfigPct] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [configError, setConfigError] = useState("");
  const [configSaving, setConfigSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paged<Funding>>(`/funding/admin/list?page=${page}&limit=20`);
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(1, Math.ceil(data.total / data.limit)));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiFetch<CashbackFundingConfig>(
        "/funding/admin/cashback-config",
      );
      setConfigPct(String(data.percentage));
    } catch {
      // Non-fatal — the requests table still works without the config.
    }
  }, []);

  useEffect(() => {
    void load();
    void loadConfig();
  }, [load, loadConfig]);

  const saveConfig = async () => {
    const pct = Number(configPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setConfigError("Enter a percentage between 0 and 100");
      return;
    }
    setConfigSaving(true);
    setConfigError("");
    setConfigMessage("");
    try {
      await apiFetch("/funding/admin/cashback-config", {
        method: "PATCH",
        body: JSON.stringify({ percentage: pct }),
      });
      setConfigMessage(
        `Cashback funding bonus set to ${pct}% — applies to Cashback Funding requests approved from now on.`,
      );
      await load();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setConfigSaving(false);
    }
  };

  const act = async (id: string, action: "approve" | "reject") => {
    try {
      await apiFetch(`/funding/admin/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note: note[id] ?? "" }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Wallet funding</h1>
        <button
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-xl bg-white border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Cashback funding bonus</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              When you approve a Cashback Funding request, this % of the funded amount is also
              credited to the user&apos;s cashback wallet (spendable on future purchases, never
              withdrawable). 0 disables the bonus.
            </p>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveConfig();
            }}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={configPct}
              onChange={(e) => setConfigPct(e.target.value)}
              placeholder="0"
              className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
            <span className="text-sm text-slate-500">%</span>
            <button
              type="submit"
              disabled={configSaving}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {configSaving ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
        {configMessage ? (
          <p className="mt-2 text-xs text-emerald-700">{configMessage}</p>
        ) : null}
        {configError ? (
          <p className="mt-2 text-xs text-red-700">{configError}</p>
        ) : null}
      </div>

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Reference</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Transfer ref</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((f) => {
              const pct = Number(configPct);
              // Stored bonus wins (credited rows keep their credited value);
              // otherwise show what a fresh approval would grant at the current rate.
              const bonus =
                f.cashbackAmount ??
                (Number.isFinite(pct) && pct > 0
                  ? Math.round((f.amount * pct) / 100)
                  : 0);
              return (
                <tr key={f._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{f.reference}</td>
                  <td className="px-4 py-3 text-slate-600">{f.user?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {ngn(f.amount)}
                    {f.provider === "cashback" && bonus > 0 ? (
                      <span className="block text-xs font-normal text-teal-600">
                        +{ngn(bonus)} cashback
                      </span>
                    ) : null}
                  </td>
                <td className="px-4 py-3">
                  <span className="block font-mono text-xs text-slate-600">
                    {f.transferReference ?? "—"}
                  </span>
                  {f.provider === "cashback" && !f.transferReference ? (
                    <span className="text-[10px] text-amber-600">No ref keyed</span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      providerBadge[f.provider ?? "manual"]?.cls ??
                      "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {providerBadge[f.provider ?? "manual"]?.label ??
                      f.provider ??
                      "Manual"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor[f.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {f.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {f.status === "pending" ? (
                    <input
                      value={note[f._id] ?? ""}
                      onChange={(e) => setNote({ ...note, [f._id]: e.target.value })}
                      placeholder="Admin note…"
                      className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">{f.adminNote ?? "—"}</span>
                  )}
                </td>
                <td className="px-4 py-3 space-x-2">
                  {f.status === "pending" ? (
                    <>
                      <button
                        onClick={() => void act(f._id, "approve")}
                        className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                      >
                        Approve &amp; credit
                      </button>
                      <button
                        onClick={() => void act(f._id, "reject")}
                        className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">Processed</span>
                  )}
                </td>
              </tr>
              );
            })}
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                  No funding requests
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} · {total} requests · 20 per page
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}