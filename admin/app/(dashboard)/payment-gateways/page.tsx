"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PaymentGatewayStatus, PaymentProvider } from "@/lib/types";

const GATEWAY_META: Record<PaymentProvider, { brand: string; tagline: string }> = {
  paystack: { brand: "Paystack", tagline: "Card, bank transfer & USSD hosted checkout" },
};

function badge(cls: string, label: string) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function PaymentGatewaysPage() {
  const [gateways, setGateways] = useState<PaymentGatewayStatus[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PaymentProvider | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PaymentGatewayStatus[]>("/admin/payment-gateways");
      setGateways(data);
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

  const toggle = async (gw: PaymentGatewayStatus, enabled: boolean) => {
    setSaving(gw.provider);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/admin/payment-gateways/${gw.provider}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      setMessage(
        `${GATEWAY_META[gw.provider]?.brand ?? gw.label} ${enabled ? "enabled" : "disabled"} for wallet funding.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading payment gateways…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payment gateways</h1>
          <p className="text-sm text-slate-500 mt-1">
            Users can fund their wallet through a gateway only while it is switched on. Changes apply immediately.
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {gateways.map((gw) => {
          const meta = GATEWAY_META[gw.provider];
          return (
            <div key={gw.provider} className="rounded-xl bg-white border border-slate-200 p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-900">{meta?.brand ?? gw.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{meta?.tagline ?? "Wallet funding gateway"}</p>
                </div>
                <div className="flex flex-col items-start gap-1">
                  {gw.active ? badge("bg-emerald-100 text-emerald-700", "Active") : null}
                  {!gw.configured ? badge("bg-amber-100 text-amber-700", "Not configured") : null}
                  {gw.configured && !gw.enabled ? badge("bg-red-100 text-red-700", "Disabled") : null}
                </div>
              </div>

              {!gw.configured ? (
                <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  No API credentials are set on the backend for this gateway, so users cannot use it even when
                  switched on. Add the <code className="font-mono">{gw.provider.toUpperCase()}_*</code> env
                  variables and restart the backend.
                </p>
              ) : null}

              <button
                type="button"
                role="switch"
                aria-checked={gw.enabled}
                disabled={saving !== null}
                onClick={() => void toggle(gw, !gw.enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  gw.enabled ? "bg-emerald-500" : "bg-slate-300"
                } ${saving === gw.provider ? "opacity-60" : ""}`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    gw.enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
              <span className="ml-2 text-sm text-slate-700">
                {saving === gw.provider ? "Saving…" : gw.enabled ? "Enabled" : "Disabled"}
              </span>
              <p className="mt-2 text-xs text-slate-400">
                A user sees this gateway in the app's Fund Wallet screen only while it is active.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}