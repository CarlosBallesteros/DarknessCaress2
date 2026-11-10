import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import App from "./App";

describe("App (phase-1 shell)", () => {
  it("renders without crashing", () => {
    expect(renderToString(<App />)).toContain("<main");
  });
});
