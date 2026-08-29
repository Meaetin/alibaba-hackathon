"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, CreditCard, Menu as MenuIcon, Plus, User } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { useNavbarFilter } from "@/contexts/NavbarFilterContext";
import { NavbarLogo } from "./NavbarLogo";
import { NavTabs, type NavTab } from "@/components/ui/primitives/NavTabs";
import { NavbarSearchBar } from "./NavbarSearchBar";
import { NavbarProfileMenu } from "./NavbarProfileMenu";
import { NewMenuDropdown } from "./NewMenuDropdown";
import { FilterPill } from "./FilterPill";
import { SearchDropdown, type RecentItem, type SearchItemType, type SearchResult } from "./SearchDropdown";
import { useRecentlyViewedQuery } from "@/hooks/queries/useRecentlyViewedQuery";
import { useSearchQuery } from "@/hooks/queries/useSearchQuery";
import { useEntityLocationsQuery } from "@/hooks/queries/useEntityLocationsQuery";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/api/auth";
import { queryClient } from "@/lib/query/queryClient";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  DescriptiveMenuItem,
  MenuSeparator,
} from "@/components/ui/primitives/Menu";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { motionTransitions } from "@/lib/motion/presets";

interface NavbarProps {
  className?: string;
  tabs?: NavTab[];
  avatar?: ReactNode;
  userId?: string | null;
  onSearch?: (value: string) => void;
  onScanClick?: () => void;
  onNotificationsClick?: () => void;
  onNewLink?: () => void;
  onNewCollection?: () => void;
  onNewItinerary?: () => void;
}

