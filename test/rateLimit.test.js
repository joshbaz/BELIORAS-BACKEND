/* Rate Limit Tests */

import "dotenv/config";
import assert from "node:assert/strict";
import express from "express";
import { describe, it } from "node:test";
import request from "supertest";
import { createAuthLimiter } from "../src/middlewares/rateLimit.js";
import { requestId } from "../src/middlewares/requestId.js";

describe("rate limiting", () => {
  it("returns 429 with the error envelope after the limit", async () => {
    const app = express();
    app.use(requestId);
    app.use(createAuthLimiter({ enabled: true, limit: 3 }));
    app.post("/login", (req, res) => res.json({ data: { ok: true } }));

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/login");
      assert.equal(res.status, 200);
    }

    const blocked = await request(app).post("/login");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
    assert.ok(blocked.body.error.requestId);
  });
});