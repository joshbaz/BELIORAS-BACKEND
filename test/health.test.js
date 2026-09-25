/* Health Endpoint Tests */

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { api, teardown } from "./helpers.js";

after(async () => {
  await teardown();
});

describe("health", () => {
  it("GET /api/v1/health reports db and redis status", async () => {
    const res = await api().then((request) => request.get("/api/v1/health"));
    // Status is 200 if everything is up, 503 if degraded — both are valid in CI.
    assert.ok([200, 503].includes(res.status));
    assert.ok(["ok", "degraded"].includes(res.body.data.status));
    assert.ok(["connected", "unavailable"].includes(res.body.data.db));
    assert.ok(["connected", "unavailable"].includes(res.body.data.redis));
  });

  it("GET / exposes the API banner", async () => {
    const res = await api().then((request) => request.get("/"));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, "Belioras API");
  });
});