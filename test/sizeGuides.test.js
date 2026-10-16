/* Size Guides Tests */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { api, uniqueEmail } from "./helpers.js";
import { SEED_SIZE_GUIDES } from "../src/features/sizeGuides/seed.js";
import { GUIDE_BODY_SCHEMAS, GUIDE_TYPES } from "../src/versions/v1/schemas/sizeGuides.schema.js";

/**
 * The size guides are the first content the dashboard can write to the server,
 * so these cover the three things that could go wrong: who is allowed to write,
 * that a write is all-or-nothing, and that the three guides stay separate.
 *
 * Seeds its own staff rather than leaning on another test file, and clears the
 * guides on the way out — the reset test in particular would otherwise leave the
 * shared test database with edited content for whatever runs next.
 */

const PUBLIC = "/api/v1/storefront/size-guides";
const ADMIN = "/api/v1/admin/size-guides";
const TEMP_PASSWORD = "Temporary123";

const created = [];

async function seedStaff(role) {
  const { prisma } = await import("../src/db/prisma.js");
  const bcrypt = (await import("bcryptjs")).default;
  const email = uniqueEmail(role);
  created.push(email);
  await prisma.user.create({
    data: {
      realm: "staff",
      name: "Seeded Staff",
      email,
      role,
      passwordHash: bcrypt.hashSync(TEMP_PASSWORD, 10),
      mustChangePassword: false,
    },
  });
  return email;
}

async function tokenFor(role) {
  const email = await seedStaff(role);
  const res = await api().then((request) =>
    request.post("/api/v1/admin/auth/login").send({ email, password: TEMP_PASSWORD }),
  );
  assert.equal(res.status, 200, `login failed for ${role}: ${JSON.stringify(res.body)}`);
  return `Bearer ${res.body.data.accessToken}`;
}

/** A valid copy of a shipped guide, safe to mutate per test. */
function guideOf(type) {
  return structuredClone(SEED_SIZE_GUIDES[type]);
}

