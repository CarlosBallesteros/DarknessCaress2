import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the landing title (the product's face)", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Darkness Caress II" })).toBeTruthy();
  });
});
