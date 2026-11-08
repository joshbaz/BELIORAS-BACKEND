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

  it("GET / and /status show the live page to a browser", async () => {
    const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    for (const path of ["/", "/status"]) {
      const res = await api().then((request) => request.get(path).set("Accept", browser));
      assert.equal(res.status, 200);
      assert.match(res.headers["content-type"], /text\/html/);
      assert.match(res.text, /Belioras Server is Live/);
    }
    const logo = await api().then((request) => request.get("/logo.svg"));
    assert.equal(logo.status, 200);
  });
});