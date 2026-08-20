"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavTab {
  label: string;
  href: string;
  disabled?: boolean;
}

const DEFAULT_TABS: NavTab[] = [
  { label: "Home", href: "/home" },
  { label: "Link", href: "/links" },
  { label: "Collection", href: "/collections" },
  { label: "Itinerary", href: "/itineraries" },
];

interface NavTabsProps {
  className?: string;
  tabs?: NavTab[];
}

function NavTabs({ className, tabs = DEFAULT_TABS }: NavTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "navbar-tabs inline-flex items-center gap-1 rounded-full p-2",
        className
      )}
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="outline-none"
            aria-disabled={tab.disabled || undefined}
            tabIndex={tab.disabled ? -1 : undefined}
          >
            {/* Tab Item — text-weight states only (Figma NavTabItem 576:10), no fill/shadow/underline */}
            <span
              className={cn(
                "navbar-tab-item inline-flex items-center justify-center px-3 py-2 rounded-full type-body-2 transition-colors",
                tab.disabled && "pointer-events-none opacity-50",
                isActive
                  ? "navbar-tab-item--active font-semibold text-content"
                  : "navbar-tab-item--inactive font-normal text-content-secondary hover:font-medium hover:text-content"
              )}
            >
              {/* Width reserve to prevent layout shift on font-weight change */}
              <span className="navbar-tab-label relative">
                <span aria-hidden className="invisible font-semibold">{tab.label}</span>
                <span className="absolute inset-0 flex items-center justify-center">{tab.label}</span>
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export { NavTabs };
export type { NavTabsProps, NavTab };
