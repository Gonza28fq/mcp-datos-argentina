import { afterEach, describe, expect, it, vi } from "vitest";
import { hoy } from "./comun.js";

describe("hoy", () => {
  afterEach(() => vi.useRealTimers());

  it("usa la fecha argentina aunque en UTC ya sea el día siguiente", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T01:30:00Z")); // 22:30 del 9/11 en Buenos Aires
    expect(hoy()).toBe("2026-11-09");
  });

  it("coincide con UTC durante el día", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
    expect(hoy()).toBe("2026-11-10");
  });
});
