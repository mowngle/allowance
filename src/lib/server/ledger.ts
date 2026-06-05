// Ledger queries + write helpers.

import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from './db';

export type LedgerView = {
  id: string;
  kind: 'payout' | 'debit' | 'adjustment';
  amountCents: number;
  description: string;
  createdAt: number;
  visibleToKid: boolean;
};

export async function getKidLedger(
  kidId: string,
  opts: { onlyVisibleToKid?: boolean; limit?: number } = {}
): Promise<LedgerView[]> {
  const whereParts = [eq(schema.ledgerEntries.kidId, kidId)];
  if (opts.onlyVisibleToKid) {
    whereParts.push(eq(schema.ledgerEntries.visibleToKid, true));
  }

  const rows = await db
    .select({
      id: schema.ledgerEntries.id,
      kind: schema.ledgerEntries.kind,
      amountCents: schema.ledgerEntries.amountCents,
      description: schema.ledgerEntries.description,
      createdAt: schema.ledgerEntries.createdAt,
      visibleToKid: schema.ledgerEntries.visibleToKid,
    })
    .from(schema.ledgerEntries)
    .where(and(...whereParts))
    .orderBy(desc(schema.ledgerEntries.createdAt))
    .limit(opts.limit ?? 100);

  return rows as LedgerView[];
}

export type RecordDebitInput = {
  parentPersonId: string;
  kidId: string;
  amountCents: number; // positive number — this function negates
  description: string;
  visibleToKid?: boolean;
};

export async function recordDebit(input: RecordDebitInput): Promise<void> {
  if (input.amountCents <= 0) throw new Error('Amount must be positive');
  if (!input.description.trim()) throw new Error('Description is required');

  await assertParentOfKid(input.parentPersonId, input.kidId);

  db.insert(schema.ledgerEntries)
    .values({
      id: crypto.randomUUID(),
      kidId: input.kidId,
      kind: 'debit',
      amountCents: -input.amountCents,
      description: input.description.trim(),
      visibleToKid: input.visibleToKid ?? true,
      createdAt: Date.now(),
      createdBy: input.parentPersonId,
    })
    .run();
}

export type RecordAdjustmentInput = {
  parentPersonId: string;
  kidId: string;
  amountCents: number; // signed; positive credit, negative debit
  description: string;
  visibleToKid?: boolean;
};

export async function recordAdjustment(input: RecordAdjustmentInput): Promise<void> {
  if (input.amountCents === 0) throw new Error('Amount cannot be zero');
  if (!input.description.trim()) throw new Error('Description is required');

  await assertParentOfKid(input.parentPersonId, input.kidId);

  db.insert(schema.ledgerEntries)
    .values({
      id: crypto.randomUUID(),
      kidId: input.kidId,
      kind: 'adjustment',
      amountCents: input.amountCents,
      description: input.description.trim(),
      visibleToKid: input.visibleToKid ?? true,
      createdAt: Date.now(),
      createdBy: input.parentPersonId,
    })
    .run();
}

async function assertParentOfKid(parentPersonId: string, kidId: string): Promise<void> {
  const rows = await db
    .select({
      pFam: schema.persons.familyId,
      pRole: schema.persons.role,
    })
    .from(schema.persons)
    .where(eq(schema.persons.id, parentPersonId))
    .limit(1);
  if (!rows[0] || rows[0].pRole !== 'parent') throw new Error('Not a parent');
  const parentFam = rows[0].pFam;

  const kidRows = await db
    .select({ kFam: schema.persons.familyId, kRole: schema.persons.role })
    .from(schema.persons)
    .where(eq(schema.persons.id, kidId))
    .limit(1);
  if (!kidRows[0]) throw new Error('Kid not found');
  if (kidRows[0].kRole !== 'kid') throw new Error('Target is not a kid');
  if (kidRows[0].kFam !== parentFam) throw new Error('Different family');
}
