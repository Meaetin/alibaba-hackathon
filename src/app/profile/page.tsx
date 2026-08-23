"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronRight,
  CreditCard,
  LogOut,
  Mail,
  Settings,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/primitives/Avatar";
import { Button } from "@/components/ui/primitives/Button";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useProfileQuery } from "@/hooks/queries/useProfileQuery";
import { createClient } from "@/lib/supabase/client";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

const PERSONA_STICKER = "/images/stickers/Plane.svg";

export default function ProfilePage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const userId = useSessionUserId();
  const { data: profile } = useProfileQuery(userId);

  const [signingOut, setSigningOut] = useState(false);

  const displayName = profile?.display_name || profile?.email?.split("@")[0] || "Guest";
  const email = profile?.email ?? "Not signed in";

  const handleSignOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/home");
  };

  return (
    <div
      className="profile-page flex flex-col items-center min-h-full px-6 pt-20 pb-16"
      data-region="profile-page"
    >
      {/* Hero */}
      <motion.div
        className="profile-hero flex flex-col items-center gap-4 mb-12"
        initial={prefersReducedMotion ? false : motionPresets.completionHandoff.initial}
        animate={prefersReducedMotion ? undefined : motionPresets.completionHandoff.animate}
        transition={motionTransitions.spatial}
        data-region="profile-hero"
      >
        <Avatar
          type={profile?.avatar_url ? "image" : "initial"}
          src={profile?.avatar_url ?? undefined}
          name={displayName}
          alt={displayName}
          size="lg"
          className="size-24 type-body-1"
        />
        <div className="flex flex-col items-center gap-1">
          <h1 className="type-title-2 font-semibold text-content">{displayName}</h1>
          <p className="type-body-3 text-content-secondary">{email}</p>
        </div>
      </motion.div>

      {/* Travel Persona CTA */}
      <motion.div
        className="profile-persona-cta w-full max-w-2xl mb-8"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ ...motionTransitions.spatial, delay: 0.05 }}
        data-region="profile-persona-cta"
      >
        <div className="relative flex items-center gap-4 rounded-2xl border border-edge-subtle bg-surface p-5 overflow-hidden">
          {/* Decorative gradient wash */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.04]"
            style={{
              background:
                "radial-gradient(ellipse 70% 120% at 10% 50%, var(--category-itinerary) 0%, transparent 60%)",
            }}
          />

          {/* Sticker */}
          <div className="profile-persona-sticker relative flex size-16 shrink-0 items-center justify-center drop-shadow-[0px_3.2px_3.2px_rgba(0,0,0,0.15)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={PERSONA_STICKER}
              alt=""
              className="size-full object-contain"
              draggable="false"
              aria-hidden="true"
            />
          </div>

          {/* Copy + CTA */}
          <div className="relative flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-glyph-secondary" />
              <span className="type-label-2 font-medium text-content-secondary uppercase tracking-wide">
                New
              </span>
            </div>
            <h2 className="type-body-1 font-semibold text-content">
              Discover Your Travel Persona
            </h2>
            <p className="type-body-3 text-content-secondary">
              Take a 12-question quiz to uncover your travel archetype and get personalized trip recommendations.
            </p>
          </div>

          <Button
            variant="primary"
            size="md"
            className="relative shrink-0"
            onClick={() => router.push("/quiz")}
          >
            Take Quiz
          </Button>
        </div>
      </motion.div>

      {/* Account */}
      <div
        className="profile-account w-full max-w-2xl rounded-2xl border border-edge-subtle bg-surface overflow-hidden"
        data-region="profile-account"
      >
        <div className="px-5 pt-4 pb-2">
          <span className="type-label-2 font-medium text-content-tertiary uppercase tracking-wide">
            Account
          </span>
        </div>

        {/* Email Row */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-edge-subtle">
          <Mail className="size-4 text-glyph-secondary" />
          <span className="type-body-2 text-content-secondary flex-1">Email</span>
          <span className="type-body-2 font-medium text-content truncate max-w-[200px]">
            {email}
          </span>
        </div>

        {/* Settings Row */}
        <button
          className="group flex w-full items-center gap-3 px-5 py-3 border-t border-edge-subtle transition-colors hover:bg-surface-alt"
          onClick={() => router.push("/settings")}
        >
          <Settings className="size-4 text-glyph-secondary" />
          <span className="type-body-2 font-medium text-content flex-1 text-left">Settings</span>
          <ChevronRight className="size-4 text-glyph-secondary transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Plan & Billing Row */}
        <button
          className="group flex w-full items-center gap-3 px-5 py-3 border-t border-edge-subtle transition-colors hover:bg-surface-alt"
          onClick={() => router.push("/billing")}
        >
          <CreditCard className="size-4 text-glyph-secondary" />
          <span className="type-body-2 font-medium text-content flex-1 text-left">Plan &amp; billing</span>
          <ChevronRight className="size-4 text-glyph-secondary transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Sign Out Row */}
        <button
          className={cn(
            "group flex w-full items-center gap-3 px-5 py-3 border-t border-edge-subtle transition-colors hover:bg-surface-error-subtle",
            signingOut && "opacity-50 pointer-events-none",
          )}
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut className="size-4 text-glyph-secondary group-hover:text-content-error" />
          <span className="type-body-2 font-medium text-content flex-1 text-left group-hover:text-content-error">
            {signingOut ? "Signing out…" : "Sign out"}
          </span>
        </button>
      </div>

      {/* Footer */}
      <p className="profile-footer type-label-2 text-content-placeholder mt-8" data-region="profile-footer">
        Argo — Your Itinerary Planner
      </p>
    </div>
  );
}
