// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUESTIONS, calculatePersona } from "@/lib/persona/quiz";

import { PersonaCard } from "./PersonaCard";

afterEach(cleanup);

describe("PersonaCard", () => {
  it("invites a traveller without a persona to take the quiz", () => {
    const onAction = vi.fn();
    render(<PersonaCard onAction={onAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Persona Quiz" }));

    expect(screen.getByText("Find Your Travel Persona")).toBeTruthy();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("shows the saved persona and opens its full details", () => {
    const onAction = vi.fn();
    const persona = calculatePersona(QUESTIONS.map(() => 0));
    render(<PersonaCard persona={persona} onAction={onAction} />);

    expect(screen.getByRole("img", { name: persona.archetype.name })).toBeTruthy();
    expect(screen.getByText(persona.archetype.name)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View Full Details" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
