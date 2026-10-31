"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Paged, User, UserDetail } from "@/lib/types";

const ngn = (n: number) => "\u20a6" + (n || 0).toLocaleString("en-NG");

const SERVICE_COLORS: Record<string, string> = {
  AIRTIME: "bg-blue-500",
  DATA: "bg-emerald-500",
  CABLE: "bg-violet-500",
  ELECTRICITY: "bg-amber-500",
  WAEC: "bg-rose-500",
  JAMB: "bg-cyan-500",
  SMS: "bg-orange-500",
};
const formatDate = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

export default function UsersPage() {
  const [items, setItems] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [walletBusy, setWalletBusy] = useState<"credit" | "debit" | null>(null);
  const [walletError, setWalletError] = useState("");
  const [walletTarget, setWalletTarget] = useState<"main" | "cashback">("main");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (appliedSearch) params.set("search", appliedSearch);
      const data = await apiFetch<Paged<User>>(`/admin/users?${params}`);
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(Math.max(1, Math.ceil(data.total / data.limit)));
      // When a delete removes the last row of a page, step back to the new last page.
      if (data.items.length === 0 && page > 1 && data.total > 0) {
        setPage(page - 1);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (u: User) => {
    try {
      const updated = await apiFetch<User>(`/admin/users/${u._id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      setSelected((prev) => (prev && prev._id === u._id ? { ...prev, ...updated } : prev));
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      if (detailOpen) setDetailError(msg);
      else setError(msg);
    }
  };

  /** Promote / demote a user (goal: mark accounts as resellers). Admins are protected server-side. */
  const changeRole = async (role: "user" | "reseller" | "admin") => {
    if (!selected || selected.role === role) return;
    const ok = window.confirm(
      `Change ${selected.name}'s role from "${selected.role}" to "${role}"? Resellers earn cashback at the reseller rate on every service.`,
    );
    if (!ok) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const updated = await apiFetch<User>(`/admin/users/${selected._id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      setSelected((prev) => (prev && prev._id === selected._id ? { ...prev, ...updated } : prev));
      await load();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Role update failed");
    } finally {
      setDetailBusy(false);
    }
  };

  const openUser = async (u: User) => {
    setDetailOpen(true);
    setSelected(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const data = await apiFetch<UserDetail>(`/admin/users/${u._id}`);
      setSelected(data);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    if (detailBusy || walletBusy) return;
    setDetailOpen(false);
    setSelected(null);
    setDetailError("");
    setWalletAmount("");
    setWalletNote("");
    setWalletError("");
    setWalletTarget("main");
  };

  const handleDelete = async () => {
    if (!selected) return;
    const ok = window.confirm(
      `Delete ${selected.name} permanently? This removes their wallet, transactions and funding records. This cannot be undone.`,
    );
    if (!ok) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      await apiFetch(`/admin/users/${selected._id}`, { method: "DELETE" });
      setSelected(null);
      setDetailOpen(false);
      await load();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDetailBusy(false);
    }
  };

  const adjustWallet = async (action: "credit" | "debit") => {
    if (!selected) return;
    const amount = Number(walletAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWalletError("Enter a valid amount greater than zero.");
      return;
    }
    const targetLabel = walletTarget === "cashback" ? "cashback account" : "main wallet";
    if (
      action === "debit" &&
      !window.confirm(
        `Debit ${ngn(amount)} from ${selected.name}'s ${targetLabel}? The funds are removed immediately and a ledger entry is written.`,
      )
    ) {
      return;
    }
    setWalletBusy(action);
    setWalletError("");
    try {
      await apiFetch(`/admin/users/${selected._id}/${action}`, {
        method: "POST",
        body: JSON.stringify({
          amount,
          note: walletNote.trim() || undefined,
          wallet: walletTarget,
        }),
      });
      const data = await apiFetch<UserDetail>(`/admin/users/${selected._id}`);
      setSelected(data);
      setWalletAmount("");
      setWalletNote("");
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "Wallet update failed");
    } finally {
      setWalletBusy(null);
    }
  };

  const purchased = (selected?.stats.items ?? []).filter((s) => s.count > 0);
  const maxVolume = Math.max(1, ...purchased.map((s) => s.volume));
  const totalSpent = purchased.reduce((sum, s) => sum + s.volume, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setAppliedSearch(search.trim());
                setPage(1);
              }
            }}
            placeholder="Search name, email, phone…"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => {
              setAppliedSearch(search.trim());
              setPage(1);
            }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((u) => (
              <tr
                key={u._id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => void openUser(u)}
              >
                <td className="px-4 py-3 font-medium text-slate-800">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.phone}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                      u.role === "admin"
                        ? "bg-violet-100 text-violet-700"
                        : u.role === "reseller"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      u.isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {u.isActive ? "Active" : "Disabled"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void openUser(u);
                      }}
                      className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      View
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleActive(u);
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium text-white ${
                        u.isActive ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"
                      }`}
                    >
                      {u.isActive ? "Disable" : "Enable"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No users found
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages} · {total} users · 20 per page
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

      {detailOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40" onClick={closeDetail} />
          <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
            <div className="bg-slate-900 px-5 py-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-base font-bold">
                    {selected?.name?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div>
                    {detailLoading ? (
                      <p className="text-sm text-slate-300">Loading user…</p>
                    ) : (
                      <>
                        <h2 className="text-lg font-bold leading-tight">{selected?.name}</h2>
                        <p className="text-xs text-slate-300">{selected?.email}</p>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={closeDetail}
                  className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {detailError ? (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{detailError}</div>
              ) : null}

              {detailLoading || !selected ? (
                <p className="py-10 text-center text-sm text-slate-400">Loading user detail…</p>
              ) : (
                <>
                  <section className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Profile</h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-xs text-slate-400">Phone</dt>
                        <dd className="font-medium text-slate-800">{selected.phone}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Role</dt>
                        <dd>
                          {selected.role === "admin" ? (
                            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium capitalize text-violet-700">
                              {selected.role}
                            </span>
                          ) : (
                            <select
                              value={selected.role}
                              disabled={detailBusy}
                              onChange={(e) =>
                                void changeRole(e.target.value as "user" | "reseller" | "admin")
                              }
                              className="rounded-lg border border-slate-300 px-2 py-1 text-sm capitalize disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="user">User</option>
                              <option value="reseller">Reseller</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Status</dt>
                        <dd>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              selected.isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                            }`}
                          >
                            {selected.isActive ? "Active" : "Disabled"}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Member since</dt>
                        <dd className="font-medium text-slate-800">{formatDate(selected.createdAt)}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-slate-400">User ID</dt>
                        <dd className="truncate font-mono text-xs text-slate-500">{selected._id}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-100">Wallet balance</h3>
                      <span className="text-xs font-medium text-blue-200">{selected.wallet.currency}</span>
                    </div>
                    <p className="mt-2 text-3xl font-bold">{ngn(selected.wallet.balance)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-3 text-sm">
                      <div>
                        <p className="text-xs text-blue-200">Cashback</p>
                        <p className="font-semibold">{ngn(selected.wallet.cashbackBalance)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-blue-200">Total purchases</p>
                        <p className="font-semibold">{selected.stats.total} · {ngn(totalSpent)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Wallet adjustment</h3>
                      <span className="text-xs text-slate-400">Admin credit / debit</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setWalletTarget("main")}
                        disabled={walletBusy !== null}
                        aria-pressed={walletTarget === "main"}
                        className={`rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          walletTarget === "main"
                            ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                            : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <span className="block text-xs font-semibold uppercase tracking-wide">Wallet</span>
                        <span className="block text-base font-bold">{ngn(selected.wallet.balance)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setWalletTarget("cashback")}
                        disabled={walletBusy !== null}
                        aria-pressed={walletTarget === "cashback"}
                        className={`rounded-lg border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                          walletTarget === "cashback"
                            ? "border-blue-600 bg-blue-50 font-medium text-blue-700"
                            : "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <span className="block text-xs font-semibold uppercase tracking-wide">Cashback</span>
                        <span className="block text-base font-bold">{ngn(selected.wallet.cashbackBalance)}</span>
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <input
                        inputMode="decimal"
                        value={walletAmount}
                        onChange={(e) => setWalletAmount(e.target.value)}
                        placeholder="Amount (₦)"
                        className="w-32 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                      <input
                        value={walletNote}
                        onChange={(e) => setWalletNote(e.target.value)}
                        placeholder="Note (optional)"
                        className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => void adjustWallet("credit")}
                        disabled={walletBusy !== null}
                        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {walletBusy === "credit"
                          ? "Crediting…"
                          : `Credit ${walletTarget === "cashback" ? "cashback" : "wallet"}`}
                      </button>
                      <button
                        onClick={() => void adjustWallet("debit")}
                        disabled={walletBusy !== null}
                        className="rounded-lg bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {walletBusy === "debit"
                          ? "Debiting…"
                          : `Debit ${walletTarget === "cashback" ? "cashback" : "wallet"}`}
                      </button>
                    </div>
                    {walletError ? (
                      <p className="mt-2 text-xs text-red-700">{walletError}</p>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        Credits add funds immediately. Debits are rejected when the selected balance is insufficient. Both write a ledger entry.
                      </p>
                    )}
                  </section>

                  <section className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Services purchased</h3>
                      <span className="text-xs text-slate-400">Count · amount</span>
                    </div>
                    {purchased.length === 0 ? (
                      <p className="mt-4 text-sm text-slate-400">No successful purchases yet.</p>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-100">
                        {purchased.map((s) => (
                          <div key={s.service} className="py-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2 font-medium text-slate-700">
                                <span className={`h-2.5 w-2.5 rounded-full ${SERVICE_COLORS[s.service] ?? "bg-slate-400"}`} />
                                {s.service}
                              </span>
                              <span className="text-slate-500">
                                {s.count} purchase{s.count === 1 ? "" : "s"} · {ngn(s.volume)}
                              </span>
                            </div>
                            <div className="mt-1.5 h-2.5 rounded-full bg-slate-100">
                              <div
                                className={`h-2.5 rounded-full ${SERVICE_COLORS[s.service] ?? "bg-slate-400"}`}
                                style={{ width: `${Math.max(3, (s.volume / maxVolume) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="flex flex-col gap-2.5">
                    <button
                      onClick={() => void toggleActive(selected)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
                        selected.isActive ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-500 hover:bg-emerald-600"
                      }`}
                    >
                      {selected.isActive ? "Disable user" : "Enable user"}
                    </button>
                    <button
                      onClick={() => void handleDelete()}
                      disabled={selected.role === "admin" || detailBusy}
                      className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
                        selected.role === "admin"
                          ? "cursor-not-allowed bg-slate-300"
                          : "bg-red-600 hover:bg-red-700"
                      }`}
                    >
                      {detailBusy ? "Deleting…" : "Delete user"}
                    </button>
                    {selected.role === "admin" ? (
                      <p className="text-center text-xs text-slate-400">Admin accounts cannot be deleted.</p>
                    ) : null}
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
