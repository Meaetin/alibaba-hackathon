import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface NavbarLogoProps {
  className?: string;
  href?: string;
}

function NavbarLogo({ className, href = "/home" }: NavbarLogoProps) {
  return (
    <Link
      href={href}
      aria-label="Argo home"
      className={cn(
        "navbar-logo inline-flex items-center rounded-md outline-none",
        "focus-visible:ring-3 focus-visible:ring-action-brand-highlight/50",
        className
      )}
    >
      <Image
        src="/images/argo-icon.svg"
        alt="Argo"
        width={24}
        height={24}
        priority
      />
    </Link>
  );
}

export { NavbarLogo };
export type { NavbarLogoProps };
