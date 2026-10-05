import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import type { OnboardingTask } from "@devdigest/shared";
import { FirstTasks } from "./FirstTasks";

afterEach(cleanup);

const renderIt = (tasks: OnboardingTask[]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <FirstTasks tasks={tasks} fullName="acme/api" branch="main" />
    </NextIntlClientProvider>,
  );

describe("FirstTasks", () => {
  it("renders the task text with each named path as a GitHub link", () => {
    renderIt([{ text: "Add a health check route", paths: ["src/routes.ts", "src/app.ts"] }]);
    expect(screen.getByText("Add a health check route", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "src/routes.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/main/src/routes.ts",
    );
    expect(screen.getByRole("link", { name: "src/app.ts" })).toBeInTheDocument();
  });

  it("labels each task with its complexity: green for low, amber otherwise, none when absent", () => {
    renderIt([
      { text: "Add a probe", paths: ["src/a.ts"], complexity: "low" },
      { text: "Backfill tests", paths: ["src/b.ts"], complexity: "medium" },
      { text: "Rework auth", paths: ["src/c.ts"], complexity: "high" },
      { text: "Legacy task", paths: ["src/d.ts"] },
      { text: "Unsure task", paths: ["src/e.ts"], complexity: null },
    ]);
    expect(screen.getByText("Low complexity").style.color).toBe("var(--ok)");
    expect(screen.getByText("Medium complexity").style.color).toBe("var(--warn)");
    expect(screen.getByText("High complexity").style.color).toBe("var(--warn)");
    expect(screen.getAllByText(/complexity$/)).toHaveLength(3);
  });

  it("shows the empty line when there are no tasks", () => {
    renderIt([]);
    expect(screen.getByText("No starter tasks could be tied to files in this repo.")).toBeInTheDocument();
  });
});
