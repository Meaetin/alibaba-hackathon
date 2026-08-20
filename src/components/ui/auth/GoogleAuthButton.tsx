"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface GoogleAuthButtonProps extends ButtonPrimitive.Props {
  className?: string;
  loading?: boolean;
  children?: ReactNode;
}

function GoogleAuthButton({
  className,
  loading = false,
  children,
  disabled,
  ...props
}: GoogleAuthButtonProps) {
  return (
    <ButtonPrimitive
      className={cn(
        "google-auth-button",
        "group relative inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-full px-4",
        "border border-edge bg-surface",
        "type-body-2 font-medium text-content",
        "transition-[opacity,border-color,background-color] duration-[var(--motion-button-duration)] ease-[var(--motion-ease-standard)] outline-none select-none",
        "hover:opacity-85",
        "focus-visible:ring-3 focus-visible:ring-edge-strong",
        "active:opacity-70",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <>
          <Image
            src="/icons/google.svg"
            alt=""
            width={20}
            height={20}
            className="google-auth-button-logo size-5 shrink-0"
            aria-hidden="true"
          />
          <span className="relative">{children}</span>
        </>
      )}
    </ButtonPrimitive>
  );
}

export { GoogleAuthButton };
export type { GoogleAuthButtonProps };
