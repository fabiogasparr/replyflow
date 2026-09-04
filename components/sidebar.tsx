"use client";

/**
 * Sidebar Navigation
 *
 * Text-only nav with active state and workspace section.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import BrandMark from "@/components/brand-mark";
import {
  DASHBOARD_NAV_ITEMS,
  type DashboardNavKey,
} from "@/lib/product";

const navIcons: Record<DashboardNavKey, React.ReactNode> = {
  dashboard: <path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" />,
  overview: <path d="M4 19V9m5 10V5m6 14v-7m5 7V3" />,
  inbox: <path d="M4 6h16v11H8l-4 4V6Zm4 4h8m-8 3h5" />,
  campaigns: <path d="m5 16 5-5m0 0 3-3 6 6-3 3-6-6Zm-5 5h4m11-15 2-2m3 6h3" />,
  logs: <path d="M6 4h12v16H6V4Zm4 4h4m-4 4h5m-5 4h3" />,
  settings: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />,
  diagnostics: <path d="M4 17h3l2-9 3 12 3-8 2 5h3M4 4h16v16H4V4Z" />,
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-72 max-w-[88vw] shrink-0 bg-[#112620] text-white border-r border-[#27433a] flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Same reason as the top bar: the drawer is full height, so the
            wordmark would otherwise land under the status bar. */}
        <div
          className="px-5 py-5 border-b border-[#27433a]"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <BrandMark href="/dashboard" tone="light" />
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Navegação principal">
          {DASHBOARD_NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={isActive ? "page" : undefined}
                className={`
                  group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors
                  ${
                    isActive
                      ? "bg-[#f5c451] text-[#112620] font-semibold"
                      : "text-[#b8c7c1] hover:text-white hover:bg-white/8"
                  }
                `}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className={`h-[18px] w-[18px] shrink-0 ${
                    item.key === "dashboard" ? "fill-current" : "fill-none stroke-current stroke-[1.7]"
                  }`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {navIcons[item.key]}
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#27433a] px-4 py-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#86a198]">
              Espaço de trabalho
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-white">{workspaceName}</p>
            <p className="mt-0.5 text-xs text-[#9eb2aa]">Ambiente seguro</p>
          </div>
        </div>
      </aside>
    </>
  );
}
