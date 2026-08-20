"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Globe, MapPin, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives/Button";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { DataPill } from "@/components/ui/primitives/DataPill";
import { cn } from "@/lib/utils";
import { getPublicCollection, type PublicCollection } from "@/lib/api/collections";
import { getFriendlyApiError } from "@/lib/errors/userMessages";

export default function PublicCollectionPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [collection, setCollection] = useState<PublicCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicCollection(token)
      .then((data) => {
        setCollection(data);
      })
      .catch((err) => {
        console.error("Failed to load public collection:", err);
        setError(getFriendlyApiError(err, "We couldn’t load this collection. The link may be invalid or no longer shared."));
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="public-collection-loading min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-content-secondary" />
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="public-collection-error min-h-screen bg-surface flex flex-col items-center justify-center gap-2 p-3">
        <p className="type-body-1 text-content-secondary">{error || "We couldn’t load this collection."}</p>
        <Button variant="ghost" onClick={() => router.push("/")}>Go home</Button>
      </div>
    );
  }

  const location = [collection.region, collection.country].filter(Boolean).join(", ");
  const locationCount = collection.locations.length;

  return (
    <div className="public-collection-page min-h-screen bg-surface">
      {/* Public banner */}
      <div className="public-banner flex items-center justify-center gap-2 bg-surface-muted/50 border-b border-edge py-2 px-3">
        <Globe className="size-3.5 text-content-secondary" />
        <span className="type-body-2 text-content-secondary">
          You&apos;re viewing a public collection
        </span>
        <button
          type="button"
          className="public-banner-cta type-body-2 text-content underline-offset-2 hover:underline"
          onClick={() => router.push("/login")}
        >
          Sign in to save spots
        </button>
      </div>

      <div className="public-collection-content max-w-2xl mx-auto px-3 py-8 flex flex-col gap-8">
        {/* Header */}
        <div className="public-collection-header flex flex-col gap-3">
          <div className="public-collection-title-row flex items-start gap-2">
            <div className="public-collection-icon mt-0.5">
              <CategoryBadge category="collection" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <h1 className="type-h1 font-secondary font-semibold text-glyph">
                {collection.name}
              </h1>
              {location && (
                <div className="public-collection-location flex items-center gap-1.5 text-content-secondary">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="type-body-2">{location}</span>
                </div>
              )}
            </div>
          </div>

          <div className="public-collection-meta flex flex-wrap gap-2">
            <DataPill
              icon={<Layers className="size-3.5" />}
              data={locationCount}
              label={locationCount === 1 ? "location" : "locations"}
              leading="icon"
            />
          </div>
        </div>

        {/* Locations grid */}
        {collection.locations.length > 0 ? (
          <div className="public-location-grid grid grid-cols-1 sm:grid-cols-2 gap-2">
            {collection.locations.map((loc) => {
              const coverPhoto = loc.photo_urls?.[0];
              return (
                <div
                  key={loc.id}
                  className={cn(
                    "public-location-card flex items-center gap-2 rounded-xl p-2",
                    "bg-surface-alt border border-edge",
                  )}
                >
                  {coverPhoto ? (
                    <img
                      src={coverPhoto}
                      alt=""
                      className="public-location-photo size-12 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="public-location-placeholder size-12 rounded-lg bg-surface-muted shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="type-body-2 font-medium text-glyph truncate">
                      {loc.name}
                    </span>
                    {loc.formatted_address && (
                      <span className="type-body-3 text-content-secondary truncate">
                        {loc.formatted_address}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="type-body-2 text-content-secondary">No locations in this collection yet.</p>
        )}

        {/* Footer CTA */}
        <div className="public-collection-footer flex flex-col items-center gap-2 py-6 border-t border-edge">
          <span className="type-body-2 text-content-secondary">Discover and save travel spots with Argo</span>
          <Button onClick={() => router.push("/login")} className="public-cta-button">
            Get started for free
          </Button>
        </div>
      </div>
    </div>
  );
}
