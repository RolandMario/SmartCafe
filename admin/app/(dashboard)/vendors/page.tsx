"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type {
  DataCatalogInfo,
  DataSyncStatus,
  ServiceType,
  VendorBalance,
  VendorOverview,
  VendorProviderName,
} from "@/lib/types";

const SERVICES: ServiceType[] = ["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "WAEC", "JAMB", "SMS"];

const PROVIDER_LABEL: Record<string, string> = {
  mock: "Mock",
  vtpass: "VTPass",
  ebulksms: "eBulkSMS",
  pairgate: "Pairgate",
  peyflex: "Peyflex",
  all: "Pairgate + VTPass + Peyflex",
};

const PROVIDER_DESC: Record<string, string> = {
  mock: "Simulated vendor for local development & demos",
  vtpass: "Live airtime / data / cable / electricity / WAEC / JAMB / SMS",
  ebulksms: "Bulk SMS only",
  pairgate: "Live data bundles (CG / SME / Gifting / AWOOF) — catalog keeps both vendors' plans; toggle individual plans on the Catalog page",
  peyflex: "Live airtime / data / electricity — disabled by default; pin a service to peyflex here to route it. Its DATA plans join the combined catalog once seeded",
};

const ngn = (n: number) => "₦" + (n || 0).toLocaleString("en-NG");

const CATALOG_BADGE: Record<DataCatalogInfo["source"], { label: string; cls: string }> = {
  pairgate: { label: "Pairgate plans", cls: "bg-emerald-100 text-emerald-700" },
  vtpass: { label: "VTPass plans", cls: "bg-blue-100 text-blue-700" },
  peyflex: { label: "Peyflex plans", cls: "bg-violet-100 text-violet-700" },
  mixed: { label: "Mixed plans", cls: "bg-amber-100 text-amber-700" },
  empty: { label: "No DATA plans", cls: "bg-red-100 text-red-700" },
};

function syncStatusText(s: DataSyncStatus | undefined): string {
  if (!s || s.state === "idle") return "No catalog sync has run in this session.";
  const src = PROVIDER_LABEL[s.source ?? ""] ?? s.source ?? "the provider";
  if (s.state === "syncing") {
    return `Re-seeding from ${src}… usually a few seconds — purchases are paused meanwhile.`;
  }
  if (s.state === "error") {
    return `Last sync from ${src} failed: ${s.message ?? "unknown error"}`;
  }
  const at = s.finishedAt ? new Date(s.finishedAt).toLocaleTimeString() : "";
  return `Last synced ${s.synced ?? 0} plans · pruned ${s.removed ?? 0} from ${src}${at ? ` at ${at}` : ""}.`;
}

export default function VendorsPage() {
  const [overview, setOverview] = useState<VendorOverview | null>(null);
  const [balances, setBalances] = useState<VendorBalance[]>([]);
  const [drafts, setDrafts] = useState<Record<string, VendorProviderName>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, bal] = await Promise.all([
        apiFetch<VendorOverview>("/admin/vendors"),
        apiFetch<VendorBalance[]>("/admin/vendors/balance"),
      ]);
      setOverview(ov);
      setBalances(bal);
      const next: Record<string, VendorProviderName> = {};
      for (const c of ov.configs) next[c.service] = c.provider;
      setDrafts(next);
      setError("");
      setMessage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const supports = (service: ServiceType, provider: VendorProviderName): boolean =>
    overview?.providers.find((p) => p.name === provider)?.supportedServices.includes(service) ?? false;

  const save = async (service: ServiceType) => {
    setSaving(service);
    setError("");
    setMessage("");
    try {
      await apiFetch("/admin/vendors", {
        method: "PATCH",
        body: JSON.stringify({ service, provider: drafts[service] }),
      });
      await load();
      // Toast after load() — load() clears transient messages on completion.
      setMessage(`${PROVIDER_LABEL[drafts[service]] ?? drafts[service]} enabled for ${service}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const resync = async () => {
    setSaving("DATA_SYNC");
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ dataSync: DataSyncStatus; dataCatalog: DataCatalogInfo }>(
        "/admin/vendors/refresh-data",
        { method: "POST" },
      );
      await load();
      const s = res.dataSync;
      if (s.state === "done") {
        setMessage(
          `DATA catalog re-seeded — ${s.synced ?? 0} plans synced${s.removed ? `, ${s.removed} pruned` : ""} from ${PROVIDER_LABEL[s.source ?? ""] ?? s.source ?? "the provider"}.`,
        );
      } else if (s.state === "error") {
        setError(`DATA sync failed: ${s.message ?? "unknown error"}`);
      } else {
        setMessage("DATA plan sync is still running — the status below updates as it completes.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resync failed");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading vendors…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendor providers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Route each service to its own vendor. Changes apply immediately.
          </p>
        </div>
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
      {message ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">{message}</div>
      ) : null}
<div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Per-service routing</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Global default is <span className="font-medium">{overview?.globalDefault}</span> — other services keep it
            unless changed here; DATA defaults to <span className="font-medium">pairgate</span>.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">Service</th>
              <th className="px-5 py-3">Provider</th>
              <th className="px-5 py-3">Compatibility</th>
              <th className="px-5 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {SERVICES.map((service) => {
              const cur = overview?.configs.find((c) => c.service === service);
              const selected = drafts[service] ?? cur?.provider ?? "mock";
              const supported = supports(service, selected);
              const dirty = selected !== cur?.provider;
              return (
                <tr key={service} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{service}</td>
                  <td className="px-5 py-3">
                    <select
                      value={selected}
                      onChange={(e) => setDrafts({ ...drafts, [service]: e.target.value as VendorProviderName })}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    >
                      {(overview?.providers ?? []).map((p) => (
                        <option key={p.name} value={p.name}>
                          {PROVIDER_LABEL[p.name] ?? p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-3">
                    {supported ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        Supported
                      </span>
                    ) : (
                      <span
                        className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700"
                        title="Purchases will fail — this provider does not fulfil this service"
                      >
                        Not supported by {PROVIDER_LABEL[selected] ?? selected}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => void save(service)}
                      disabled={!dirty || saving !== null}
                      className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {saving === service ? "Saving…" : dirty ? "Save" : "Saved"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">DATA catalog</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Every data vendor's bundles live in one combined list — mobile shows only plans marked Active
            (use the Catalog page toggles to show/hide). Each plan is debited to its own vendor on purchase.
          </p>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              {(() => {
                const info = overview?.dataCatalog;
                const badge = CATALOG_BADGE[info?.source ?? "empty"];
                return (
                  <>
                    <p className="text-sm text-slate-700">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>{" "}
                      <span className="font-semibold">{info?.total ?? 0} bundles</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {info?.pairgate ?? 0} Pairgate · {info?.peyflex ?? 0} Peyflex · {info?.vtpass ?? 0} VTPass/static
                    </p>
                  </>
                );
              })()}
            </div>
            <button
              onClick={() => void resync()}
              disabled={saving !== null}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving === "DATA_SYNC" ? "Syncing…" : "Re-sync all DATA plans"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-600">{syncStatusText(overview?.dataSync)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Registered providers</h2>
          <div className="mt-3 space-y-3">
            {(overview?.providers ?? []).map((p) => (
              <div key={p.name} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {PROVIDER_LABEL[p.name] ?? p.name}
                    {p.name === overview?.globalDefault ? (
                      <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        global default
                      </span>
                    ) : null}
                    {p.name === "peyflex" ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        disabled by default
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{PROVIDER_DESC[p.name]}</p>
                </div>
                <div className="flex flex-wrap gap-1 justify-end max-w-[15rem]">
                  {p.supportedServices.map((s) => (
                    <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Provider balances</h2>
          <div className="mt-3 space-y-2">
            {balances.length === 0 ? (
              <p className="text-sm text-slate-400">No balances available.</p>
            ) : (
              balances.map((b) => (
                <div key={b.provider} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-700">{PROVIDER_LABEL[b.provider] ?? b.provider}</span>
                  <span className="text-sm font-semibold text-slate-900">{ngn(b.balance)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
