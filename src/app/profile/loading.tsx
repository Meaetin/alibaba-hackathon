export default function ProfileLoading() {
  return (
    <div
      className="profile-loading flex flex-col items-center min-h-full px-6 pt-20 pb-16"
      data-region="profile-loading"
    >
      {/* Hero Skeleton */}
      <div className="profile-loading-hero flex flex-col items-center gap-4 mb-12">
        <div className="size-24 rounded-full bg-surface-muted animate-pulse" />
        <div className="h-7 w-48 rounded-lg bg-surface-muted animate-pulse" />
        <div className="h-4 w-64 rounded bg-surface-muted animate-pulse" />
      </div>

      {/* Persona CTA Skeleton */}
      <div className="profile-loading-persona w-full max-w-2xl rounded-2xl border border-edge-subtle bg-surface p-6 mb-8">
        <div className="flex items-center gap-4">
          <div className="size-16 shrink-0 rounded-xl bg-surface-muted animate-pulse" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-5 w-40 rounded bg-surface-muted animate-pulse" />
            <div className="h-4 w-56 rounded bg-surface-muted animate-pulse" />
          </div>
        </div>
      </div>

      {/* Account Section Skeleton */}
      <div className="profile-loading-account w-full max-w-2xl rounded-2xl border border-edge-subtle bg-surface p-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-4 py-3 border-b border-edge-subtle last:border-b-0"
          >
            <div className="size-5 rounded bg-surface-muted animate-pulse" />
            <div className="flex-1 h-4 rounded bg-surface-muted animate-pulse" style={{ width: `${60 + i * 10}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
