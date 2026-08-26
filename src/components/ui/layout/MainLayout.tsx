"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Navbar } from "@/components/ui/navbar";
import { Avatar } from "@/components/ui/primitives/Avatar";
import { NewLinkModal } from "@/components/ui/modals/NewLinkModal";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import type { NewItinerarySubmission } from "@/components/ui/modals/NewItineraryModal";
import { Sheet } from "@/components/ui/primitives/Sheet";
import { RightSidebarProvider } from "@/contexts/RightSidebarContext";
import { useRightSidebar } from "@/contexts/RightSidebarContext";
import { NavbarVisibilityProvider } from "@/contexts/NavbarVisibilityContext";
import { NavbarFilterProvider } from "@/contexts/NavbarFilterContext";
import { useToast } from "@/contexts/ToastContext";
import {
  NavigationLoadingProvider,
  useNavigationLoading,
} from "@/contexts/NavigationLoadingContext";
import { ItineraryLoadingScreen } from "@/components/ui/itinerary/ItineraryLoadingScreen";
import { createClient } from "@/lib/supabase/client";
import { getProfile, type ProfileRow } from "@/lib/supabase/queries";
import { AlreadyAnalyzedError, createJob } from "@/lib/api/client";
import { createCollection } from "@/lib/api/collections";
import { createItineraryRouted, ItineraryQuotaError } from "@/lib/api/itineraries";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { useJobsQueue } from "@/hooks/useJobsQueue";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { motionTransitions } from "@/lib/motion/presets";
import { PLANNING_JOB_CREATED_EVENT } from "@/lib/jobs/events";
import type { QueueJob } from "@/lib/jobs/types";

