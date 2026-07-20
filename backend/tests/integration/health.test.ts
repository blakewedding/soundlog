import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

describe("GET /api/health", () => {
  it("responds with a status payload", async () => {
    const res = await request(createApp()).get("/api/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("checks");
  });
});
