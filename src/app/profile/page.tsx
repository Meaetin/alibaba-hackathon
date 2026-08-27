"use client";

import { Fragment, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { FolderOpen, RefreshCw, Settings } from "lucide-react";

import {
  CollectionCard,
  ItineraryCard,
  LinkCard,
  LocationCard,
} from "@/components/ui";
import { PersonaQuizDialog } from "@/components/profile/PersonaQuizDialog";
import { Avatar } from "@/components/ui/primitives/Avatar";
import { Button } from "@/components/ui/primitives/Button";
import { useDashboardRecent } from "@/hooks/useDashboardRecent";
import { useProfileQuery } from "@/hooks/queries/useProfileQuery";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";
import {
  ARCHETYPE_ILLUSTRATIONS,
  INTRO_ILLUSTRATION,
} from "@/lib/persona/illustrations";
import type { PersonaResult, TravelArchetypeId } from "@/lib/persona/types";
import {
  getNextRandomBannerIndex,
  TRAVEL_PROFILE_BANNERS,
} from "@/lib/profile/banner-images";
import type { RecentContentItem } from "@/lib/supabase/queries/home";

const TYPE_GRADIENTS: Record<RecentContentItem["type"], string> = {
  link: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  collection: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  itinerary: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  location: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
};

const PERSONA_STORAGE_PREFIX = "argo:persona:";
const BANNER_STORAGE_PREFIX = "argo:profile-banner:";

function isStoredPersona(value: unknown): value is PersonaResult {
  if (!value || typeof value !== "object") return false;
  const archetypeId = (value as PersonaResult).archetype?.id as
    | TravelArchetypeId
    | undefined;
  return Boolean(archetypeId && ARCHETYPE_ILLUSTRATIONS[archetypeId]);
}

function getItemHref(item: RecentContentItem): string {
  switch (item.type) {
    case "itinerary": return `/itineraries/${item.id}`;
    case "collection": return `/collections/${item.id}`;
    default: return `/links/${item.id}`;
  }
}

export default function ProfilePage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const userId = useSessionUserId();
  const { data: profile } = useProfileQuery(userId);
  const { items, isLoading } = useDashboardRecent({
    userId,
    filter: "recent",
    sortOption: "modified",
  });

  const [quizOpen, setQuizOpen] = useState(false);
  const [persona, setPersona] = useState<PersonaResult | null>(null);
  const [bannerIndex, setBannerIndex] = useState(0);

  const displayName =
    profile?.display_name || profile?.email?.split("@")[0] || "Guest";
  const handle = profile?.email
    ? `@${profile.email.split("@")[0]}`
    : "Not signed in";
  const avatarHash = profile?.id ?? profile?.email ?? userId ?? "argo-guest";
  const banner = TRAVEL_PROFILE_BANNERS[bannerIndex];

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        `${PERSONA_STORAGE_PREFIX}${avatarHash}`,
      );
      if (!stored) {
        setPersona(null);
        return;
      }
      const parsed: unknown = JSON.parse(stored);
      setPersona(isStoredPersona(parsed) ? parsed : null);
    } catch (error) {
      console.error("Failed to load the saved travel persona:", error);
      setPersona(null);
    }
  }, [avatarHash]);

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
    setPersona(result);
    try {
      window.localStorage.setItem(
        `${PERSONA_STORAGE_PREFIX}${avatarHash}`,
        JSON.stringify(result),
      );
    } catch (error) {
      console.error("Failed to save the travel persona:", error);
    }
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

          <div className="profile-header-body relative flex flex-col gap-4 pl-0 md:pl-16">
            {/* Avatar */}
            <Avatar
              type={profile?.avatar_url ? "image" : "generated"}
              src={profile?.avatar_url ?? undefined}
              hash={avatarHash}
              name={displayName}
              alt={displayName}
              size="xl"
              className="profile-avatar border-edge-subtle bg-surface-muted-hover text-glyph-secondary"
              data-region="profile-avatar"
            />

            <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
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

                {/* Action Row */}
                <div
                  className="profile-actions flex items-center gap-2"
                  data-region="profile-actions"
                >
                  <Button variant="outline">Add Preferences</Button>
                  <Button
                    variant="ghost"
                    icon="only"
                    aria-label="Settings"
                    onClick={() => router.push("/settings")}
                  >
                    <Settings className="size-5" />
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

            {/* Description */}
            <p
              className="profile-description type-body-2 text-content"
              data-region="profile-description"
            >
              No description yet.
            </p>
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
        onOpenChange={setQuizOpen}
        persona={persona}
        onComplete={handlePersonaComplete}
      />
    </div>
  );
}
