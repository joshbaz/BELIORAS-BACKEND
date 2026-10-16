/* Counters And Locks */

import { prisma } from "../../db/prisma.js";

/**
 * Two uses of one tiny collection.
 *
 * `nextValue` hands out sequence numbers — order references, invoice and
 * credit-note numbers, transaction ids — with one atomic increment, so two
 * requests can never be given the same number. Run inside a transaction, an
 * aborted attempt gives its number back, which is what keeps invoice numbers
 * gap-free as German invoicing requires.
 *
 * `lock` makes concurrent transactions that touch the same thing take turns.
 * MongoDB only notices a clash between two transactions when both *write* the
 * same document; two checkouts that merely read the same stock would both
 * succeed and sell the last piece twice. Each checkout therefore writes the
 * lock document of every product it sells, so the second one conflicts,
 * retries, and sees the first one's order.
 */

/** The next number in `id`'s sequence. `initial()` seeds a sequence that does not exist yet (the highest already in use). */
export async function nextValue(db, id, initial = async () => 0) {
  const existing = await db.counter.findUnique({ where: { id } });
  if (!existing) {
    const start = (await initial()) + 1;
    await db.counter.create({ data: { id, value: start } });
    return start;
  }
  const updated = await db.counter.update({ where: { id }, data: { value: { increment: 1 } } });
  return updated.value;
}

/** Writes `id`'s lock document, so another transaction writing it conflicts and retries. */
export async function lock(db, id) {
  await db.counter.upsert({ where: { id: `lock:${id}` }, create: { id: `lock:${id}`, value: 1 }, update: { value: { increment: 1 } } });
}

/**
 * Runs `work(tx)` in a transaction, retrying when it lost a race (a write
 * conflict, or a unique clash on a number another transaction just took), with
 * a short growing pause so the losers do not collide again in lockstep.
 */
export async function inTransaction(work, { attempts = 8 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { maxWait: 10000, timeout: 20000 });
    } catch (err) {
      const retryable = err?.code === "P2034" || err?.code === "P2002" || /WriteConflict|write conflict/i.test(String(err?.message));
      if (!retryable || attempt >= attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * 2 ** attempt));
    }
  }
}