async function cleanupCreated() {
  const { prisma } = await import("../src/db/prisma.js");
  const users = await prisma.user.findMany({ where: { email: { in: created } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  // The guides are shared, so hand them back to the shipped versions.
  for (const type of GUIDE_TYPES) {
    await prisma.sizeGuide.upsert({
      where: { type },
      create: { type, data: SEED_SIZE_GUIDES[type] },
      update: { data: SEED_SIZE_GUIDES[type] },
    });
  }
  await prisma.$disconnect();
}

before(async () => {
  // Start from the shipped guides so a leftover from another run cannot decide
  // whether this file passes.
  await cleanupCreated();
});

after(async () => {
  await cleanupCreated();
  const { teardown } = await import("./helpers.js");
  await teardown();
});

describe("size guide reads", () => {
  it("serves all three guides to an anonymous shopper", async () => {
    const res = await api().then((request) => request.get(PUBLIC));

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.data).sort(), ["footwear", "garment", "hair"]);

    const { garment } = res.body.data;
    assert.ok(garment.note, "the garment guide should carry its note");
    assert.ok(garment.rows.length, "the garment guide should carry its rows");
    assert.ok(garment.international.columns.length, "garment should carry its international columns");
    assert.ok(garment.howTo.length, "each guide carries its own how-to steps");
  });

  it("keeps the three guides shaped differently, rather than merging them", async () => {
    const { data } = (await api().then((request) => request.get(PUBLIC))).body;

    // The regression this is here for: all three once shared one `howToMeasure`
    // key, so editing one guide's steps changed the other two.
    const steps = [data.garment.howTo, data.footwear.howTo, data.hair.howTo].map((s) => s.map((x) => x.term).join("|"));
    assert.equal(new Set(steps).size, 3, "each guide should have its own how-to steps");

    assert.ok("lengths" in data.hair && "textures" in data.hair, "hair holds lengths and textures");
    assert.ok(!("lengths" in data.garment), "garment should not carry hair fields");
    assert.ok(data.footwear.rows[0].eu !== undefined, "footwear rows are conversions, not ranges");
    assert.ok(Array.isArray(data.garment.rows[0].bust), "garment rows carry body ranges");
  });

  it("serves the guides to staff without a role gate, since they are public content", async () => {
    const bearer = await tokenFor("support");
    const res = await api().then((request) => request.get(ADMIN).set("Authorization", bearer));
    assert.equal(res.status, 200);
  });

  it("refuses the staff read to an anonymous caller", async () => {
    const res = await api().then((request) => request.get(ADMIN));
    assert.equal(res.status, 401);
  });

  it("refuses a customer token on the staff read", async () => {
    const email = uniqueEmail("shopper");
    const res = await api().then((request) =>
      request.post("/api/v1/storefront/auth/register").send({ email, name: "Shopper", password: "Shopper123" }),
    );
    assert.equal(res.status, 201);
    const bearer = `Bearer ${res.body.data.accessToken}`;

    const denied = await api().then((request) => request.get(ADMIN).set("Authorization", bearer));
    assert.equal(denied.status, 403, "a shopper must not reach the staff size-guide routes");
  });

  it("404s an unknown guide type instead of guessing", async () => {
    const bearer = await tokenFor("content");
    const res = await api().then((request) => request.get(`${ADMIN}/jewellery`).set("Authorization", bearer));
    assert.equal(res.status, 404);
  });
});

describe("size guide writes", () => {
  it("replaces a whole guide in one request and persists it", async () => {
    const bearer = await tokenFor("content");
    const guide = guideOf("footwear");
    guide.rows[0].eu = 37;
    guide.note = "Fits true to size.";

    const res = await api().then((request) =>
      request.put(`${ADMIN}/footwear`).set("Authorization", bearer).send(guide),
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.type, "footwear");
    assert.equal(res.body.data.rows[0].eu, 37);

    const { prisma } = await import("../src/db/prisma.js");
    const stored = await prisma.sizeGuide.findUnique({ where: { type: "footwear" } });
    assert.equal(stored.data.rows[0].eu, 37, "the edit should be in the database, not just the response");
  });

  it("leaves the other two guides untouched when one is saved", async () => {
    const bearer = await tokenFor("content");
    const before = (await api().then((request) => request.get(PUBLIC))).body.data;

    const hair = guideOf("hair");
    hair.textures[0].note = "Measures longer than stated.";
    await api().then((request) => request.put(`${ADMIN}/hair`).set("Authorization", bearer).send(hair));

    const after = (await api().then((request) => request.get(PUBLIC))).body.data;
    assert.deepEqual(after.garment, before.garment, "saving hair must not touch garment");
    assert.deepEqual(after.footwear, before.footwear, "saving hair must not touch footwear");
  });

  it("refuses an unknown role", async () => {
    const bearer = await tokenFor("support");
    const res = await api().then((request) =>
      request.put(`${ADMIN}/garment`).set("Authorization", bearer).send(guideOf("garment")),
    );
    assert.equal(res.status, 403, "a role without edit rights must not write a size guide");
  });

  it("refuses an anonymous write", async () => {
    const res = await api().then((request) => request.put(`${ADMIN}/garment`).send(guideOf("garment")));
    assert.equal(res.status, 401);
  });
});

describe("size guide validation", () => {
  it("rejects a body that is not shaped like the guide being saved", async () => {
    const bearer = await tokenFor("content");
    // A hair guide posted to /garment is well-formed JSON and the wrong document.
    const res = await api().then((request) =>
      request.put(`${ADMIN}/garment`).set("Authorization", bearer).send(guideOf("hair")),
    );
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details?.fieldErrors, "the caller should be told which fields are wrong");
  });

  it("rejects a body measurement whose smallest is above its largest", async () => {
    const bearer = await tokenFor("content");
    const guide = guideOf("garment");
    guide.rows[0].bust = [96, 88];

    const res = await api().then((request) =>
      request.put(`${ADMIN}/garment`).set("Authorization", bearer).send(guide),
    );
    assert.equal(res.status, 400);
    assert.match(
      res.body.error.details.fieldErrors["rows.0.bust.0"] ?? "",
      /smallest/,
      "the message should explain the problem, not just that something is wrong",
    );
  });

  it("rejects a row that is missing a measurement the guide requires", async () => {
    const bearer = await tokenFor("content");
    const guide = guideOf("footwear");
    delete guide.rows[0].cm;

    const res = await api().then((request) =>
      request.put(`${ADMIN}/footwear`).set("Authorization", bearer).send(guide),
    );
    assert.equal(res.status, 400);
  });

  it("leaves the previous guide in place when a save is rejected", async () => {
    const bearer = await tokenFor("content");

    const good = guideOf("hair");
    good.lengths[0].in = 14;
    await api().then((request) => request.put(`${ADMIN}/hair`).set("Authorization", bearer).send(good));

    const broken = guideOf("hair");
    broken.lengths[0].in = 99; // the intended edit
    broken.lengths[1].falls = 42; // which fails validation
    const res = await api().then((request) =>
      request.put(`${ADMIN}/hair`).set("Authorization", bearer).send(broken),
    );
    assert.equal(res.status, 400);

    // The whole point of one document per guide: the rejected edit applied no
    // part of itself, so the valid row is still the last one saved.
    const { data } = (await api().then((request) => request.get(PUBLIC))).body;
    assert.equal(data.hair.lengths[0].in, 14, "a rejected save must not half-apply");
  });
});

