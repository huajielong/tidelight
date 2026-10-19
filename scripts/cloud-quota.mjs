import { getDatabase } from '@netlify/database';

export function quotaLimits(env = {}) {
  const limit = (name, maximum) => {
    const value = env[name];
    if (value === undefined || value === '') return maximum;
    if (!/^\d+$/.test(String(value))) throw new Error('Invalid quota configuration');
    return Math.min(maximum, Number(value));
  };
  return { daily: limit('AI_DAILY_LIMIT', 100), monthly: limit('AI_MONTHLY_LIMIT', 1000) };
}

export function quotaPeriod(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const month = `${parts.year}-${parts.month}`;
  return { month, day: `${month}-${parts.day}` };
}

// One atomic UPSERT: Postgres locks the conflicting monthly row and rechecks
// BOTH caps before incrementing it. No read-modify-write race across instances.
// Reserve before contacting a provider; failures/timeouts intentionally count.
export const RESERVE_SQL = `
  INSERT INTO ai_usage_months (month, total, daily)
  VALUES ($1, 1, jsonb_build_object($2::text, 1))
  ON CONFLICT (month) DO UPDATE SET
    total = ai_usage_months.total + 1,
    daily = jsonb_set(ai_usage_months.daily, ARRAY[$2::text],
      to_jsonb(COALESCE((ai_usage_months.daily ->> $2::text)::integer, 0) + 1)),
    updated_at = now()
  WHERE ai_usage_months.total < $4
    AND COALESCE((ai_usage_months.daily ->> $2::text)::integer, 0) < $3
  RETURNING total
`;

export async function reserveGeneration({ limits, now = new Date(), pool } = {}) {
  if (!(limits?.daily > 0 && limits?.monthly > 0)) return false;
  const { month, day } = quotaPeriod(now);
  const databasePool = pool ?? getDatabase().pool;
  const result = await databasePool.query({
    text: RESERVE_SQL, values: [month, day, limits.daily, limits.monthly],
    query_timeout: 5000,
  });
  return result.rows.length === 1;
}
