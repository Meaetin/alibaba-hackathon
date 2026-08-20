"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { Check, Copy, Globe, Link2, Loader2, UserPlus, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Avatar } from "@/components/ui/primitives/Avatar";
import { Button } from "@/components/ui/primitives/Button";
import { Switch } from "@/components/ui/primitives/Switch";
import { cn } from "@/lib/utils";
import { useToast } from "@/contexts/ToastContext";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

import {
  generateCollectionPublicToken,
  revokeCollectionPublicToken,
  generateCollectionInviteToken,
  revokeCollectionInviteToken,
  getCollectionCollaborators,
  removeCollectionCollaborator,
  type Collaborator,
} from "@/lib/api/collections";
import {
  generateItineraryPublicToken,
  revokeItineraryPublicToken,
  generateItineraryInviteToken,
  revokeItineraryInviteToken,
  getItineraryCollaborators,
  removeItineraryCollaborator,
  type ItineraryCollaborator,
} from "@/lib/api/itineraries";

// ───── Types ─────────────────────────────────────────────────────────────────

type CollaboratorItem = Collaborator | ItineraryCollaborator;
type ShareTab = "public" | "invite";

interface ShareTargetSummary {
  imageUrl?: string | null;
  locationLabel?: string | null;
  detailLabel?: string | null;
}

interface InviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: "itinerary" | "collection";
  entityId: string;
  entityName: string;
  isPublic: boolean;
  publicToken?: string | null;
  inviteToken?: string | null;
  inviteTokenExpiresAt?: string | null;
  userRole: "owner" | "collaborator" | null;
  onSharingChange?: (updates: SharingState) => void;
  sharingApi?: Partial<SharingApi>;
  renderMode?: "dialog" | "inline";
  initialTab?: ShareTab;
  targetSummary?: ShareTargetSummary;
}

interface SharingState {
  isPublic?: boolean;
  publicToken?: string | null;
  inviteToken?: string | null;
  inviteTokenExpiresAt?: string | null;
}

// ───── API helpers (injected by entity type) ─────────────────────────────────

interface SharingApi {
  generatePublicToken: (id: string) => Promise<{ token: string }>;
  revokePublicToken: (id: string) => Promise<void>;
  generateInviteToken: (id: string) => Promise<{ token: string; expires_at: string }>;
  revokeInviteToken: (id: string) => Promise<void>;
  getCollaborators: (id: string) => Promise<CollaboratorItem[]>;
  removeCollaborator: (id: string, userId: string) => Promise<void>;
}

const itineraryApi: SharingApi = {
  generatePublicToken: generateItineraryPublicToken,
  revokePublicToken: revokeItineraryPublicToken,
  generateInviteToken: generateItineraryInviteToken,
  revokeInviteToken: revokeItineraryInviteToken,
  getCollaborators: getItineraryCollaborators,
  removeCollaborator: removeItineraryCollaborator,
};

const collectionApi: SharingApi = {
  generatePublicToken: generateCollectionPublicToken,
  revokePublicToken: revokeCollectionPublicToken,
  generateInviteToken: generateCollectionInviteToken,
  revokeInviteToken: revokeCollectionInviteToken,
  getCollaborators: getCollectionCollaborators,
  removeCollaborator: removeCollectionCollaborator,
};

// ───── Component ─────────────────────────────────────────────────────────────

