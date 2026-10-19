import test from 'node:test';
import assert from 'node:assert/strict';
import { NetlifyDB } from '@netlify/database-dev';
import pg from 'pg';
import { reserveGeneration } from '../scripts/cloud-quota.mjs';

test('real local Postgres migration and atomic quota SQL enforce daily/monthly caps', { timeout: 60000 }, async () => {
  const database = new NetlifyDB({ logger: () => {} });
  let pool;
  try {
    const connectionString = await database.start();
    await database.applyMigrations('./netlify/database/migrations');
    pool = new pg.Pool({ connectionString, max: 4 });
    const limits = { daily: 3, monthly: 5 };
    const reserve = now => reserveGeneration({ pool, limits, now: new Date(now) });
    const firstDay = await Promise.all(Array.from({ length: 12 }, () => reserve('2026-10-19T00:00:00Z')));
    assert.equal(firstDay.filter(Boolean).length, 3);
    const secondDay = await Promise.all(Array.from({ length: 8 }, () => reserve('2026-10-20T00:00:00Z')));
    assert.equal(secondDay.filter(Boolean).length, 2);
    assert.equal(await reserve('2026-10-21T00:00:00Z'), false);
    assert.equal(await reserve('2026-11-01T00:00:00Z'), true);
    const { rows } = await pool.query('SELECT month, total, daily FROM ai_usage_months ORDER BY month');
    assert.deepEqual(rows[0], { month: '2026-10', total: 5, daily: { '2026-10-19': 3, '2026-10-20': 2 } });
    assert.equal(rows[1].total, 1);
    // Recreating a client must not reset usage (unlike process-local counters).
    await pool.end();
    pool = new pg.Pool({ connectionString });
    assert.equal(await reserve('2026-10-22T00:00:00Z'), false);
  } finally { await pool?.end(); await database.stop(); }
});