function MainLayoutContent({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = useReducedMotion();
  const router = useRouter();
  const { rightSidebar, setRightSidebar, presentation } = useRightSidebar();
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const { isLoading: navLoading, title: navTitle, subtitle: navSubtitle } =
    useNavigationLoading();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [navbarHidden, setNavbarHidden] = useState(false);

  const navbarRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!navbarRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        "--navbar-height",
        `${entry.contentRect.height}px`,
      );
    });
    observer.observe(navbarRef.current);
    return () => observer.disconnect();
  }, []);

  // Position-based hysteresis (intentionally NOT direction-based):
  //   scrollTop > HIDE_AT   → hide
  //   scrollTop < SHOW_AT   → show
  //   in between            → leave as-is (dead zone)
  // This avoids the flicker that comes from reacting to individual scroll
  // deltas — particularly during programmatic smooth-scrolls and tiny
  // trackpad corrections, where a few px of "up" would otherwise pop the
  // navbar back into view.
  useEffect(() => {
    const container = mainContentRef.current;
    if (!container) return;

    const HIDE_AT = 120;
    const SHOW_AT = 40;

    const isPageScroller = (el: HTMLElement) =>
      el.tagName === "MAIN" || el.dataset.pageScroll === "true";

    const handleScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || !isPageScroller(target)) return;
      const scrollTop = target.scrollTop;
      if (scrollTop > HIDE_AT) {
        setNavbarHidden(true);
      } else if (scrollTop < SHOW_AT) {
        setNavbarHidden(false);
      }
    };
    container.addEventListener("scroll", handleScroll, true);
    return () => container.removeEventListener("scroll", handleScroll, true);
  }, []);

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [itineraryModalOpen, setItineraryModalOpen] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [itineraryName, setItineraryName] = useState("");

  const { upsertJob: upsertPlanningJob } = useJobsQueue({
    type: "itinerary-planning",
    onJobCompleted: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      const itineraryId = job.result?.itinerary_id as string | undefined;
      showToast({
        title: "Itinerary ready",
        variant: "success",
        action: itineraryId
          ? { label: "View", href: `/itineraries/${itineraryId}` }
          : undefined,
      });
    },
    onJobFailed: () => {
      showToast({
        title: "We couldn’t generate your itinerary",
        description: "Please try again in a moment.",
        variant: "error",
      });
    },
  });

  useEffect(() => {
    const track = (event: Event) => {
      upsertPlanningJob((event as CustomEvent<QueueJob>).detail);
    };
    window.addEventListener(PLANNING_JOB_CREATED_EVENT, track);
    return () => window.removeEventListener(PLANNING_JOB_CREATED_EVENT, track);
  }, [upsertPlanningJob]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        getProfile(supabase, data.user.id).then(setProfile);
      }
    });
  }, []);

  const handleLinkSubmit = async (linkUrl: string) => {
    try {
      await createJob("content-analysis", { url: linkUrl });
    } catch (err) {
      if (err instanceof AlreadyAnalyzedError) {
        setLinkModalOpen(false);
        showToast({
          title: "You've already analyzed this link",
          thumbnail: err.content.content_thumbnail ?? undefined,
          action: { label: "View", href: `/links/${err.content.id}` },
        });
        return;
      }
      throw err;
    }
    setLinkModalOpen(false);
    showToast({
      title: "Link sent to queue",
      action: { label: "View", href: "/links" },
    });
  };

  const handleCollectionSubmit = async (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => {
    try {
      const collection = await createCollection(
        data.name,
        data.country,
        data.region,
        data.latitude,
        data.longitude,
        data.tags,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      window.dispatchEvent(
        new CustomEvent("argo:content-prepended", {
          detail: {
            id: collection.id,
            type: "collection",
            name: collection.name,
            thumbnail_url: collection.thumbnail_url ?? null,
            updated_at: collection.updated_at ?? new Date().toISOString(),
            is_bookmarked: false,
            is_archived: false,
          },
        }),
      );
      setCollectionName("");
      setCollectionModalOpen(false);
      showToast({
        title: "Collection created",
        description: `"${collection.name}" is ready.`,
        action: { label: "View", href: `/collections/${collection.id}` },
        duration: 5000,
      });
    } catch (err) {
      console.error("Failed to create collection:", err);
      showToast({
        variant: "error",
        title: "We couldn’t create your collection",
        description: getFriendlyApiError(err, "Please try again in a moment."),
        duration: 5000,
      });
    }
  };

  const handleItinerarySubmit = async (data: NewItinerarySubmission) => {
    if (!data.tripName || !data.country || !data.startDate || !data.totalDays) return;
    try {
      const result = await createItineraryRouted({
        source: "navbar",
        tripName: data.tripName,
        country: data.country,
        region: data.region,
        latitude: data.latitude,
        longitude: data.longitude,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: data.totalDays,
        selectedLocationIds: data.selectedLocationIds,
        aiRecommendations: data.aiRecommendations,
        pace: data.pace,
      });
      setItineraryName("");
      setItineraryModalOpen(false);

      // AI-only itinerary (no locations + AI on) → async job. This persistent
      // layout queue survives page navigation and surfaces completion.
      if (result.kind === "planning") {
        upsertPlanningJob(result.job);
        showToast({ variant: "success", title: "Generating itinerary…" });
        return;
      }

      // Blank itinerary → created synchronously, navigate straight in.
      const itinerary = result.itinerary;
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) });
      window.dispatchEvent(
        new CustomEvent("argo:content-prepended", {
          detail: {
            id: itinerary.id,
            type: "itinerary",
            name: itinerary.name,
            thumbnail_url: itinerary.thumbnail_url ?? null,
            updated_at: itinerary.updated_at ?? new Date().toISOString(),
            is_bookmarked: false,
            is_archived: false,
            metadata: { country: itinerary.country },
          },
        }),
      );
      router.push(`/itineraries/${itinerary.id}`);
    } catch (err) {
      if (err instanceof ItineraryQuotaError) {
        if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
        showQuotaToast("itinerary", err.max_itineraries);
        setItineraryModalOpen(false);
      } else {
        console.error("Failed to create itinerary:", err);
        showToast({
          variant: "error",
          title: "We couldn’t create your itinerary",
          description: getFriendlyApiError(err, "Please try again in a moment."),
        });
      }
    }
  };

  const displayName =
    profile?.display_name || profile?.email?.split("@")[0] || "User";

  const avatar = profile?.avatar_url ? (
    <Avatar
      type="image"
      src={profile.avatar_url}
      alt={displayName}
      size="sm"
      className="size-5"
    />
  ) : (
    <Avatar
      type="initial"
      name={displayName}
      size="sm"
      className="size-5"
    />
  );

  return (
    <div className="main-layout isolate relative h-dvh overflow-x-hidden bg-surface">
      {/* Navbar */}
      <div
        ref={navbarRef}
        className="absolute inset-x-0 top-0 z-30 transition-transform duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none"
        style={{ transform: navbarHidden ? "translateY(-100%)" : "translateY(0)" }}
      >
        <Navbar
          avatar={avatar}
          userId={userId}
          onNewLink={() => setLinkModalOpen(true)}
          onNewCollection={() => setCollectionModalOpen(true)}
          onNewItinerary={() => setItineraryModalOpen(true)}
        />
      </div>

      {/* Main Content Area */}
      <div ref={mainContentRef} className="flex h-full">
        {/* Page Content */}
        <main className="main-layout-content flex-1 min-w-0 overflow-y-auto">
          <NavbarVisibilityProvider setNavbarHidden={setNavbarHidden}>
            {children}
          </NavbarVisibilityProvider>
        </main>

        {/* Right Sidebar — inline column at lg+, overlay Sheet below lg */}
        {presentation === "inline" ? (
          <AnimatePresence initial={false}>
            {rightSidebar && (
              <motion.div
                key="right-sidebar"
                className="h-full w-[408px] shrink-0 overflow-hidden"
              >
                <motion.div
                  initial={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: "translateX(14px)" }
                  }
                  animate={{ opacity: 1, transform: "translateX(0)" }}
                  exit={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: "translateX(14px)" }
                  }
                  transition={
                    prefersReducedMotion
                      ? motionTransitions.fast
                      : motionTransitions.spatial
                  }
                  className="h-full w-full"
                >
                  {rightSidebar}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        ) : (
          <Sheet
            side="right"
            open={!!rightSidebar}
            onOpenChange={(open) => {
              if (!open) setRightSidebar(null);
            }}
            title="Details"
          >
            {rightSidebar}
          </Sheet>
        )}
      </div>

      {/* Global Modals */}
      <NewLinkModal
        open={linkModalOpen}
        onOpenChange={setLinkModalOpen}
        onSubmit={handleLinkSubmit}
        onCancel={() => setLinkModalOpen(false)}
      />
      <NewCollectionModal
        open={collectionModalOpen}
        onOpenChange={(open) => { if (!open) setCollectionName(""); setCollectionModalOpen(open); }}
        collectionValue={collectionName}
        onCollectionChange={setCollectionName}
        onSubmit={handleCollectionSubmit}
        onCancel={() => { setCollectionName(""); setCollectionModalOpen(false); }}
      />
      <NewItineraryModal
        source="navbar"
        open={itineraryModalOpen}
        onOpenChange={(open) => { if (!open) setItineraryName(""); setItineraryModalOpen(open); }}
        tripNameValue={itineraryName}
        onTripNameChange={setItineraryName}
        selectedLocationIds={[]}
        onSubmit={handleItinerarySubmit}
        onCancel={() => { setItineraryName(""); setItineraryModalOpen(false); }}
      />

      {/* Navigation Loading Overlay */}
      <AnimatePresence>
        {navLoading && (
          <ItineraryLoadingScreen title={navTitle} subtitle={navSubtitle} />
        )}
      </AnimatePresence>
    </div>
  );
}

interface MainLayoutProps {
  children?: React.ReactNode;
  rightSidebar?: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <NavigationLoadingProvider>
      <NavbarFilterProvider>
        <RightSidebarProvider>
          <MainLayoutContent>{children}</MainLayoutContent>
        </RightSidebarProvider>
      </NavbarFilterProvider>
    </NavigationLoadingProvider>
  );
}
