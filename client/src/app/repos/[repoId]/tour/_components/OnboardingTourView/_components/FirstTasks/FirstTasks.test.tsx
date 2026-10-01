import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { FirstTasks } from "./FirstTasks";

afterEach(cleanup);

const renderIt = (tasks: { text: string; paths: string[] }[]) =>
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

  it("shows the empty line when there are no tasks", () => {
    renderIt([]);
    expect(screen.getByText("No starter tasks could be tied to files in this repo.")).toBeInTheDocument();
  });
});
