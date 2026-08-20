export function validateUrl(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim();
  if (!trimmed) return { valid: false, error: "URL is required" };

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, error: "URL must start with http:// or https://" };
    }
    if (!parsed.hostname || parsed.hostname.length < 3) {
      return { valid: false, error: "Invalid URL format" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}
