// Explicit opt-in smoke test: makes ONE real generation request using the
// running server's selected DeepSeek credentials. Do not include in mock suites.
async (page) => {
  const base = page.url().split('/').slice(0, 3).join('/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base);
  await page.waitForFunction(() => !!window.__TIDELIGHT__);
  const status = await (await page.request.get(base + '/api/challenge/status')).json();
  if (status.provider !== 'deepseek' || !status.available) return { success: false, stage: 'configuration', provider: status.provider, available: status.available };
  await page.locator('#challenge-prompt').fill('新手练习，极光水面，前半段轻松，最后出现一条金色航路。');
  const responsePending = page.waitForResponse(response => response.url() === base + '/api/challenge' && response.request().method() === 'POST', { timeout: 30000 });
  const started = Date.now();
  await page.locator('#generate-challenge').click();
  const response = await responsePending;
  const result = await response.json();
  await page.waitForFunction(() => !document.getElementById('generate-challenge').disabled, null, { timeout: 30000 });
  const sourceLabel = await page.locator('#challenge-source').textContent();
  await page.screenshot({ path: '.logs/screenshots/deepseek-live-preview.png', fullPage: true });
  const report = { date: new Date().toISOString(), liveModelTested: true, requests: 1, durationMs: Date.now() - started,
    httpStatus: response.status(), source: result.source, model: result.model ?? null, reason: result.reason ?? null,
    notice: result.notice, sourceLabel, errors };
  if (result.source !== 'deepseek') return { ...report, success: false, stage: 'generation' };
  await page.locator('#start-challenge-button').click();
  const before = await page.evaluate(() => window.__TIDELIGHT__.getState());
  await page.keyboard.press('p'); await page.locator('#pause-restart-button').click();
  const after = await page.evaluate(() => window.__TIDELIGHT__.getState());
  await page.keyboard.press('p');
  await page.screenshot({ path: '.logs/screenshots/deepseek-live-game.png' });
  const playable = before.phase === 'playing' && before.seed === result.challenge.seed;
  const repeatable = after.phase === 'playing' && after.seed === before.seed;
  return { ...report, success: playable && repeatable && sourceLabel === 'DeepSeek' && errors.length === 0,
    playable, repeatable, title: result.challenge.title, theme: result.challenge.theme, seed: before.seed };
}
