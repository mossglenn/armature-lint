/**
 * A snapshot from a hub: the only module that talks to one. The export is read
 * first, at the branch or commit asked for, and every later read is pinned to
 * the commit the export was served from, so a commit landing mid-run cannot mix
 * two states of the graph into one verdict.
 *
 * Reads: `GET /export?profile=full` (every document, and the users its records
 * name), `GET /intelligence/coverage` (every module), `GET
 * /intelligence/alignment`, `GET /intelligence/module-content/:id` per module,
 * and `GET /intelligence/attestations/:type/:id` for each record an agent
 * created. With a base, the coverage read again at the base.
 */
import type { ArmatureClient, AtRef } from '@armature/client';
import type { ClassName } from '@armature/types';
import { isA } from './graph.js';
import type { Doc, Snapshot } from './types.js';

export interface LoadOptions {
  /** The branch to lint; `main` when neither this nor `ref` is given. */
  branch?: string;
  /** A commit to lint instead of a branch's head. */
  ref?: string;
  /** The merge target, for `coverage.regressed`: a branch or a commit. */
  base?: AtRef;
  /** How many reads at once (8 by default). */
  concurrency?: number;
}

export async function loadSnapshot(client: ArmatureClient, options: LoadOptions = {}): Promise<Snapshot> {
  const at: AtRef = options.ref ? { ref: options.ref } : { branch: options.branch ?? 'main' };
  const exported = await client.export.read({ ...at, profile: 'full' });
  const commit = exported.commit ?? String(exported.data.armature.ref);
  const pin = { ref: commit };
  const documents = exported.data.documents as unknown as Doc[];

  const users = new Map(documents.filter((d) => d['@type'] === 'User').map((d) => [d['@id'], d]));
  const byAgent = documents.filter((d) => {
    if (!isA(d['@type'], 'ArmatureDocument') || typeof d.createdBy !== 'string') return false;
    const externalId = users.get(d.createdBy)?.externalId;
    return typeof externalId === 'string' && externalId.startsWith('agent:');
  });
  const modules = documents.filter((d) => d['@type'] === 'Module').map((d) => d['@id']);
  const limit = options.concurrency ?? 8;

  const [coverage, alignment, content, attestations, base] = await Promise.all([
    client.intelligence.courseCoverage(pin).then((r) => r.data),
    client.intelligence.alignment(pin).then((r) => r.data),
    mapLimit(modules, limit, async (id) => [id, (await client.intelligence.moduleContent(id, pin)).data] as const),
    mapLimit(byAgent, limit, async (d) => [d['@id'], (await client.intelligence.attestations(d['@type'] as ClassName, d['@id'], pin)).data] as const),
    options.base ? loadBase(client, options.base) : undefined,
  ]);

  return {
    commit,
    ...(options.ref ? {} : { branch: at.branch }),
    documents,
    coverage,
    alignment,
    content: Object.fromEntries(content),
    attestations: Object.fromEntries(attestations),
    ...(base ? { base } : {}),
  };
}

/**
 * The merge target's part of a snapshot, for `coverage.regressed`: the
 * coverage read at a branch or a commit. Read alone when one snapshot is
 * linted against several targets (`report.ts`), so the export is read once.
 */
export async function loadBase(client: ArmatureClient, base: AtRef): Promise<NonNullable<Snapshot['base']>> {
  const r = await client.intelligence.courseCoverage(base);
  return { ref: base.ref ?? base.branch ?? 'main', ...(r.commit ? { commit: r.commit } : {}), coverage: r.data };
}

/** `items` through `fn`, at most `limit` at once, results in order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
