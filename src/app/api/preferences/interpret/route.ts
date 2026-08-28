import { NextResponse } from "next/server";

import { interpretPreferenceText, sanitizeInterpretation } from "@/lib/preferences/interpreter";
import { PREFERENCE_REGISTRY } from "@/lib/preferences/registry";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 600;

interface AnthropicContentBlock {
  type?: string;
  name?: string;
  input?: unknown;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a preference to interpret." }, { status: 400 });
  }

  const text =
    body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";

  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Enter between 1 and ${MAX_TEXT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const fallback = interpretPreferenceText(text);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;
  if (!apiKey || !model) return NextResponse.json(fallback);

  try {
    const allowed = PREFERENCE_REGISTRY.map(({ id, label, category }) => ({ id, label, category }));
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        system:
          "Map the traveller's text only to the supplied canonical preference IDs. " +
          "Do not invent IDs. Negated interests are not positive interests. Dietary allergies and ambiguous schedule constraints must remain reviewable.",
        messages: [
          {
            role: "user",
            content: `Canonical preferences:\n${JSON.stringify(allowed)}\n\nTraveller text:\n${text}`,
          },
        ],
        tools: [
          {
            name: "interpret_preferences",
            description: "Return canonical preferences found in the traveller text.",
            input_schema: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", enum: PREFERENCE_REGISTRY.map(({ id }) => id) },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      evidence: { type: "string" },
                    },
                    required: ["id", "confidence", "evidence"],
                  },
                },
                unresolved: { type: "array", items: { type: "string" } },
              },
              required: ["items", "unresolved"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "interpret_preferences" },
      }),
    });

    if (!response.ok) throw new Error(`Anthropic returned ${response.status}.`);
    const payload = (await response.json()) as { content?: AnthropicContentBlock[] };
    const toolUse = payload.content?.find(
      (block) => block.type === "tool_use" && block.name === "interpret_preferences",
    );
    const interpreted = sanitizeInterpretation(toolUse?.input);
    return NextResponse.json(interpreted ?? fallback);
  } catch (error) {
    console.error("Failed to interpret travel preferences with Anthropic:", error);
    return NextResponse.json(fallback);
  }
}

