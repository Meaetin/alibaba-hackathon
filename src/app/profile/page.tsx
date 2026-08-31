"use client";

import { Fragment, useEffect, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { FolderOpen, RefreshCw } from "lucide-react";

import {
  CollectionCard,
  ItineraryCard,
  LinkCard,
  LocationCard,
} from "@/components/ui";
import { PersonaQuizDialog } from "@/components/profile/PersonaQuizDialog";
import { PreferencesDialog } from "@/components/profile/PreferencesDialog";
import { Avatar } from "@/components/ui/primitives/Avatar";
import { Button } from "@/components/ui/primitives/Button";
import { useToast } from "@/contexts/ToastContext";
import { useDashboardRecent } from "@/hooks/useDashboardRecent";
import { useProfileQuery } from "@/hooks/queries/useProfileQuery";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { motionTransitions } from "@/lib/motion/presets";
import {
  ARCHETYPE_ILLUSTRATIONS,
  INTRO_ILLUSTRATION,
} from "@/lib/persona/illustrations";
import type { PersonaResult, TravelPersona } from "@/lib/persona/types";
import {
  PREFERENCE_BY_ID,
  createSavedPreferences,
  getPersonaPreferenceIds,
} from "@/lib/preferences/registry";
import { fetchPersona, resetPersona } from "@/lib/persona/storage";
import { fetchTravelPreferences, saveTravelPreferences } from "@/lib/api/preferences";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { useQuery } from "@tanstack/react-query";
import type { SavedTravelPreferences } from "@/lib/preferences/types";
import {
  getNextRandomBannerIndex,
  TRAVEL_PROFILE_BANNERS,
} from "@/lib/profile/banner-images";
import type { RecentContentItem } from "@/lib/domain-types";
import { cn } from "@/lib/utils";

const TYPE_GRADIENTS: Record<RecentContentItem["type"], string> = {
  link: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  collection: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  itinerary: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  location: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
};

const BANNER_STORAGE_PREFIX = "argo:profile-banner:";

function getItemHref(item: RecentContentItem): string {
  switch (item.type) {
    case "itinerary": return `/itineraries/${item.id}`;
    case "collection": return `/collections/${item.id}`;
    default: return `/links/${item.id}`;
  }
}

export default function ProfilePage() {
  const { showToast } = useToast();
  const prefersReducedMotion = useReducedMotion();
  const userId = useSessionUserId();
  const { data: profile } = useProfileQuery(userId);
  const { items, isLoading } = useDashboardRecent({
    userId,
    filter: "recent",
    sortOption: "modified",
  });

  const [quizOpen, setQuizOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Server-held. This page used to keep its own `PersonaResult` in
  // `localStorage`, which could show one archetype while the planner used
  // another — the cached copy `persona/storage.ts` explains it avoids.
  const { data: personaRecord = null } = useQuery({
    queryKey: queryKeys.persona(),
    queryFn: fetchPersona,
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });
  const persona: PersonaResult | null = personaRecord?.result ?? null;
  // Server-held, not `localStorage`: preferences follow the person, so the same
  // account sees the same set on a laptop and a phone.
  const { data: travelPreferences = null } = useQuery<SavedTravelPreferences | null>({
    queryKey: queryKeys.travelPreferences(),
    queryFn: fetchTravelPreferences,
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });
  const [bannerIndex, setBannerIndex] = useState(0);

  const displayName =
    profile?.display_name || profile?.email?.split("@")[0] || "Guest";
  const handle = profile?.email
    ? `@${profile.email.split("@")[0]}`
    : "Not signed in";
  const avatarHash = profile?.id ?? profile?.email ?? userId ?? "argo-guest";
  const banner = TRAVEL_PROFILE_BANNERS[bannerIndex];
  const visiblePreferenceIds = [
    ...new Set([
      ...(travelPreferences?.selectedIds ?? []),
      ...getPersonaPreferenceIds(persona),
    ]),
  ];
  const savedPreferenceDefinitions = visiblePreferenceIds
    .flatMap((id) => {
      const preference = PREFERENCE_BY_ID.get(id);
      return preference ? [preference] : [];
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        `${BANNER_STORAGE_PREFIX}${avatarHash}`,
      );
      const storedIndex = stored === null ? 0 : Number.parseInt(stored, 10);
      setBannerIndex(
        Number.isInteger(storedIndex) &&
          storedIndex >= 0 &&
          storedIndex < TRAVEL_PROFILE_BANNERS.length
          ? storedIndex
          : 0,
      );
    } catch (error) {
      console.error("Failed to load the saved profile banner:", error);
      setBannerIndex(0);
    }
  }, [avatarHash]);

  const handlePersonaComplete = (result: PersonaResult) => {
    // `PersonaQuizDialog` has already POSTed the answers. Re-reading rather
    // than caching `result` here is the whole point: the server rebuilds the
    // scores from the answers, so what this page shows is what the planner
    // will use, not a copy that can drift from it.
    void queryClient.invalidateQueries({ queryKey: queryKeys.persona() });

    // Persona presets are real preferences, not decoration. Merge them into
    // the saved set after the quiz POST settles so they follow the traveller
    // across devices and reach the planner-ready profile.
    const personaPreferenceIds = getPersonaPreferenceIds(result);
    void persistPreferences({
      selectedIds: [
        ...new Set([
          ...(travelPreferences?.selectedIds ?? []),
          ...personaPreferenceIds,
        ]),
      ],
      confirmedConstraintIds: travelPreferences?.confirmedConstraintIds ?? [],
      preferredEndTime: travelPreferences?.preferredEndTime,
    }).catch((error: unknown) => {
      console.error("Failed to save preferences for the travel persona:", error);
      showToast({
        title: "Persona preferences couldn't be saved",
        description: "Your persona is saved. Please try editing your preferences again.",
        variant: "error",
      });
    });
  };

  const handleQuizOpenChange = (next: boolean) => {
    setQuizOpen(next);
  };

  const handlePersonaRetake = () => {
    const previousPersona = queryClient.getQueryData<TravelPersona | null>(
      queryKeys.persona(),
    );
    const previousPreferences = queryClient.getQueryData<SavedTravelPreferences | null>(
      queryKeys.travelPreferences(),
    );
    const personaPreferenceIds = new Set(getPersonaPreferenceIds(persona));
    const optimisticPreferences = travelPreferences
      ? createSavedPreferences(
          travelPreferences.selectedIds.filter((id) => !personaPreferenceIds.has(id)),
          travelPreferences.confirmedConstraintIds.filter(
            (id) => !personaPreferenceIds.has(id),
          ),
          travelPreferences.preferredEndTime,
          null,
        )
      : null;

    // Retake is a persisted empty state. Update the two visible surfaces now;
    // closing the dialog does not restore either cache entry.
    queryClient.setQueryData(queryKeys.persona(), null);
    queryClient.setQueryData(queryKeys.travelPreferences(), optimisticPreferences);

    void resetPersona().then((storedPreferences) => {
      if (storedPreferences !== undefined) {
        queryClient.setQueryData(queryKeys.travelPreferences(), storedPreferences);
        return;
      }

      queryClient.setQueryData(queryKeys.persona(), previousPersona ?? null);
      queryClient.setQueryData(queryKeys.travelPreferences(), previousPreferences ?? null);
      showToast({
        title: "Persona couldn't be reset",
        description: "Please try again.",
        variant: "error",
      });
    });
  };

  /** Saves and puts the **server's** answer in the cache, never the sent one —
   *  an unknown id is dropped on the way in, so the two can differ. */
  async function persistPreferences(next: {
    selectedIds: readonly string[];
    confirmedConstraintIds: readonly string[];
    preferredEndTime?: string;
  }): Promise<SavedTravelPreferences> {
    const stored = await saveTravelPreferences(next);
    queryClient.setQueryData(queryKeys.travelPreferences(), stored);
    return stored;
  }

  const handlePreferencesSave = (next: SavedTravelPreferences) => {
    persistPreferences(next)
      .then((stored) => {
        showToast({
          title: "Preferences saved",
          description: `${stored.selectedIds.length} preference${stored.selectedIds.length === 1 ? "" : "s"} will shape your recommendations.`,
          variant: "success",
        });
      })
      .catch((error: unknown) => {
        // The dialog has already closed, so the toast is the only place this
        // can be said. The cache is untouched, so the chips still show the last
        // set that actually saved rather than one that did not.
        console.error("Failed to save the travel preferences:", error);
        showToast({
          title: "Preferences couldn't be saved",
          description: "Please try again.",
          variant: "error",
        });
      });
  };

  const randomizeBanner = () => {
    const nextIndex = getNextRandomBannerIndex(bannerIndex);
    setBannerIndex(nextIndex);
    try {
      window.localStorage.setItem(
        `${BANNER_STORAGE_PREFIX}${avatarHash}`,
        String(nextIndex),
      );
    } catch (error) {
      console.error("Failed to save the profile banner:", error);
    }
  };

  // Stats are stubbed until the backend exposes per-user counts.
  const stats = ["0 Locations", "0 Collections", "0 Itineraries"];

  const renderCard = (item: RecentContentItem) => {
    const shared = {
      label: item.name,
      imageUrl: item.thumbnail_url ?? undefined,
      gradient: TYPE_GRADIENTS[item.type],
      className: "h-full",
      href: getItemHref(item),
    };
    switch (item.type) {
      case "collection":
        return (
          <CollectionCard
            label={item.name}
            images={
              item.preview_images?.length
                ? item.preview_images
                : item.thumbnail_url
                  ? [item.thumbnail_url]
                  : undefined
            }
            gradient={
              item.preview_images?.length || item.thumbnail_url
                ? undefined
                : TYPE_GRADIENTS[item.type]
            }
            fallbackQuery={item.name}
            className="h-full"
            href={getItemHref(item)}
          />
        );
      case "itinerary":
        return <ItineraryCard {...shared} />;
      case "location":
        return <LocationCard {...shared} />;
      default:
        return <LinkCard {...shared} />;
    }
  };

  return (
    <div
      className="profile-page flex flex-col min-h-full pt-[var(--navbar-height)]"
      data-region="profile-page"
    >
      <div
        className="profile-shell mx-auto flex w-full max-w-[1328px] flex-col gap-6 px-6 pt-6 pb-10"
        data-region="profile-shell"
      >
        {/* Profile Header */}
        <motion.div
          className="profile-header flex flex-col"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
          animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={motionTransitions.spatial}
          data-region="profile-header"
        >
          {/* Hero Banner */}
          <div
            className="profile-hero-banner relative -mb-[74px] h-[240px] w-full overflow-hidden rounded-2xl border border-edge-subtle bg-surface-muted"
            data-region="profile-hero-banner"
          >
            <Image
              src={banner.src}
              alt={banner.alt}
              fill
              priority
              sizes="(max-width: 1376px) 100vw, 1328px"
              className="object-cover object-center"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon="only"
              aria-label="Show another travel banner"
              title="Randomize travel banner"
              className="absolute bottom-3 right-3 z-10 bg-surface"
              onClick={randomizeBanner}
              data-region="profile-banner-randomize"
            >
              <RefreshCw className="size-4" strokeWidth={2} />
            </Button>
          </div>

          <div className={cn("profile-header-body relative flex w-full flex-col gap-4")}>
            {/* Avatar */}
            <Avatar
              type={profile?.avatar_url ? "image" : "generated"}
              src={profile?.avatar_url ?? undefined}
              hash={avatarHash}
              name={displayName}
              alt={displayName}
              size="xl"
              className={cn(
                "profile-avatar border-edge-subtle bg-surface-muted-hover text-glyph-secondary md:ml-16",
              )}
              data-region="profile-avatar"
            />

            <div className={cn("flex w-full flex-col items-start justify-between gap-4 md:flex-row")}>
              {/* Profile Info */}
              <div
                className="profile-info flex flex-col gap-4"
                data-region="profile-info"
              >
                {/* Name */}
                <div className="flex flex-col gap-2">
                  <h1 className="type-h3 font-secondary font-semibold text-content">
                    {displayName}
                  </h1>
                  <p className="type-body-2 text-content-secondary">{handle}</p>
                </div>

                {/* Stats Row */}
                <div
                  className="profile-stats flex items-center gap-2"
                  data-region="profile-stats"
                >
                  {stats.map((stat, index) => (
                    <Fragment key={stat}>
                      {index > 0 && (
                        <span
                          aria-hidden="true"
                          className="size-1 rounded-full bg-content-placeholder"
                        />
                      )}
                      <span className="type-body-2 font-medium text-content">
                        {stat}
                      </span>
                    </Fragment>
                  ))}
                </div>

                {/* Preferences Row */}
                <div
                  className={cn("flex max-w-xl flex-wrap items-center gap-2")}
                  role="group"
                  aria-label="Travel preferences"
                  data-region="profile-preferences"
                >
                  {savedPreferenceDefinitions.map((preference) => (
                    <span
                      key={preference.id}
                      className={cn(
                        "rounded-xl border border-edge-subtle bg-surface-alt px-3 py-1.5 type-body-2 font-medium text-content",
                      )}
                    >
                      {preference.label}
                    </span>
                  ))}
                  <Button variant="outline" onClick={() => setPreferencesOpen(true)}>
                    {travelPreferences ? "Edit Preferences" : "Add Preferences"}
                  </Button>
                </div>
              </div>

              {/* Persona Quiz Card */}
              <div
                className="profile-persona-card relative flex min-h-[160px] w-full items-end justify-end overflow-hidden rounded-2xl border border-edge-subtle bg-surface-alt p-[13px] md:min-h-0 md:w-[460px] md:self-stretch"
                data-region="profile-persona-card"
              >
                {persona ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={ARCHETYPE_ILLUSTRATIONS[persona.archetype.id]}
                    alt={persona.archetype.name}
                    className="absolute inset-0 size-full object-cover"
                    draggable="false"
                  />
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={INTRO_ILLUSTRATION.background}
                      alt=""
                      className="absolute inset-0 size-full object-cover"
                      draggable="false"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={INTRO_ILLUSTRATION.owl}
                      alt="Argo the owl"
                      className="absolute bottom-0 left-1/2 h-full -translate-x-1/2 object-contain"
                      draggable="false"
                    />
                  </>
                )}
                <Button
                  variant="outline"
                  className="relative z-10 bg-surface"
                  onClick={() => setQuizOpen(true)}
                >
                  {persona?.archetype.name ?? "Persona Quiz"}
                </Button>
              </div>
            </div>

          </div>
        </motion.div>

        {/* Content Grid */}
        {isLoading ? (
          <div
            className="profile-grid-skeleton grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            data-region="profile-grid-skeleton"
          >
            {Array.from({ length: 10 }).map((_, index) => (
              <div
                key={index}
                className="h-[320px] animate-pulse rounded-2xl bg-action-secondary"
              />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div
            className="profile-content-grid grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            data-region="profile-content-grid"
          >
            {items.map((item) => (
              <div key={item.id} className="h-[320px]">
                {renderCard(item)}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="profile-empty-state flex w-full flex-col items-center justify-center gap-3 py-16"
            data-region="profile-empty-state"
          >
            <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-muted">
              <FolderOpen className="size-7 text-content-secondary" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="type-body-1 text-glyph">No content yet</p>
              <p className="type-body-2 text-content-secondary">
                Links, collections and itineraries you add will show up here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Persona Quiz Dialog */}
      <PersonaQuizDialog
        open={quizOpen}
        onOpenChange={handleQuizOpenChange}
        persona={persona}
        onComplete={handlePersonaComplete}
        onRetake={handlePersonaRetake}
      />

      {/* Preferences Dialog */}
      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={setPreferencesOpen}
        persona={persona}
        preferences={travelPreferences}
        onSave={handlePreferencesSave}
      />
    </div>
  );
}
