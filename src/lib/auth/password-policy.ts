// Client-side mirror of the Supabase project's password policy.
//
// This file is the *second* line of defence, not the first: iOS and any direct
// call to `signUp` bypass it entirely. The project must be configured with
// Auth → Providers → Email → minimum length 8 and required characters
// "Lowercase, uppercase letters, digits and symbols", or these rules only hold
// on the web form. Keep the two in sync — a client rule that is stricter than
// the server is dead weight, and one that is looser produces a server rejection
// the form said wouldn't happen.

export const PASSWORD_MIN_LENGTH = 8

// Supabase's own symbol set for the "digits and symbols" preset. Matching it
// exactly matters: a broader test here (any non-alphanumeric) would accept a
// space or an accented letter that the server then rejects.
const SYMBOLS = "!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~"

const hasSymbol = (value: string) => [...value].some((char) => SYMBOLS.includes(char))

export interface PasswordRequirement {
  id: string
  label: string
  test: (value: string) => boolean
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value) => value.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lowercase', label: 'A lowercase letter', test: (value) => /[a-z]/.test(value) },
  { id: 'uppercase', label: 'An uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { id: 'digit', label: 'A number', test: (value) => /[0-9]/.test(value) },
  { id: 'symbol', label: 'A symbol, like ! or @', test: hasSymbol },
]

export function isPasswordValid(value: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value))
}
