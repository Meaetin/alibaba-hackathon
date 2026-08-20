import type { SupabaseClient } from "@supabase/supabase-js";

type ViewableEntityType = "link" | "collection" | "itinerary";

export async function recordView(
  supabase: SupabaseClient,
  entityType: ViewableEntityType,
  entityId: string,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("recently_viewed").upsert(
    {
      user_id: user.id,
      entity_type: entityType,
      entity_id: entityId,
      viewed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entity_type,entity_id" },
  );
}
