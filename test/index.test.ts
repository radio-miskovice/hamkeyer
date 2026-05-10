import { describe, expect, it } from "vitest";
import {
  connectSerialSession,
  isWebSerialSupported
} from "../src/index";

describe("isWebSerialSupported", () => {
  it("returns false in non-browser runtime", () => {
    expect(isWebSerialSupported()).toBe(false);
  });
});

describe("connectSerialSession", () => {
  it("throws when Web Serial is unavailable", async () => {
    await expect(
      connectSerialSession({ baudRate: 1200 })
    ).rejects.toThrowError("Web Serial API is not supported in this browser context.");
  });
});
