// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QUESTIONS, calculatePersona } from "@/lib/persona/quiz";
import { PersonaQuizDialog } from "./PersonaQuizDialog";

afterEach(cleanup);

describe("PersonaQuizDialog keyboard shortcuts", () => {
  it("selects and focuses options with the 1, 2, and 3 keys", () => {
    render(
      <PersonaQuizDialog
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Quiz" }));

    const options = screen.getAllByRole("radio");
    fireEvent.keyDown(window, { key: "2" });

    expect(options[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].getAttribute("aria-keyshortcuts")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const nextOptions = screen.getAllByRole("radio");
    fireEvent.keyDown(nextOptions[1], { key: "3" });

    expect(nextOptions[2].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(nextOptions[2]);
  });

  it("does not claim modified number shortcuts", () => {
    render(
      <PersonaQuizDialog
        open
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Quiz" }));
    fireEvent.keyDown(window, { key: "3", metaKey: true });

    expect(screen.getAllByRole("radio").every((option) => option.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("announces a retake before returning to the intro screen", () => {
    const onRetake = vi.fn();
    const answers = QUESTIONS.map(() => 0);

    render(
      <PersonaQuizDialog
        open
        onOpenChange={vi.fn()}
        persona={calculatePersona(answers)}
        onRetake={onRetake}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retake" }));

    expect(onRetake).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Start Quiz" })).toBeTruthy();
  });
});
