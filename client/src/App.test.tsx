import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders scaffold text", () => {
    render(<App />);
    expect(screen.getByText("Darkness Caress II")).toBeInTheDocument();
  });
});
