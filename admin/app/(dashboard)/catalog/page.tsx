"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { CatalogItem, CatalogListResponse, ServiceType } from "@/lib/types";

const ngn = (n?: number) => (n == null ? "—" : "₦" + n.toLocaleString("en-NG"));
const SERVICES: ServiceType[] = ["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "WAEC", "JAMB", "SMS"];
const VENDORS = ["pairgate", "vtpass", "peyflex", "static"] as const;
type CatalogVendorFilter = "" | (typeof VENDORS)[number];

const emptyForm: Record<string, string> = {
  service: "AIRTIME",
  vendor: "static",
  provider: "",
  providerLabel: "",
  productCode: "",
  name: "",
  amount: "",
  minAmount: "",
  maxAmount: "",
  unitPrice: "",
  providerUnitCost: "",
  validityDays: "",
  commission: "0",
  resellerCommission: "0",
  sortOrder: "0",
};

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [serviceFilter, setServiceFilter] = useState<"" | ServiceType>("");
  const [vendorFilter, setVendorFilter] = useState<CatalogVendorFilter>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), perPage: "15" });
      if (serviceFilter) qs.set("service", serviceFilter);
      if (vendorFilter) qs.set("vendor", vendorFilter);
      const res = await apiFetch<CatalogListResponse>(`/admin/catalog?${qs.toString()}`);
      setItems(res.items);
      setTotalPages(res.totalPages);
      setTotal(res.total);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [page, serviceFilter, vendorFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (item: CatalogItem) => {
    setEditing(item);
    setMessage("");
    setForm({
      service: item.service,
      vendor: item.vendor ?? "static",
      provider: item.provider,
      providerLabel: item.providerLabel,
      productCode: item.productCode,
      name: item.name,
      amount: item.amount != null ? String(item.amount) : "",
      minAmount: item.minAmount != null ? String(item.minAmount) : "",
      maxAmount: item.maxAmount != null ? String(item.maxAmount) : "",
      unitPrice: item.unitPrice != null ? String(item.unitPrice) : "",
      providerUnitCost: item.providerUnitCost != null ? String(item.providerUnitCost) : "",
      validityDays: item.validityDays != null ? String(item.validityDays) : "",
      commission: String(item.commission ?? 0),
      resellerCommission: String(item.resellerCommission ?? 0),
      sortOrder: String(item.sortOrder ?? 0),
    });
  };

  const submit = async () => {
    setError("");
    setMessage("");
    const body = {
      ...form,
      amount: form.amount ? Number(form.amount) : undefined,
      minAmount: form.minAmount ? Number(form.minAmount) : undefined,
      maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
      unitPrice: form.unitPrice ? Number(form.unitPrice) : undefined,
      providerUnitCost: form.providerUnitCost ? Number(form.providerUnitCost) : undefined,
      validityDays: form.validityDays ? Number(form.validityDays) : undefined,
      commission: Number(form.commission || 0),
      resellerCommission: Number(form.resellerCommission || 0),
      sortOrder: Number(form.sortOrder || 0),
    };
    try {
      if (editing) {
        await apiFetch(`/admin/catalog/${editing._id}`, { method: "PATCH", body: JSON.stringify(body) });
        setMessage("Catalog item updated");
      } else {
        await apiFetch("/admin/catalog", { method: "POST", body: JSON.stringify(body) });
        setMessage("Catalog item created");
      }
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  };

  const toggleActive = async (item: CatalogItem) => {
    try {
      await apiFetch(`/admin/catalog/${item._id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !item.active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async (item: CatalogItem) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try {
      await apiFetch(`/admin/catalog/${item._id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Catalog</h1>
        {!editing ? (
          <button
            onClick={() => setForm(emptyForm)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            + New item
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : null}
      {message ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">{message}</div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl bg-white border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">Service</label>
              <select
                value={serviceFilter}
                onChange={(e) => {
                  setServiceFilter(e.target.value as "" | ServiceType);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                {SERVICES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <label className="text-xs font-medium text-slate-500">Vendor</label>
              <select
                value={vendorFilter}
                onChange={(e) => {
                  setVendorFilter(e.target.value as CatalogVendorFilter);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">All</option>
                {VENDORS.map((v) => (
                  <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                ))}
              </select>
            </div>
            <span className="text-xs text-slate-500">{total} item{total === 1 ? "" : "s"}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Price</th>
                <th className="px-4 py-3" title="Earned as cashback by the buyer on a successful purchase">Commission</th>
                <th className="px-4 py-3">Show</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item._id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                      {item.service}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="block">{item.provider}</span>
                    <span className="block text-[11px] text-slate-400">{item.productCode}</span>
                  </td>
                  <td className="px-4 py-3">
                    <VendorBadge vendor={item.vendor} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-slate-800">{ngn(item.amount ?? item.unitPrice)}</span>
                    {item.service === "SMS" && item.providerUnitCost != null ? (
                      <span className="block text-[11px] text-slate-400">provider cost {ngn(item.providerUnitCost)}/unit</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {(item.commission ?? 0) > 0 ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        +{item.commission}% cashback
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">—</span>
                    )}
                    {item.resellerCommission != null && item.resellerCommission > 0 ? (
                      <span className="ml-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                        reseller +{item.resellerCommission}%
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => void toggleActive(item)}
                      title={item.active ? "Hidden from users — click to show" : "Shown to users — click to hide"}
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {item.active ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-4 py-3 space-x-2">
                    <button onClick={() => startEdit(item)} className="text-xs text-blue-600 hover:underline">
                      Edit
                    </button>
                    <button onClick={() => void remove(item)} className="text-xs text-red-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    No catalog items
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages} · {total} items · 15 per page
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

<div className="rounded-xl bg-white border border-slate-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">{editing ? "Edit item" : "New item"}</h2>
          <SelectField label="Service" value={form.service} onChange={(v) => setForm({ ...form, service: v })} options={[...SERVICES]} />
          <SelectField label="Vendor" value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} options={[...VENDORS]} />
          <TextField label="Provider code" value={form.provider} onChange={(v) => setForm({ ...form, provider: v })} placeholder="mtn" />
          <TextField label="Provider label" value={form.providerLabel} onChange={(v) => setForm({ ...form, providerLabel: v })} placeholder="MTN Nigeria" />
          <TextField label="Product code" value={form.productCode} onChange={(v) => setForm({ ...form, productCode: v })} placeholder="mtn-1gb" />
          <TextField label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="MTN 1GB" />
          <TextField label="Amount (₦, fixed price)" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} placeholder="320" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Min amount" value={form.minAmount} onChange={(v) => setForm({ ...form, minAmount: v })} placeholder="50" />
            <TextField label="Max amount" value={form.maxAmount} onChange={(v) => setForm({ ...form, maxAmount: v })} placeholder="100000" />
          </div>
          <TextField label="Unit price (SMS)" value={form.unitPrice} onChange={(v) => setForm({ ...form, unitPrice: v })} placeholder="2.5" />
          <TextField label="Provider unit cost (SMS, for profits)" value={form.providerUnitCost} onChange={(v) => setForm({ ...form, providerUnitCost: v })} placeholder="2.0" />
          <TextField label="Validity (days, data bundles)" value={form.validityDays} onChange={(v) => setForm({ ...form, validityDays: v })} placeholder="30" />
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Commission (% of sale)" value={form.commission} onChange={(v) => setForm({ ...form, commission: v })} placeholder="0" />
            <TextField label="Reseller commission (% of sale)" value={form.resellerCommission} onChange={(v) => setForm({ ...form, resellerCommission: v })} placeholder="0" />
          </div>
          <TextField label="Sort order" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} placeholder="0" />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void submit()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {editing ? "Save changes" : "Create"}
            </button>
            {editing ? (
              <button
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function VendorBadge({ vendor }: { vendor?: CatalogItem["vendor"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pairgate: { label: "Pairgate", cls: "bg-emerald-100 text-emerald-700" },
    vtpass: { label: "VTPass", cls: "bg-blue-100 text-blue-700" },
    peyflex: { label: "Peyflex", cls: "bg-violet-100 text-violet-700" },
    static: { label: "Static", cls: "bg-amber-100 text-amber-700" },
  };
  const v = map[vendor ?? ""] ?? { label: vendor ?? "—", cls: "bg-slate-100 text-slate-500" };
  return (
    <button
      type="button"
      title={vendor ? `${v.label} debits this vendor account on purchase` : "Legacy plan — debits the pinned DATA vendor"}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.cls}`}
    >
      {v.label}
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
