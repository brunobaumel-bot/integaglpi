import type { SqlExecutor } from '../infra/db/postgres.js';

export interface AiPilotBudgetSnapshot {
  monthCost: number;
  monthlyLimit: number;
  remaining: number;
  blocked: boolean;
}

async function tableExists(executor: SqlExecutor, tableName: string): Promise<boolean> {
  const result = await executor.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${tableName}`]);
  return result.rows[0]?.exists === true;
}

export class AiPilotBudgetGuard {
  public constructor(
    private readonly executor: SqlExecutor,
    private readonly monthlyLimit: number,
    private readonly hardBlock: boolean,
  ) {}

  public async getSnapshot(estimatedCost = 0): Promise<AiPilotBudgetSnapshot> {
    let monthCost = 0;
    if (await tableExists(this.executor, 'glpi_plugin_integaglpi_ai_pilot_usage')) {
      const result = await this.executor.query<{ total: string | number | null }>(
        `
          SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) AS total
            FROM public.glpi_plugin_integaglpi_ai_pilot_usage
           WHERE created_at >= date_trunc('month', NOW())
             AND status IN ('completed', 'fallback_local')
        `,
      );
      monthCost = Number(result.rows[0]?.total ?? 0);
    }

    const remaining = Math.max(0, this.monthlyLimit - monthCost);
    return {
      monthCost,
      monthlyLimit: this.monthlyLimit,
      remaining,
      blocked: this.hardBlock && this.monthlyLimit >= 0 && monthCost + estimatedCost > this.monthlyLimit,
    };
  }
}