describe("size guide reset", () => {
  it("puts every guide back to the shipped version", async () => {
    const bearer = await tokenFor("content");

    const edited = guideOf("garment");
    edited.rows[0].size = "XXL";
    await api().then((request) => request.put(`${ADMIN}/garment`).set("Authorization", bearer).send(edited));

    const res = await api().then((request) => request.post(`${ADMIN}/reset`).set("Authorization", bearer));
    assert.equal(res.status, 200);

    const { data } = (await api().then((request) => request.get(PUBLIC))).body;
    assert.equal(data.garment.rows[0].size, SEED_SIZE_GUIDES.garment.rows[0].size);
  });

  it("refuses a reset from a role without edit rights", async () => {
    const bearer = await tokenFor("support");
    const res = await api().then((request) => request.post(`${ADMIN}/reset`).set("Authorization", bearer));
    assert.equal(res.status, 403);
  });
});

describe("size guide audit", () => {
  it("records a save without copying the measurements into the log", async () => {
    const bearer = await tokenFor("content");
    const { prisma } = await import("../src/db/prisma.js");

    const guide = guideOf("garment");
    await api().then((request) => request.put(`${ADMIN}/garment`).set("Authorization", bearer).send(guide));

    // The account that just signed in — `created` holds every account this file
    // made, and "newest by createdAt" picks the wrong one when two share a millisecond.
    const me = await prisma.user.findFirst({ where: { email: created.at(-1) } });
    const entry = await prisma.auditLog.findFirst({
      where: { userId: me.id, action: "SIZE_GUIDE_UPDATE" },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(entry, "a guide write should be audited");
    assert.equal(entry.meta.type, "garment");
    assert.equal(entry.meta.rows, guide.rows.length);

    // A size guide describes bodies. The log needs to say a change happened and
    // nothing more.
    const serialised = JSON.stringify(entry);
    assert.ok(!serialised.includes(guide.note), "the audit row should not carry the guide's text");
  });

  it("records a reset", async () => {
    const bearer = await tokenFor("content");
    const { prisma } = await import("../src/db/prisma.js");

    await api().then((request) => request.post(`${ADMIN}/reset`).set("Authorization", bearer));

    // The account that just signed in — `created` holds every account this file
    // made, and "newest by createdAt" picks the wrong one when two share a millisecond.
    const me = await prisma.user.findFirst({ where: { email: created.at(-1) } });
    const entry = await prisma.auditLog.findFirst({
      where: { userId: me.id, action: "SIZE_GUIDE_RESET" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(entry, "a reset should be audited");
  });
});

describe("the shipped guides", () => {
  it("match the schemas they are validated against", () => {
    for (const type of GUIDE_TYPES) {
      const result = GUIDE_BODY_SCHEMAS[type].safeParse(SEED_SIZE_GUIDES[type]);
      assert.ok(
        result.success,
        `the shipped ${type} guide does not match its schema: ${JSON.stringify(result.error?.issues, null, 2)}`,
      );
    }
  });
});
