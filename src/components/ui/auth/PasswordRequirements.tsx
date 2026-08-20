"use client";

import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { PASSWORD_REQUIREMENTS } from "@/lib/auth/password-policy";

interface PasswordRequirementsProps {
  value: string;
  className?: string;
}

/**
 * Live checklist for the password policy. Renders nothing for an untouched
 * field so a fresh form doesn't open with a wall of unmet requirements.
 *
 * `aria-live="polite"` rather than assertive: the list updates on every
 * keystroke, and an assertive region would interrupt a screen reader
 * mid-character.
 */
function PasswordRequirements({ value, className }: PasswordRequirementsProps) {
  if (!value) return null;

  return (
    <ul
      data-region="auth-password-requirements"
      aria-live="polite"
      className={cn("flex flex-col gap-1 px-1", className)}
    >
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = requirement.test(value);
        return (
          <li
            key={requirement.id}
            className={cn(
              "type-body-4 flex items-center gap-1.5",
              met ? "text-content-success" : "text-content-tertiary"
            )}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center size-3.5",
                "[&_svg]:size-3.5 [&_svg]:shrink-0",
                met ? "text-glyph-success" : "text-glyph-disabled"
              )}
              aria-hidden="true"
            >
              {met ? <Check /> : <X />}
            </span>
            {requirement.label}
          </li>
        );
      })}
    </ul>
  );
}

export { PasswordRequirements };
