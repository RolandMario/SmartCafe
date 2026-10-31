"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, isAuthenticated } from "@/lib/api";

const links = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/profits", label: "Profits", icon: "📈" },
  { href: "/transactions", label: "Transactions", icon: "🧾" },
  { href: "/users", label: "Users", icon: "👥" },
  { href: "/catalog", label: "Catalog", icon: "🛒" },
  { href: "/vendors", label: "Vendors", icon: "🔌" },
  { href: "/payment-gateways", label: "Payments", icon: "💳" },
  { href: "/funding", label: "Funding", icon: "💰" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) {
    return <p className="p-8 text-sm text-slate-500">Checking session…</p>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 text-lg font-bold">⚡ VTU Hub</div>
        <nav className="flex-1 px-3 space-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-lg px-3 py-2 text-sm ${
                pathname === l.href ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {l.icon} {l.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            clearSession();
            router.push("/login");
          }}
          className="m-3 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}