export function InviteModal({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  isPublic: initialIsPublic,
  publicToken: initialPublicToken,
  inviteToken: initialInviteToken,
  inviteTokenExpiresAt: initialInviteTokenExpiresAt,
  userRole,
  onSharingChange,
  sharingApi,
  renderMode = "dialog",
  initialTab = "public",
  targetSummary,
}: InviteModalProps) {
  const { showToast } = useToast();
  const defaultApi = entityType === "itinerary" ? itineraryApi : collectionApi;
  const api = useMemo<SharingApi>(
    () => ({ ...defaultApi, ...sharingApi }),
    [defaultApi, sharingApi],
  );
  const isOwner = userRole === "owner";

  // Public link state
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicToken, setPublicToken] = useState(initialPublicToken);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);

  // Invite link state
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [inviteExpiresAt, setInviteExpiresAt] = useState(initialInviteTokenExpiresAt);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);

  // Collaborators
  const [collaborators, setCollaborators] = useState<CollaboratorItem[]>([]);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(false);
  const [removingCollaboratorId, setRemovingCollaboratorId] = useState<string | null>(null);

  // Copy feedback
  const [copiedField, setCopiedField] = useState<"public" | "invite" | null>(null);

  // Active tab (controlled so we can auto-generate the invite link on view)
  const [activeTab, setActiveTab] = useState<ShareTab>(initialTab);
  const [shareOrigin, setShareOrigin] = useState("");
  const tabsId = useId();
  const publicTabId = `${tabsId}-public-tab`;
  const inviteTabId = `${tabsId}-invite-tab`;
  const publicPanelId = `${tabsId}-public-panel`;
  const invitePanelId = `${tabsId}-invite-panel`;
  const prefersReducedMotion = useReducedMotion();

  // Sync props → state
  useEffect(() => {
    setIsPublic(initialIsPublic);
    setPublicToken(initialPublicToken);
    setInviteToken(initialInviteToken);
    setInviteExpiresAt(initialInviteTokenExpiresAt);
  }, [initialIsPublic, initialPublicToken, initialInviteToken, initialInviteTokenExpiresAt]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setShareOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!open) return;
  }, [open, entityType, entityId, isOwner]);

  // Fetch collaborators when modal opens or tab switches to invite
  useEffect(() => {
    if (!open || !isOwner) return;
    setIsLoadingCollaborators(true);
    api.getCollaborators(entityId)
      .then(setCollaborators)
      .catch(() => setCollaborators([]))
      .finally(() => setIsLoadingCollaborators(false));
  }, [open, entityId, isOwner, api]);

  // ── Public link toggle ──
  const handlePublicToggle = useCallback(async (checked: boolean) => {
    setIsTogglingPublic(true);
    try {
      if (checked) {
        const { token } = await api.generatePublicToken(entityId);
        setIsPublic(true);
        setPublicToken(token);
        onSharingChange?.({ isPublic: true, publicToken: token });
      } else {
        await api.revokePublicToken(entityId);
        setIsPublic(false);
        setPublicToken(null);
        onSharingChange?.({ isPublic: false, publicToken: null });
      }
    } catch (err) {
      console.error("Failed to toggle public link:", err);
      showToast({ title: "Couldn't update sharing. Try again.", variant: "error" });
    } finally {
      setIsTogglingPublic(false);
    }
  }, [entityId, entityType, api, onSharingChange, showToast]);

  // ── Invite link ──
  const handleGenerateInvite = useCallback(async () => {
    setIsGeneratingInvite(true);
    try {
      const result = await api.generateInviteToken(entityId);
      setInviteToken(result.token);
      setInviteExpiresAt(result.expires_at);
      onSharingChange?.({ inviteToken: result.token, inviteTokenExpiresAt: result.expires_at });
    } catch (err) {
      console.error("Failed to generate invite:", err);
      showToast({ title: "Couldn't generate invite link. Try again.", variant: "error" });
    } finally {
      setIsGeneratingInvite(false);
    }
  }, [entityId, entityType, api, onSharingChange, showToast]);

  // Auto-generate the invite link the first time an owner views the Invite tab
  // (the "Generate" CTA was removed — the link is always shown).
  useEffect(() => {
    if (!open || activeTab !== "invite" || !isOwner) return;
    if (inviteToken || isGeneratingInvite) return;
    void handleGenerateInvite();
  }, [open, activeTab, isOwner, inviteToken, isGeneratingInvite, handleGenerateInvite]);

  // Reset to the Public tab whenever the modal is reopened
  useEffect(() => {
    if (!open) setActiveTab(initialTab);
  }, [open, initialTab]);

  const handleRevokeInvite = useCallback(async () => {
    try {
      await api.revokeInviteToken(entityId);
      setInviteToken(null);
      setInviteExpiresAt(null);
      onSharingChange?.({ inviteToken: null, inviteTokenExpiresAt: null });
    } catch (err) {
      console.error("Failed to revoke invite:", err);
      showToast({ title: "Couldn't revoke invite. Try again.", variant: "error" });
    }
  }, [entityId, entityType, api, onSharingChange, showToast]);

  // ── Remove collaborator ──
  const handleRemoveCollaborator = useCallback(async (userId: string) => {
    setRemovingCollaboratorId(userId);
    try {
      await api.removeCollaborator(entityId, userId);
      setCollaborators((prev) => prev.filter((c) => c.id !== userId));
    } catch (err) {
      console.error("Failed to remove collaborator:", err);
      showToast({ title: "Couldn't remove collaborator. Try again.", variant: "error" });
    } finally {
      setRemovingCollaboratorId(null);
    }
  }, [entityId, api, showToast]);

  // ── Copy to clipboard ──
  const copyToClipboard = useCallback(async (text: string, field: "public" | "invite") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
      showToast({ title: "Link copied", variant: "success" });
    } catch {
      console.error("Failed to copy");
      showToast({ title: "Couldn't copy link.", variant: "error" });
    }
  }, [showToast, entityType, entityId]);

  // ── Derived URLs ──
  const entityPath = entityType === "itinerary" ? "itineraries" : "collections";

  const publicUrl = shareOrigin && publicToken
    ? `${shareOrigin}/${entityPath}/public/${publicToken}`
    : "";

  const inviteUrl = shareOrigin && inviteToken
    ? `${shareOrigin}/invite/${entityType}/${inviteToken}`
    : "";

  // ── Time remaining for invite ──
  const inviteTimeRemaining = (() => {
    if (!inviteExpiresAt) return null;
    const expires = new Date(inviteExpiresAt).getTime();
    const now = Date.now();
    const diff = expires - now;
    if (diff <= 0) return "Expired";
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  })();

  const isInline = renderMode === "inline";

  const publicPanel = (
    <>
      {/* Toggle row */}
      <div className="share-modal-toggle-row flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="type-body-1 text-content font-medium">Public link</span>
          <span className="type-body-2 text-content-secondary">
            Anyone with the link can view this {entityType}
          </span>
        </div>
        <Switch
          size="sm"
          checked={isPublic}
          onCheckedChange={handlePublicToggle}
          disabled={isTogglingPublic || !isOwner}
          label="Toggle public link"
        />
      </div>

      {/* URL display */}
      {isPublic && publicUrl ? (
        <ShareUrlRow
          url={publicUrl}
          copied={copiedField === "public"}
          onCopy={() => copyToClipboard(publicUrl, "public")}
          ariaLabel="Copy public link"
          reduceMotion={prefersReducedMotion ?? false}
        />
      ) : !isPublic ? (
        <p className="share-modal-description type-body-2 text-content-secondary">
          Turn on public sharing to generate a read-only link.
        </p>
      ) : null}
    </>
  );

  const invitePanel = (
    <>
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 flex-col">
          <span className="type-body-1 font-medium text-content">Invite link</span>
          <span className="type-body-3 text-content-secondary">
            New collaborators can join until the link expires.
          </span>
        </div>
      </div>

      {/* Invite link - always shown (auto-generated for owners on tab view) */}
      {inviteUrl ? (
        <ShareUrlRow
          url={inviteUrl}
          copied={copiedField === "invite"}
          onCopy={() => copyToClipboard(inviteUrl, "invite")}
          ariaLabel="Copy invite link"
          reduceMotion={prefersReducedMotion ?? false}
        />
      ) : (
        <LoadingLinkRow label="Creating invite link" />
      )}

      {/* Invite meta - expiry + revoke (owner) */}
      {inviteToken && (
        <div className="share-modal-invite-meta flex items-center justify-between">
          <span className="type-body-2 font-medium text-content-secondary">
            {inviteTimeRemaining ? `Expires in ${inviteTimeRemaining}` : "Active"}
          </span>
          {isOwner && (
            <button
              type="button"
              onClick={handleRevokeInvite}
              className="share-modal-revoke-button type-body-2 font-medium text-content-error transition-opacity hover:opacity-80"
            >
              Revoke link
            </button>
          )}
        </div>
      )}

      {/* Collaborators section */}
      <div className="share-modal-collaborators flex flex-col gap-3 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="share-modal-collaborators-heading type-body-1 font-semibold text-content">
            People with access
          </h4>
        </div>
        {isLoadingCollaborators ? (
          <div className="flex h-12 items-center justify-center rounded-xl border border-edge bg-surface-alt text-content-secondary">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : collaborators.length === 0 ? (
          <p className="rounded-xl border border-edge bg-surface-alt px-3 py-3 type-body-2 text-content-secondary">
            No one has joined yet.
          </p>
        ) : (
          <ul className="share-modal-collaborator-list flex flex-col gap-2">
            {collaborators.map((c) => (
              <CollaboratorRow
                key={c.id}
                collaborator={c}
                onRemove={handleRemoveCollaborator}
                isRemoving={removingCollaboratorId === c.id}
                canRemove={isOwner}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );

  const popupContent = (
    <>
      {/* Header Section */}
      <div className="share-modal-header flex w-full items-start gap-3 px-5 pb-4 pt-5">
        <ShareTargetHeader
          entityName={entityName}
          targetSummary={targetSummary}
        />
        {isInline ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="only"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="share-modal-close shrink-0 text-content-secondary"
          >
            <X className="size-4" />
          </Button>
        ) : (
          <Dialog.Close
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="only"
                aria-label="Close"
                className="share-modal-close shrink-0 text-content-secondary"
              />
            }
          >
            <X className="size-4" />
          </Dialog.Close>
        )}
      </div>

      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as ShareTab)}
        className="share-modal-tabs flex flex-col w-full"
      >
        <Tabs.List className="share-modal-tab-list mx-5 mb-1 flex items-center gap-1 border-b border-edge-subtle">
          <Tabs.Tab
            id={publicTabId}
            value="public"
            aria-controls={publicPanelId}
            className={cn(SHARE_TAB_CLASS)}
          >
            <span className="flex size-5 items-center justify-center">
              <Globe className="size-4" />
            </span>
            Public link
          </Tabs.Tab>
          <Tabs.Tab
            id={inviteTabId}
            value="invite"
            aria-controls={invitePanelId}
            className={cn(SHARE_TAB_CLASS)}
          >
            <span className="flex size-5 items-center justify-center">
              <UserPlus className="size-4" />
            </span>
            Invite
          </Tabs.Tab>
        </Tabs.List>

        <AnimatedSharePanel
          activeTab={activeTab}
          publicPanel={publicPanel}
          invitePanel={invitePanel}
          publicPanelId={publicPanelId}
          invitePanelId={invitePanelId}
          publicTabId={publicTabId}
          inviteTabId={inviteTabId}
          reduceMotion={Boolean(prefersReducedMotion)}
        />
      </Tabs.Root>
    </>
  );

  if (isInline) {
    if (!open) return null;
    return (
      <div
        className={cn(
          "share-modal-popup flex w-[min(30rem,calc(100vw-2rem))] flex-col items-stretch overflow-hidden rounded-2xl",
          "bg-surface border border-edge-subtle shadow-default",
        )}
      >
        {popupContent}
      </div>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="share-modal-backdrop fixed inset-0 bg-black/50 z-40 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "share-modal-popup fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "flex w-[min(30rem,calc(100vw-2rem))] flex-col items-stretch overflow-hidden rounded-2xl",
            "bg-surface border border-edge-subtle shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {popupContent}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ───── Sub-components ──────────────────────────────────────────────────────────

function ShareTargetHeader({
  entityName,
  targetSummary,
}: {
  entityName: string;
  targetSummary?: ShareTargetSummary;
}) {
  const titleInitial = entityName.trim().charAt(0).toUpperCase();
  const locationLabel = targetSummary?.locationLabel?.trim();
  const detailLabel = targetSummary?.detailLabel?.trim();

  return (
    <div className="share-modal-target-header min-w-0 flex flex-1 items-center gap-4">
      <div className="share-modal-target-banner size-20 shrink-0 overflow-hidden rounded-full border-[1.25px] border-edge bg-surface p-1 shadow-default">
        <div className="size-full overflow-hidden rounded-full border-[1.25px] border-edge bg-surface-muted">
          {targetSummary?.imageUrl ? (
            <img
              src={targetSummary.imageUrl}
              alt={entityName}
              className="size-full rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex size-full items-center justify-center rounded-full bg-surface-alt">
              <span className="type-body-1 font-medium text-content-secondary">
                {titleInitial}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="share-modal-target-info min-w-0 flex flex-col items-start justify-center gap-1.5">
        <h3 className="share-modal-title type-h4 type-secondary font-semibold text-content truncate">
          {entityName}
        </h3>
        {locationLabel && (
          <p className="share-modal-location type-body-2 font-medium text-content-secondary truncate">
            {locationLabel}
          </p>
        )}
        {detailLabel && (
          <p className="share-modal-dates type-body-2 text-content-secondary truncate">
            {detailLabel}
          </p>
        )}
      </div>
    </div>
  );
}

/** Underline tab styling aligned with the shared Tab primitive. */
const SHARE_TAB_CLASS = cn(
  "share-modal-tab relative inline-flex h-[43px] flex-1 shrink-0 items-center justify-center gap-1.5 px-3",
  "border-b-[3px] border-transparent type-body-2 whitespace-nowrap transition-colors",
  "text-glyph font-normal hover:font-medium hover:border-edge-muted",
  "data-[active]:border-edge-brand data-[active]:font-medium data-[active]:text-content",
  "outline-none focus-visible:ring-2 focus-visible:ring-edge-strong/50",
);

const SHARE_PANEL_HEIGHT_TRANSITION: Transition = {
  type: "spring",
  duration: 0.34,
  bounce: 0,
};

const SHARE_PANEL_CONTENT_TRANSITION: Transition = {
  duration: 0.16,
  ease: [0.22, 1, 0.36, 1],
};

function AnimatedSharePanel({
  activeTab,
  publicPanel,
  invitePanel,
  publicPanelId,
  invitePanelId,
  publicTabId,
  inviteTabId,
  reduceMotion,
}: {
  activeTab: ShareTab;
  publicPanel: ReactNode;
  invitePanel: ReactNode;
  publicPanelId: string;
  invitePanelId: string;
  publicTabId: string;
  inviteTabId: string;
  reduceMotion: boolean;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const activePanel = activeTab === "public" ? publicPanel : invitePanel;
  const activePanelId = activeTab === "public" ? publicPanelId : invitePanelId;
  const activeTabId = activeTab === "public" ? publicTabId : inviteTabId;
  const enterOffset = activeTab === "invite" ? 6 : -6;
  const exitOffset = activeTab === "invite" ? -4 : 4;

  useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node || reduceMotion) {
      setHeight("auto");
      return;
    }

    const updateHeight = () => {
      setHeight(node.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);

    return () => observer.disconnect();
  }, [activeTab, reduceMotion]);

  return (
    <motion.div
      className="share-modal-panel-motion relative overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={reduceMotion ? { duration: 0 } : SHARE_PANEL_HEIGHT_TRANSITION}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={activeTab}
          ref={contentRef}
          role="tabpanel"
          id={activePanelId}
          aria-labelledby={activeTabId}
          className="share-modal-panel flex flex-col gap-4 px-5 pb-5 pt-3 outline-none"
          initial={reduceMotion ? false : { opacity: 0, y: enterOffset }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: exitOffset }}
          transition={reduceMotion ? { duration: 0 } : SHARE_PANEL_CONTENT_TRANSITION}
        >
          {activePanel}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** Read-only URL row with a copy button (Figma "URL Input"). */
function ShareUrlRow({
  url,
  copied,
  onCopy,
  ariaLabel,
  reduceMotion,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  ariaLabel: string;
  reduceMotion: boolean;
}) {
  return (
    <div className="share-modal-url-row flex h-11 items-center gap-1.5 rounded-xl border border-edge bg-surface px-2 shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]">
      <span className="share-modal-url-icon flex size-5 items-center justify-center text-content-secondary shrink-0">
        <Link2 className="size-4" />
      </span>
      <span className="share-modal-url-text type-body-1 text-content truncate min-w-0 flex-1">
        {url}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon="only"
        onClick={onCopy}
        className="share-modal-copy-button shrink-0 text-content-secondary"
        aria-label={ariaLabel}
      >
        <span className="relative flex size-3.5 items-center justify-center" aria-hidden="true">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={copied ? "copied" : "copy"}
              className="absolute inset-0 flex items-center justify-center"
              initial={reduceMotion ? false : motionPresets.iconSwap.initial}
              animate={motionPresets.iconSwap.animate}
              exit={reduceMotion ? { opacity: 0 } : motionPresets.iconSwap.exit}
              transition={reduceMotion ? motionTransitions.instant : motionTransitions.iconSwap}
            >
              {copied ? (
                <Check className="size-3.5 text-content-success" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </Button>
    </div>
  );
}

function LoadingLinkRow({ label }: { label: string }) {
  return (
    <div className="share-modal-loading-row flex h-11 items-center justify-center gap-2 rounded-xl border border-edge bg-surface px-3 text-content-secondary shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]">
      <Loader2 className="size-4 animate-spin" />
      <span className="type-body-2">{label}</span>
    </div>
  );
}

/** Single collaborator row (Figma "CollaboratorItem" — 1095:137). */
function CollaboratorRow({
  collaborator,
  onRemove,
  isRemoving,
  canRemove,
}: {
  collaborator: CollaboratorItem;
  onRemove: (userId: string) => void;
  isRemoving: boolean;
  canRemove: boolean;
}) {
  return (
    <li className="share-modal-collaborator-item flex h-12 items-center gap-2 rounded-xl border border-edge bg-surface pl-3 pr-2 py-2">
      <Avatar size="sm" name={collaborator.email} className="shrink-0" />
      <span className="type-body-2 text-content truncate min-w-0 flex-1">
        {collaborator.email}
      </span>
      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          icon="only"
          onClick={() => onRemove(collaborator.id)}
          disabled={isRemoving}
          className="share-modal-remove-collaborator shrink-0 text-content-secondary hover:text-content-error"
          aria-label={`Remove ${collaborator.email}`}
        >
          {isRemoving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <X className="size-4" />
          )}
        </Button>
      )}
    </li>
  );
}

export type { InviteModalProps, SharingState };