function Navbar({
  className,
  tabs,
  avatar,
  userId,
  onSearch,
  onScanClick,
  onNotificationsClick,
  onNewLink,
  onNewCollection,
  onNewItinerary,
}: NavbarProps) {
  const prefersReducedMotion = useReducedMotion();
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
  const { filter, setFilter } = useNavbarFilter();
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOffset, setSearchOffset] = useState(0);
  const [accumulatedResults, setAccumulatedResults] = useState<SearchResult[]>([]);
  const [menusMounted, setMenusMounted] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const placeholder = filter ? `Search in ${filter.label}` : "Search";

  const { data: recentlyViewedData } = useRecentlyViewedQuery(userId ?? null, searchActive);

  useEffect(() => {
    setMenusMounted(true);
  }, []);

  const recentItems: RecentItem[] = (recentlyViewedData ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    label: item.name,
    imageUrl: item.thumbnail_url ?? undefined,
    previewImages: item.preview_images,
  }));

  const isSpecificFilter = !!filter?.entityId;
  const isLocalityFilter = !!filter?.localityEntityIds;
  const filterTypeForSearch = filter && !isSpecificFilter && !isLocalityFilter ? filter.type : null;
  const { data: searchData, isLoading: searchLoading } = useSearchQuery(
    isSpecificFilter ? null : (userId ?? null),
    searchQuery,
    filterTypeForSearch,
    searchOffset,
  );

  const entityLocationType = filter?.entityId && filter.type !== "location" ? filter.type : null;
  const { data: entityLocations } = useEntityLocationsQuery(
    entityLocationType,
    filter?.entityId ?? null,
  );

  useEffect(() => {
    setSearchOffset(0);
  }, [searchQuery, filter]);

  useEffect(() => {
    if (searchOffset === 0) {
      setAccumulatedResults(searchData?.results ?? []);
    } else if (searchData) {
      setAccumulatedResults((prev) => [...prev, ...searchData.results]);
    }
  }, [searchData, searchOffset, searchQuery]);

  // Reported off the settled result set rather than each keystroke, and only
  // for the first page, so a query is one event regardless of typing speed.
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || !searchData || searchOffset !== 0) return;
    if (searchData.results.length === 0) {
    }
  }, [searchData, searchOffset, searchQuery]);

  useLayoutEffect(() => {
    if (!searchActive || !anchorRef.current) return;
    setAnchorRect(anchorRef.current.getBoundingClientRect());
  }, [searchActive]);

  const handleSearch = useCallback(
    (value: string) => {
      setSearchQuery(value);
      onSearch?.(value);
    },
    [onSearch],
  );

  const handleFilterByType = useCallback(
    (type: SearchItemType) => {
      setFilter({
        type,
        label: type === "link" ? "Links" : type === "collection" ? "Collections" : "Itineraries",
      });
    },
    [setFilter],
  );

  const handleFilterByItem = useCallback(
    (item: RecentItem) => {
      setFilter({
        type: item.type,
        label: item.label,
        thumbnailUrl: item.imageUrl,
        entityId: item.id,
      });
    },
    [setFilter],
  );

  const handleSelectSearchResult = useCallback(
    (item: SearchResult) => {
      if (filter?.entityId && item.entity_type === "location") {
        const entityPath =
          filter.type === "link"
            ? `/links/${filter.entityId}`
            : filter.type === "collection"
              ? `/collections/${filter.entityId}`
              : `/itineraries/${filter.entityId}`;
        router.push(`${entityPath}?highlight=${item.id}`);
      } else {
        const path =
          item.entity_type === "link"
            ? `/links/${item.id}`
            : item.entity_type === "collection"
              ? `/collections/${item.id}`
              : `/itineraries/${item.id}`;
        router.push(path);
      }
      handleCloseSearch();
    },
    [filter, router, accumulatedResults],
  );

  const handleSelectRecentItem = useCallback(
    (item: RecentItem) => {
      const path =
        item.type === "link"
          ? `/links/${item.id}`
          : item.type === "collection"
            ? `/collections/${item.id}`
            : `/itineraries/${item.id}`;
      router.push(path);
      handleCloseSearch();
    },
    [router],
  );

  const handleLoadMore = useCallback(() => {
    setSearchOffset((prev) => prev + 10);
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    // Clearing the cache is what makes every component re-read "signed out";
    // the session query is shared and would otherwise still hold the old user.
    queryClient.clear();
    router.push("/login");
  }, [router]);

  const handleCloseSearch = useCallback(() => {
    setSearchActive(false);
  }, []);

  const handleSearchExitComplete = useCallback(() => {
    if (searchActive) return;
    setSearchQuery("");
    setSearchOffset(0);
    setAccumulatedResults([]);
  }, [searchActive]);

  const displayResults: SearchResult[] = filter?.entityId
    ? (entityLocations ?? [])
        .filter((loc) => {
          if (!searchQuery.trim()) return false;
          return loc.name.toLowerCase().includes(searchQuery.toLowerCase());
        })
        .map((loc) => ({
          id: loc.id,
          entity_type: "location" as const,
          name: loc.name,
          thumbnail_url: loc.thumbnail_url,
        }))
    : filter?.localityEntityIds
      ? accumulatedResults.filter((r) => filter.localityEntityIds!.has(r.id))
      : accumulatedResults;

  return (
    <>
      {/* All search UI portaled to body to escape the `isolate` stacking context */}
      {menusMounted &&
        createPortal(
          <AnimatePresence initial={false} onExitComplete={handleSearchExitComplete}>
            {searchActive && (anchorRect || !isDesktop) && (
              <motion.div
                key="search-overlay"
                className="fixed inset-0 pointer-events-none"
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.fast}
              >
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/50 pointer-events-auto"
              style={{ zIndex: 9998 }}
              onClick={handleCloseSearch}
              aria-hidden="true"
            />

            {/* Search bar */}
            <div
              className="fixed flex justify-center pointer-events-auto"
              style={{
                zIndex: 9999,
                top: isDesktop && anchorRect ? anchorRect.top : 12,
                left: isDesktop && anchorRect ? anchorRect.left + anchorRect.width / 2 : 16,
                right: isDesktop ? undefined : 16,
                transform: isDesktop ? "translateX(-50%)" : undefined,
              }}
            >
              <NavbarSearchBar
                autoFocus
                className="w-full"
                onSearch={handleSearch}
                onScanClick={onScanClick}
                placeholder={placeholder}
                isActive={searchActive}
                onActiveChange={(active) => {
                  if (!active) handleCloseSearch();
                }}
                filterPill={
                  filter ? (
                    <FilterPill
                      type={filter.type}
                      label={filter.label}
                      thumbnailUrl={filter.thumbnailUrl}
                      onDismiss={() => setFilter(null)}
                    />
                  ) : undefined
                }
              />
            </div>

            {/* Dropdown */}
            <div
              className="fixed flex justify-center pointer-events-auto"
              style={{
                zIndex: 9999,
                top: isDesktop && anchorRect ? anchorRect.bottom + 8 : 76,
                left: isDesktop && anchorRect ? anchorRect.left + anchorRect.width / 2 : 16,
                right: isDesktop ? undefined : 16,
                transform: isDesktop ? "translateX(-50%)" : undefined,
              }}
            >
              <SearchDropdown
                isVisible={searchActive}
                query={searchQuery}
                filter={filter && filter.type !== "location" ? filter as { type: "link" | "collection" | "itinerary"; entityId?: string } : null}
                recentItems={recentItems}
                searchResults={displayResults}
                isLoading={searchLoading}
                hasMore={!filter?.entityId && (searchData?.hasMore ?? false)}
                onLoadMore={handleLoadMore}
                onSelectItem={handleSelectSearchResult}
                onSelectRecentItem={handleSelectRecentItem}
                onFilterByType={handleFilterByType}
                onFilterByItem={handleFilterByItem}
              />
            </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <header
        data-slot="navbar"
        className={cn(
          "navbar flex h-18 w-full items-center justify-center bg-surface px-4 py-3 lg:px-10",
          className,
        )}
      >
        <div className="flex w-full items-center justify-between gap-3 lg:gap-4">
          {isDesktop ? (
            <>
              {/* Left: Logo + Tabs */}
              <div className="flex flex-1 items-center gap-4 min-w-0">
                <NavbarLogo />
                <NavTabs tabs={tabs} />
              </div>

              {/* Center: anchor div */}
              <div ref={anchorRef} className="relative flex items-center justify-center">
                <div className={cn(searchActive && "invisible")}>
                  <NavbarSearchBar
                    onClick={() => setSearchActive(true)}
                    onSearch={handleSearch}
                    onScanClick={onScanClick}
                    placeholder={placeholder}
                    isActive={false}
                    onActiveChange={(active) => {
                      if (active) setSearchActive(true);
                    }}
                    filterPill={
                      filter ? (
                        <FilterPill
                          type={filter.type}
                          label={filter.label}
                          thumbnailUrl={filter.thumbnailUrl}
                          onDismiss={() => setFilter(null)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              </div>

              {/* Right: Create, Notifications, Profile */}
              <div className="flex flex-1 items-center justify-end gap-1 min-w-0">
                {menusMounted ? (
                  <NewMenuDropdown
                    onNewLink={onNewLink}
                    onNewCollection={onNewCollection}
                    onNewItinerary={onNewItinerary}
                  />
                ) : (
                  <Button variant="primary" size="sm" icon="leading" disabled>
                    <Plus className="size-4" />
                    New
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="md"
                  icon="only"
                  aria-label="Notifications"
                  onClick={() => onNotificationsClick?.()}
                  className="rounded-xl"
                >
                  <Bell className="size-4" />
                </Button>
                {menusMounted ? (
                  <NavbarProfileMenu avatar={avatar} />
                ) : (
                  <Button variant="ghost" size="md" icon="only" aria-label="Profile" disabled>
                    {avatar ?? <User className="size-4" />}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center">
                <NavbarLogo />
              </div>

              <div
                ref={anchorRef}
                className="flex min-w-[10rem] flex-1 items-center justify-center"
              >
                <div className={cn("w-full max-w-[26rem] sm:max-w-[28rem] md:max-w-[30rem]", searchActive && "invisible")}>
                  <NavbarSearchBar
                    className="bg-surface-alt border-edge"
                    onClick={() => setSearchActive(true)}
                    onSearch={handleSearch}
                    onScanClick={onScanClick}
                    placeholder={placeholder}
                    isActive={false}
                    onActiveChange={(active) => {
                      if (active) setSearchActive(true);
                    }}
                    filterPill={
                      filter ? (
                        <FilterPill
                          type={filter.type}
                          label={filter.label}
                          thumbnailUrl={filter.thumbnailUrl}
                          onDismiss={() => setFilter(null)}
                        />
                      ) : undefined
                    }
                  />
                </div>
              </div>

              <div className="flex shrink-0 items-center">
                {menusMounted ? (
                  <Menu>
                    <MenuTrigger
                      render={<Button variant="outline" size="md" icon="only" />}
                      aria-label="Open menu"
                    >
                      <MenuIcon className="size-4" />
                    </MenuTrigger>
                    <MenuContent align="end" sideOffset={8} className="w-[296px]" positionerClassName="z-50">
                      <DescriptiveMenuItem
                        leadingIcon={<CategoryBadge category="link" />}
                        title="Link"
                        description="Save a URL or video"
                        onClick={onNewLink}
                      />
                      <DescriptiveMenuItem
                        leadingIcon={<CategoryBadge category="collection" />}
                        title="Collection"
                        description="Group your links"
                        onClick={onNewCollection}
                      />
                      <DescriptiveMenuItem
                        leadingIcon={<CategoryBadge category="itinerary" />}
                        title="Itinerary"
                        description="Plan your next trip"
                        onClick={onNewItinerary}
                      />
                      <MenuSeparator />
                      <MenuItem
                        size="lg"
                        icon="leading"
                        leadingIcon={<Bell className="size-4" />}
                        onClick={() => onNotificationsClick?.()}
                      >
                        Notifications
                      </MenuItem>
                      <MenuItem
                        size="lg"
                        icon="leading"
                        leadingIcon={<CreditCard className="size-4" />}
                        onClick={() => router.push("/billing")}
                      >
                        Plan &amp; billing
                      </MenuItem>
                      <MenuItem
                        size="lg"
                        icon="leading"
                        leadingIcon={avatar ?? <User className="size-4" />}
                        onClick={handleSignOut}
                      >
                        Sign out
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : (
                  <Button
                    variant="outline"
                    size="md"
                    icon="only"
                    aria-label="Open menu"
                    disabled
                    className="rounded-xl opacity-100"
                  >
                    <MenuIcon className="size-4" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

    </>
  );
}

export { Navbar };
export type { NavbarProps };
