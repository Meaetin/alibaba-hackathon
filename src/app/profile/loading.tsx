export default function ProfileLoading() {
  return (
    <div
      className="profile-page flex flex-col min-h-full pt-[var(--navbar-height)]"
      data-region="profile-page"
    >
      <div
        className="profile-shell mx-auto flex w-full max-w-[1328px] flex-col gap-6 px-6 pt-6 pb-10"
        data-region="profile-shell"
      >
        {/* Profile Header Skeleton */}
        <div className="profile-loading-header flex flex-col" data-region="profile-header">
          {/* Hero Banner Skeleton */}
          <div className="-mb-[74px] h-[240px] w-full animate-pulse rounded-2xl bg-action-secondary" />

          <div className="relative flex flex-col gap-4 pl-0 md:pl-16">
            {/* Avatar Skeleton */}
            <div className="size-[148px] animate-pulse rounded-full bg-action-secondary" />

            <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
              {/* Profile Info Skeleton */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="h-[30px] w-[148px] animate-pulse rounded-md bg-action-secondary" />
                  <div className="h-5 w-[96px] animate-pulse rounded-md bg-action-secondary" />
                </div>
                <div className="h-5 w-[360px] animate-pulse rounded-md bg-action-secondary" />
                <div className="flex items-center gap-2">
                  <div className="h-10 w-[126px] animate-pulse rounded-xl bg-action-secondary" />
                  <div className="size-10 animate-pulse rounded-xl bg-action-secondary" />
                </div>
              </div>

              {/* Persona Quiz Card Skeleton */}
              <div className="flex min-h-[120px] w-full items-end justify-end rounded-2xl border border-edge-subtle bg-surface-alt p-[13px] md:min-h-0 md:w-[460px] md:self-stretch">
                <div className="h-10 w-[106px] animate-pulse rounded-xl bg-action-secondary" />
              </div>
            </div>

            {/* Description Skeleton */}
            <div className="h-5 w-[240px] animate-pulse rounded-md bg-action-secondary" />
          </div>
        </div>

        {/* Content Grid Skeleton */}
        <div
          className="profile-loading-grid grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          data-region="profile-content-grid"
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <div
              key={index}
              className="h-[320px] animate-pulse rounded-2xl bg-action-secondary"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
