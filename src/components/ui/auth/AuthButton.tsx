"use client";

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/primitives/Button";

interface AuthButtonProps extends Omit<ButtonProps, "variant" | "size" | "icon"> {
  className?: string;
  loading?: boolean;
  children?: ReactNode;
}

function AuthButton({
  className,
  loading = false,
  children,
  disabled,
  ...props
}: AuthButtonProps) {
  return (
    <Button
      variant="primary"
      size="md"
      className={cn("h-[44px] w-full rounded-full", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        children
      )}
    </Button>
  );
}

export { AuthButton };
export type { AuthButtonProps };
