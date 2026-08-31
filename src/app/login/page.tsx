"use client";

import { Field } from "@base-ui/react/field";
import { Eye, EyeOff } from "lucide-react";
import { motion, type Variants } from "motion/react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AuthButton } from "@/components/ui/auth/AuthButton";
import { AuthInput } from "@/components/ui/auth/AuthInput";
import { signIn, signUp, type Credentials } from "@/lib/api/auth";
import { getFriendlyAuthError } from "@/lib/errors/userMessages";
import { readPersonaId } from "@/lib/persona/storage";
import { queryClient } from "@/lib/query/queryClient";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

const COPY: Record<Mode, { title: string; blurb: string; switch: string; submit: string }> = {
  signin: {
    title: "Welcome back",
    blurb: "Enter your credentials or",
    switch: "sign up",
    submit: "Sign in",
  },
  signup: {
    title: "Create an account",
    blurb: "Already have one?",
    switch: "Sign in",
    submit: "Create account",
  },
};

const MIN_PASSWORD_LENGTH = 8;

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

function AuthIllustrationPanel() {
  return (
    <aside
      data-region="login-illustrations"
      className={cn("relative hidden min-h-dvh flex-1 overflow-hidden bg-surface-alt lg:block")}
      aria-hidden="true"
    >
      {/* Map Sticker */}
      <div className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2")}>
        <Image
          src="/images/stickers/Map.svg"
          alt=""
          width={466}
          height={466}
          className={cn("h-auto w-[28vw] rotate-[10deg] drop-shadow-[0_3px_3px_rgba(0,0,0,0.25)]")}
          priority
        />
      </div>

      {/* Luggage Bag Sticker */}
      <div className={cn("absolute right-[5%] top-[4%]")}>
        <Image
          src="/images/stickers/Luggage_Bag.svg"
          alt=""
          width={177}
          height={172}
          className={cn("h-auto w-[10vw] -rotate-12 drop-shadow-[0_6px_6px_rgba(0,0,0,0.25)]")}
          priority
        />
      </div>

      {/* Bookmark Sticker */}
      <div className={cn("absolute left-[6%] top-[24%]")}>
        <Image
          src="/images/stickers/Bookmark.svg"
          alt=""
          width={160}
          height={169}
          className={cn("h-auto w-[10vw] -rotate-[9deg]")}
          priority
        />
      </div>

      {/* Plane Sticker */}
      <div className={cn("absolute left-[52%] top-[25%]")}>
        <Image
          src="/images/stickers/Plane.svg"
          alt=""
          width={146}
          height={149}
          className={cn("h-auto w-[8vw] drop-shadow-[0_6px_6px_rgba(0,0,0,0.25)]")}
          priority
        />
      </div>

      {/* Camera Sticker */}
      <div className={cn("absolute bottom-[22%] right-[5%]")}>
        <Image
          src="/images/stickers/Camera.svg"
          alt=""
          width={174}
          height={167}
          className={cn("h-auto w-[10vw] -rotate-12")}
        />
      </div>

      {/* Luggage Sticker */}
      <div className={cn("absolute bottom-[5%] left-[7%]")}>
        <Image
          src="/images/stickers/Luggage.svg"
          alt=""
          width={231}
          height={246}
          className={cn("h-auto w-[13vw] -rotate-[10deg]")}
        />
      </div>
    </aside>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const next = searchParams.get("next");
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
  const copy = COPY[mode];
  const canSubmit =
    email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH && !isSubmitting;

  useEffect(() => {
    setError(null);
  }, [mode]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;

      setIsSubmitting(true);
      setError(null);

      const personaId = readPersonaId();
      const credentials: Credentials = {
        email: email.trim(),
        password,
        ...(personaId ? { personaId } : {}),
      };

      try {
        await (mode === "signup" ? signUp(credentials) : signIn(credentials));
        queryClient.clear();
        router.replace(destination);
      } catch (caught) {
        console.error(`[login] ${mode} failed`, caught);
        setError(getFriendlyAuthError(caught as { message?: string; status?: number }));
        setIsSubmitting(false);
      }
    },
    [canSubmit, destination, email, mode, password, router],
  );

  return (
    <main data-region="login-page" className={cn("flex min-h-dvh w-full bg-surface")}>
      {/* Auth Panel */}
      <section
        data-region="login-auth-panel"
        className={cn("flex min-h-dvh flex-1 flex-col items-center overflow-y-auto bg-surface p-8 sm:p-15")}
      >
        {/* Brand */}
        <Image src="/images/Argo.svg" alt="Argo" width={94} height={28} priority />

        {/* Form Region */}
        <div
          data-region="login-form-region"
          className={cn(
            "flex w-full flex-1 flex-col items-center justify-center py-10",
            "lg:justify-start lg:pb-10 lg:pt-31",
          )}
        >
          <motion.div
            className={cn("flex w-full flex-col items-center gap-12")}
            variants={container}
            initial="hidden"
            animate="visible"
          >
            {/* Heading */}
            <motion.div variants={item} className={cn("flex flex-col items-center gap-2 text-center")}>
              <h1 className={cn("type-h4 type-secondary font-semibold text-content")}>{copy.title}</h1>
              <p className={cn("type-body-2 text-content-secondary")}>
                {copy.blurb}{" "}
                <button
                  type="button"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  disabled={isSubmitting}
                  className={cn(
                    "font-semibold text-content underline-offset-4 transition-colors hover:underline",
                    "disabled:pointer-events-none disabled:opacity-50",
                  )}
                >
                  {copy.switch}
                </button>
              </p>
            </motion.div>

            {/* Credentials Form */}
            <form
              data-region="login-credentials-form"
              onSubmit={handleSubmit}
              className={cn("flex w-full max-w-80 flex-col gap-4")}
            >
              {error ? (
                <motion.p
                  variants={item}
                  id="login-error"
                  role="alert"
                  className={cn("type-body-2 rounded-lg bg-surface-error-subtle px-3 py-2 text-content-error")}
                >
                  {error}
                </motion.p>
              ) : null}

              <motion.div variants={item}>
                <Field.Root>
                  <AuthInput
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="Email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={isSubmitting}
                    error={Boolean(error)}
                    clearable={false}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error" : undefined}
                    required
                  />
                </Field.Root>
              </motion.div>

              <motion.div variants={item}>
                <Field.Root>
                  <AuthInput
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    placeholder="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                    error={Boolean(error)}
                    clearable={false}
                    trailingIcon={showPassword ? <EyeOff /> : <Eye />}
                    trailingIconKey={showPassword ? "hide-password" : "show-password"}
                    trailingIconLabel={showPassword ? "Hide password" : "Show password"}
                    onTrailingClick={() => setShowPassword((visible) => !visible)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error" : undefined}
                    minLength={MIN_PASSWORD_LENGTH}
                    required
                  />
                </Field.Root>
              </motion.div>

              <motion.div variants={item}>
                <AuthButton type="submit" loading={isSubmitting} disabled={isSubmitting}>
                  {copy.submit}
                </AuthButton>
              </motion.div>
            </form>
          </motion.div>
        </div>
      </section>

      {/* Illustration Panel */}
      <AuthIllustrationPanel />
    </main>
  );
}
