import type { DB } from '@gitgate/db';
import { agentBudgetUsage, agentBudgets } from '@gitgate/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export interface BudgetCheckResult {
  budgetId: string;
  consumed: number;
  limit: number;
  pct: number;
  alertThresholdPct: number;
  enforcement: 'alert' | 'comment' | 'block-check';
  exceeded: boolean;
}

export function periodKey(period: 'daily' | 'weekly' | 'monthly', when = new Date()): string {
  const iso = when.toISOString();
  if (period === 'daily') return iso.slice(0, 10);
  if (period === 'monthly') return iso.slice(0, 7);
  // ISO week
  const d = new Date(when);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function recordUsage(
  db: DB,
  args: { orgId: string; agentProvider: string; units: number },
): Promise<BudgetCheckResult[]> {
  const budgets = await db.select().from(agentBudgets).where(eq(agentBudgets.orgId, args.orgId));
  const results: BudgetCheckResult[] = [];
  for (const b of budgets) {
    if (b.scopeType === 'agent' && b.scopeId !== args.agentProvider) continue;
    const key = periodKey(b.period);
    const existing = (
      await db
        .select()
        .from(agentBudgetUsage)
        .where(and(eq(agentBudgetUsage.budgetId, b.id), eq(agentBudgetUsage.periodKey, key)))
        .limit(1)
    )[0];
    if (!existing) {
      await db.insert(agentBudgetUsage).values({ budgetId: b.id, periodKey: key, unitsConsumed: args.units });
    } else {
      await db
        .update(agentBudgetUsage)
        .set({ unitsConsumed: sql`${agentBudgetUsage.unitsConsumed} + ${args.units}` })
        .where(and(eq(agentBudgetUsage.budgetId, b.id), eq(agentBudgetUsage.periodKey, key)));
    }
    const consumed = (existing?.unitsConsumed ?? 0) + args.units;
    const pct = Math.round((consumed / b.limitUnits) * 100);
    results.push({
      budgetId: b.id,
      consumed,
      limit: b.limitUnits,
      pct,
      alertThresholdPct: b.alertThresholdPct,
      enforcement: b.enforcement,
      exceeded: consumed > b.limitUnits,
    });
  }
  return results;
}
