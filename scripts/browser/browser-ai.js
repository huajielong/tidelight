async (page) => {
  const base = page.url().split('/').slice(0, 3).join('/');
  const results = [], errors = [];
  const check = (condition, name, detail = '') => { if (!condition) throw new Error(`FAIL ${name}: ${detail}`); results.push({ name, result: 'pass', detail }); };
  const ready = p => p.waitForFunction(() => !!window.__TIDELIGHT__ && Object.values(window.__TIDELIGHT__.getMetrics().assets).every(s => s === 'ready'));
  const state = () => page.evaluate(() => window.__TIDELIGHT__.getState());
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base); await ready(page);
  check(await page.locator('#challenge-title').textContent() === '月下初航', 'Initial preview shows default playable challenge');
  check(await page.locator('#challenge-events li').count() === 4, 'Preview displays four timed events');
  await page.locator('#challenge-library summary').focus(); await page.keyboard.press('Enter');
  check((await state()).phase === 'title' && await page.locator('#challenge-library').getAttribute('open') !== null, 'Enter opens library without accidentally starting game');
  await page.keyboard.press('Enter');
  await page.screenshot({ path: '.logs/screenshots/ai-title-desktop.png' });
  await page.locator('#challenge-prompt').fill(' '); await page.locator('#generate-challenge').click();
  check((await page.locator('#challenge-notice').textContent()).includes('1–200'), 'Empty prompt rejected accessibly');

  // Force local response without incurring a model call, even if a key is installed later.
  await page.route('**/api/challenge', async route => {
    const c = await page.evaluate(async () => (await import('/src/challenge.js')).localChallenge('新手极光环形金色，不要伏潮者'));
    await route.fulfill({ json: { source: 'local', challenge: c, notice: '浏览器测试：本地关键词生成。' } });
  });
  await page.locator('[data-prompt]').first().click();
  check((await page.locator('#challenge-prompt').inputValue()).includes('新手'), 'Preset fills editable prompt');
  await page.locator('#generate-challenge').click();
  await page.waitForFunction(() => document.getElementById('challenge-source').textContent === '本地关键词');
  check((await page.locator('#challenge-meta').textContent()).includes('轻柔 · 极光'), 'Local generation is explicitly labeled and settings previewed');
  check(!(await page.locator('#challenge-enemies').textContent()).includes('伏潮者'), 'Enemy exclusion visible in preview');
  const seed = Number(await page.locator('#challenge-seed').textContent());
  await page.locator('#challenge-library summary').click(); await page.locator('#save-challenge').click();
  check((await page.locator('#challenge-notice').textContent()).includes('已收藏'), 'Challenge saved locally');
  await page.locator('#export-challenge').click(); const code = await page.locator('#challenge-code').inputValue();
  check(code.startsWith('TL1.'), 'Export produces portable challenge code');
  await page.locator('#reroll-seed').click(); check(Number(await page.locator('#challenge-seed').textContent()) !== seed, 'Reroll changes seed');
  await page.locator('#challenge-code').fill('TL1.corrupt'); await page.locator('#import-challenge').click();
  check((await page.locator('#challenge-notice').textContent()).includes('损坏'), 'Corrupt code rejected without replacing challenge');
  await page.locator('#challenge-code').fill(code); await page.locator('#import-challenge').click();
  check(Number(await page.locator('#challenge-seed').textContent()) === seed, 'Import restores exact seed');
  await page.locator('#start-challenge-button').click();
  let s = await state(); check(s.seed === seed && s.challenge.theme === 'aurora' && s.phase === 'playing', 'Preview launches selected seeded configuration');
  check(s.hazards.every(h => h.kind !== 'ambusher'), 'Excluded enemy absent from actual initial run');
  await page.keyboard.press('p'); await page.locator('#pause-restart-button').click();
  check((await state()).seed === seed, 'Restart retains seed instead of randomizing');
  await page.keyboard.press('p'); await page.locator('#pause-title-button').click();
  check((await state()).phase === 'title', 'Pause can return to challenge workshop');
  await page.reload(); await ready(page); await page.locator('#challenge-library summary').click(); await page.locator('#load-challenge').click();
  check(Number(await page.locator('#challenge-seed').textContent()) === seed, 'Saved challenge survives reload');

  const generated = await page.evaluate(async () => ({ ...(await import('/src/challenge.js')).DEFAULT_CHALLENGE, title: '模型测试潮汐', theme: 'ember', seed: 12345 }));
  await page.unroute('**/api/challenge');
  let releaseResponse; const gate = new Promise(resolve => { releaseResponse = resolve; });
  await page.route('**/api/challenge', async route => { await gate; await route.fulfill({ json: { source: 'openai', challenge: generated, notice: '模拟响应：非真实模型调用。' } }); });
  await page.locator('#generate-challenge').click();
  check(await page.locator('#start-button').isDisabled() && await page.locator('#generate-challenge').isDisabled(), 'Pending generation prevents double-submit and stale run start');
  releaseResponse(); await page.waitForFunction(() => document.getElementById('challenge-source').textContent === 'OpenAI');
  check(await page.locator('#challenge-title').textContent() === '模型测试潮汐', 'Structured OpenAI response renders preview (mock, not live API)');
  await page.unroute('**/api/challenge'); await page.route('**/api/challenge', route => route.fulfill({ status: 429, json: { error: 'rate limited' } }));
  await page.locator('#generate-challenge').click(); await page.waitForFunction(() => document.getElementById('challenge-notice').textContent.includes('频繁'));
  check(await page.locator('#challenge-title').textContent() === '模型测试潮汐' && !await page.locator('#start-button').isDisabled(), 'Rate limit preserves playable selected challenge');
  await page.unroute('**/api/challenge'); await page.route('**/api/challenge', route => route.abort());
  await page.locator('#challenge-prompt').fill('极光金色'); await page.locator('#generate-challenge').click();
  await page.waitForFunction(() => document.getElementById('challenge-source').textContent === '本地关键词');
  check((await page.locator('#challenge-notice').textContent()).includes('不是大模型'), 'Offline failure honestly switches to local keyword mode');
  await page.unroute('**/api/challenge');

  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await page.goto(base); await ready(page);
    await page.locator('#generate-challenge').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => { const el = document.querySelector('.challenge-panel'), r = el.getBoundingClientRect(); return { right: r.right, left: r.left, width: innerWidth, scroll: el.scrollWidth, client: el.clientWidth }; });
    check(layout.left >= 0 && layout.right <= layout.width + 1 && layout.scroll <= layout.client + 1, `Workshop fits ${size.width}x${size.height}`, JSON.stringify(layout));
    if (size.width === 390) await page.screenshot({ path: '.logs/screenshots/ai-challenge-mobile.png' });
    await page.locator('#start-challenge-button').click(); check((await state()).phase === 'playing', `Challenge start works at ${size.width}x${size.height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(base + '/?test=1'); await ready(page);
  await page.locator('#start-button').click();
  s = await state(); check(new Set(s.hazards.map(h => h.kind)).size === 3, 'Default run includes three enemy personalities');
  await page.evaluate(() => window.__TIDELIGHT__.step(3400));
  s = await state(); check(s.hazards.some(h => h.kind === 'ambusher' && h.mode === 'warning'), 'Ambusher warning visible in actual rendered scene');
  await page.screenshot({ path: '.logs/screenshots/ai-ambush-warning.png' });
  const originalAim = s.hazards.find(h => h.kind === 'ambusher').aim;
  await page.evaluate(() => { const a = window.__TIDELIGHT__; a.setInput(0, 1); a.step(1000); a.clearInput(); });
  check(JSON.stringify((await state()).hazards.find(h => h.kind === 'ambusher').aim) === JSON.stringify(originalAim), 'Player movement does not change telegraphed aim');
  await page.evaluate(() => { const a = window.__TIDELIGHT__; a.restart(); a.step(12000); });
  s = await state(); check(!!s.director.pending && (await page.locator('#tide-label').textContent()).includes('即将'), 'Director warning reaches HUD and water-route render');
  await page.screenshot({ path: '.logs/screenshots/ai-director-warning.png' });
  await page.keyboard.press('p'); const before = await state(); await page.evaluate(() => window.__TIDELIGHT__.step(20000));
  check(JSON.stringify((await state()).director) === JSON.stringify(before.director), 'Pause freezes director and warning timers');
  await page.locator('#resume-button').click(); await page.evaluate(() => window.__TIDELIGHT__.step(1900));
  check((await state()).director.history.length >= 1, 'Director activates after warning');
  await page.screenshot({ path: '.logs/screenshots/ai-director-active.png' });
  await page.evaluate(() => { const a = window.__TIDELIGHT__; a.loadScenario('survival'); a.step(75000); });
  check((await page.locator('#result-challenge').textContent()).includes('种子'), 'Result identifies challenge and seed');
  await page.locator('#result-title-button').click(); check((await state()).phase === 'title', 'Result returns to workshop');
  const api = await page.request.get(base + '/api/challenge/status'); check(api.ok(), 'Real localhost API status reachable');
  // No live model request: live-key verification is separately reported.
  if (!(await api.json()).available) {
    const local = await page.request.post(base + '/api/challenge', { data: { prompt: '新手练习' } });
    check(local.ok() && (await local.json()).source === 'local', 'Actual HTTP local fallback returns valid challenge');
  }
  for (const path of ['/.env', '/.git/config', '/scripts/challenge-api.mjs', '/.logs/development.md']) {
    check((await page.request.get(base + path)).status() === 404, `Server does not publish ${path}`);
  }
  check(errors.length === 0, 'No unhandled page exceptions', JSON.stringify(errors));
  await page.goto(base); await ready(page);
  return { date: '2026-10-19', assertions: results.length, results, errors, liveModelTested: false };
}
