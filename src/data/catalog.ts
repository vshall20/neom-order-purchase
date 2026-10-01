import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { CatalogItem, UserProfile } from '../types';
import { toCatalogItem } from './converters';
import { auditBody } from './audit';

const catalogCol = () => collection(db, 'itemCatalog');

export function watchCatalog(cb: (items: CatalogItem[]) => void): () => void {
  return onSnapshot(query(catalogCol(), orderBy('nameLower')), (snap) =>
    cb(snap.docs.map((d) => toCatalogItem(d))),
  );
}

/** Case-insensitive lookup used to pre-fill a line's price from the catalog. */
export function findCatalogItem(items: readonly CatalogItem[], name: string): CatalogItem | null {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  return items.find((ci) => ci.active && ci.nameLower === n) ?? null;
}

/**
 * File any item names that are not in the catalog yet, so the next person can
 * pick them instead of retyping.
 *
 * Deliberately best-effort: it runs after the order has already committed, and
 * a failure here must never surface as "the order failed". Items created this
 * way carry no unit — units only come from the catalog, so there is nothing to
 * copy for an item that was not in it. Someone sets the unit once on the
 * catalog screen and it then shows everywhere.
 */
export async function ensureCatalogEntries(
  user: UserProfile,
  known: readonly CatalogItem[],
  items: readonly { name: string; unit?: string; price?: number }[],
): Promise<string[]> {
  const existing = new Set(known.map((ci) => ci.nameLower));
  const added: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const name = item.name.trim();
    const key = name.toLowerCase();
    if (!name || existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    try {
      await addCatalogItem(user, {
        name,
        unit: item.unit ?? '',
        defaultPrice: Number(item.price) || 0,
      });
      added.push(name);
    } catch {
      // A denied or failed catalog write is not worth failing the order over.
    }
  }
  return added;
}

export async function addCatalogItem(
  user: UserProfile,
  input: { name: string; unit: string; defaultPrice: number },
): Promise<void> {
  const name = input.name.trim();
  const ref = await addDoc(catalogCol(), {
    name,
    nameLower: name.toLowerCase(),
    unit: input.unit.trim(),
    defaultPrice: input.defaultPrice,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: { uid: user.uid, name: user.name },
  });
  await addDoc(collection(db, 'auditLog'), {
    ...auditBody(user, {
      action: 'catalog.create',
      targetType: 'catalog',
      targetId: ref.id,
      summary: `Added "${name}" to the item catalog`,
      changes: { unit: input.unit.trim(), defaultPrice: input.defaultPrice },
    }),
  });
}

/**
 * Enable or disable a catalog item.
 *
 * There is no delete: rules reject it. Disabled items drop out of the pickers
 * but stay resolvable, so historical orders that reference them still read
 * correctly.
 */
export async function setCatalogActive(
  user: UserProfile,
  item: CatalogItem,
  active: boolean,
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'itemCatalog', item.id), { active });
  batch.set(
    doc(collection(db, 'auditLog')),
    auditBody(user, {
      action: active ? 'catalog.enable' : 'catalog.disable',
      targetType: 'catalog',
      targetId: item.id,
      summary: `${active ? 'Enabled' : 'Disabled'} catalog item "${item.name}"`,
      changes: { active: { from: item.active, to: active } },
    }),
  );
  await batch.commit();
}
