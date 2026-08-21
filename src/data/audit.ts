import { collection, doc, serverTimestamp, Transaction } from 'firebase/firestore';
import type { Firestore, WriteBatch } from 'firebase/firestore';
import type { AuditAction, AuditTargetType, UserProfile } from '../types';

export interface AuditDraft {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  poNumber?: string | null;
  summary: string;
  changes?: Record<string, unknown>;
}

/**
 * Build the document body for an audit entry.
 *
 * `at` uses serverTimestamp() because the rules require `at == request.time` —
 * a client-supplied time would be rejected, which is what stops a user from
 * back-dating their own log entries.
 */
export function auditBody(actor: UserProfile, draft: AuditDraft) {
  return {
    at: serverTimestamp(),
    actor: { uid: actor.uid, name: actor.name, role: actor.role },
    action: draft.action,
    targetType: draft.targetType,
    targetId: draft.targetId,
    poNumber: draft.poNumber ?? null,
    summary: draft.summary,
    changes: draft.changes ?? {},
  };
}

/**
 * Queue an audit entry inside an existing transaction or batch, so the log
 * commits atomically with the change it describes and can never drift from it.
 */
export function writeAudit(
  db: Firestore,
  writer: Transaction | WriteBatch,
  actor: UserProfile,
  draft: AuditDraft,
): void {
  const ref = doc(collection(db, 'auditLog'));
  const body = auditBody(actor, draft);
  // Transaction.set and WriteBatch.set have incompatible generic signatures,
  // so the union has to be narrowed before either can be called.
  if (writer instanceof Transaction) writer.set(ref, body);
  else writer.set(ref, body);
}
