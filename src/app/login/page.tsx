"use client";

/**
 * `/login` — sign in and sign up on one screen.
 *
 * ## One screen, not two
 *
 * The two forms differ by one field and one endpoint, so they are one component
 * with a `mode`. Two routes would mean two copies of the same validation, the
 * same error rendering and the same redirect, kept in sync by hand.
 *
 * ## It carries the browser's anonymous persona across
 *
 * Any persona id in `localStorage` is sent with the credentials, and the server
 * attaches it to the new account if it belongs to nobody yet. That only matters
 * for a browser that took the quiz *before* this app had accounts — the quiz
 * needs a session now — but that is exactly the migration case, and losing
 * somebody's twelve answers to a sign-up form would be a poor welcome.
 *
 * ## The layout is deliberately bare
 *
 * No `MainLayout`, so there is no navbar with a profile menu on the page you
 * land on when you are not signed in.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Mail, User } from "lucide-react";

import { Button } from "@/components/ui/primitives/Button";
import { Input } from "@/components/ui/primitives/Input";
import { signIn, signUp, type Credentials } from "@/lib/api/auth";
import { getFriendlyAuthError } from "@/lib/errors/userMessages";
import { readPersonaId } from "@/lib/persona/storage";
import { queryClient } from "@/lib/query/queryClient";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; blurb: string; submit: string; switch: string }> = {
  signin: {
    title: "Welcome back",
    blurb: "Sign in to pick up your trips and your travel persona.",
    submit: "Sign in",
    switch: "New here? Create an account",
  },
  signup: {
    title: "Create your account",
    blurb: "Your itineraries and your travel persona are saved to it.",
    submit: "Create account",
    switch: "Already have an account? Sign in",
  },
};

const MIN_PASSWORD_LENGTH = 8;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Where the middleware wanted to send them before it found no cookie. Only a
  // path is honoured — an absolute URL here would be an open redirect, which is
  // a phishing primitive dressed as a convenience.
  const next = searchParams.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  const copy = COPY[mode];
  const canSubmit =
    email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH && !isSubmitting;

  // Switching mode must clear the error: "that email and password don't match an
  // account" sitting above a sign-up form reads as a rejection of the sign-up.
  useEffect(() => {
    setError(null);
  }, [mode]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;

      setIsSubmitting(true);
      setError(null);

      const credentials: Credentials = {
        email: email.trim(),
        password,
        ...(mode === "signup" && displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(readPersonaId() ? { personaId: readPersonaId() } : {}),
      };

      try {
        await (mode === "signup" ? signUp(credentials) : signIn(credentials));
        // Every cached query was answered for whoever was here before — often
        // nobody. Clearing is what stops the previous session's empty lists
        // being served to the person who just signed in.
        queryClient.clear();
        router.replace(destination);
      } catch (caught) {
        console.error(`[login] ${mode} failed`, caught);
        setError(getFriendlyAuthError(caught as { message?: string; status?: number }));
        setIsSubmitting(false);
      }
    },
    [canSubmit, destination, displayName, email, mode, password, router],
  );

  return (
    <main
      data-region="login-page"
      className="login-page flex min-h-dvh items-center justify-center bg-surface-alt px-6 py-12"
    >
      {/* Sign In Card */}
      <div
        data-region="login-card"
        className="login-card w-full max-w-sm rounded-2xl border border-edge bg-surface p-8"
      >
        {/* Heading */}
        <div data-region="login-heading" className="login-heading mb-6">
          <h1 className="type-heading-2 text-content">{copy.title}</h1>
          <p className="mt-1 type-body-2 text-content-secondary">{copy.blurb}</p>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="login-form flex flex-col gap-3" noValidate>
          {mode === "signup" && (
            <Input
              icon={<User />}
              type="text"
              name="name"
              autoComplete="name"
              placeholder="Your name (optional)"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={isSubmitting}
              className="w-full"
            />
          )}

          <Input
            icon={<Mail />}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            className={cn("w-full", error && "border-edge-error")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
          />

          <Input
            icon={<Lock />}
            type="password"
            name="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={
              mode === "signup" ? `Password (${MIN_PASSWORD_LENGTH}+ characters)` : "Password"
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className={cn("w-full", error && "border-edge-error")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
          />

          {/* Error */}
          {error && (
            <p id="login-error" role="alert" className="type-body-3 text-content-error">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="md" disabled={!canSubmit} className="mt-1">
            {isSubmitting ? <Loader2 className="animate-spin" /> : null}
            {copy.submit}
          </Button>
        </form>

        {/* Mode Switch */}
        <button
          type="button"
          data-region="login-mode-switch"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          disabled={isSubmitting}
          className="login-mode-switch mt-4 w-full type-body-3 text-content-secondary underline-offset-4 hover:underline disabled:opacity-50"
        >
          {copy.switch}
        </button>
      </div>
    </main>
  );
}
