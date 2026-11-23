/**
 * Indexes over a snapshot's documents, built once per snapshot and shared by
 * the rules: by id, by class, and who references whom. Which fields are
 * references comes from the schema as data (`CLASS_FIELDS` in
 * `@armature/types`), so a field added by a later schema is followed without a
 * change here.
 */
import { CLASS_ANCESTORS, CLASS_CATEGORY, CLASS_FIELDS, type ClassName } from '@armature/types';
import type { Doc, Snapshot } from './types.js';

export interface Reference {
  /** The referencing document. */
  from: string;
  /** Its field. */
  field: string;
}

export interface GraphIndex {
  byId: Map<string, Doc>;
  byType: Map<string, Doc[]>;
  /** For each id, the documents whose reference fields name it. */
  referrers: Map<string, Reference[]>;
}

const cache = new WeakMap<Snapshot, GraphIndex>();

/** The snapshot's index, built on first use. */
export function indexOf(snapshot: Snapshot): GraphIndex {
  let index = cache.get(snapshot);
  if (!index) {
    index = build(snapshot.documents);
    cache.set(snapshot, index);
  }
  return index;
}

function build(documents: Doc[]): GraphIndex {
  const byId = new Map<string, Doc>();
  const byType = new Map<string, Doc[]>();
  const referrers = new Map<string, Reference[]>();
  for (const doc of documents) {
    byId.set(doc['@id'], doc);
    const list = byType.get(doc['@type']);
    if (list) list.push(doc);
    else byType.set(doc['@type'], [doc]);
  }
  for (const doc of documents) {
    for (const [field, target] of referencesOf(doc)) {
      const list = referrers.get(target);
      const ref = { from: doc['@id'], field };
      if (list) list.push(ref);
      else referrers.set(target, [ref]);
    }
  }
  return { byId, byType, referrers };
}

/** Every `[field, target id]` a document's reference fields hold. */
export function* referencesOf(doc: Doc): Generator<[string, string]> {
  const fields = CLASS_FIELDS[doc['@type'] as ClassName];
  if (!fields) return;
  for (const [field, shape] of Object.entries(fields)) {
    if (shape.kind !== 'reference') continue;
    for (const value of asArray(doc[field])) {
      if (typeof value === 'string') yield [field, value];
    }
  }
}

/** A Set or List field as an array; an absent Set reads as empty (CLAUDE.md, constraint 1's note). */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The ids a reference field holds. */
export const idsIn = (value: unknown): string[] => asArray(value).filter((v): v is string => typeof v === 'string');

/** Whether a class is, or descends from, another. */
export function isA(type: string, ancestor: ClassName): boolean {
  if (type === ancestor) return true;
  const ancestors = CLASS_ANCESTORS[type as ClassName] as readonly string[] | undefined;
  return ancestors?.includes(ancestor) ?? false;
}

export const categoryOf = (type: string): string | undefined => CLASS_CATEGORY[type as ClassName];

/** A record's label for a message, or its id when it has none. */
export function labelOf(snapshot: Snapshot, id: string): string {
  const doc = indexOf(snapshot).byId.get(id);
  const label = doc?.label;
  return typeof label === 'string' && label ? `"${label}"` : id;
}
