async (page) => {
  const base = page.url().split('/').slice(0, 3).join('/');
  const results = [], errors = [];
  const check = (condition, name) => { if (!condition) throw new Error(`FAIL: ${name}`); results.push({ name, result: 'pass' }); };
  const ready = () => page.waitForFunction(() => !!window.__TIDELIGHT__);
  const text = id => page.locator('#' + id).textContent();
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base); await ready();
  const challenge = await page.evaluate(async () => ({ ...(await import('/src/challenge.js')).DEFAULT_CHALLENGE, title: '模型适配测试', theme: 'aurora', seed: 20261019 }));
  // All model replies below are explicitly mocked: no key or external request.
  for (const [provider, label] of [['deepseek', 'DeepSeek'], ['seed', 'Seed']]) {
    await page.route('**/api/challenge/status', route => route.fulfill({ json: { provider, available: true, notice: `${label} 已配置；模拟状态。` } }));
    await page.route('**/api/challenge', route => route.fulfill({ json: { source: provider, challenge, notice: `${label} 模拟成功，非真实模型调用。` } }));
    await page.goto(base); await ready();
    await page.waitForFunction(label => document.getElementById('ai-status').textContent === `${label} · 已配置`, label);
    check(await text('ai-status') === `${label} · 已配置`, `${label} selected provider status`);
    await page.locator('#challenge-prompt').fill('极光金色航路'); await page.locator('#generate-challenge').click();
    await page.waitForFunction(label => document.getElementById('challenge-source').textContent === label, label);
    check(await text('challenge-title') === '模型适配测试', `${label} response accepted without accidental local fallback`);
    check((await text('challenge-notice')).includes('模拟成功'), `${label} success notice shown`);
    await page.locator('#start-challenge-button').click();
    check(await page.evaluate(() => window.__TIDELIGHT__.getState().seed === 20261019), `${label} generated seed reaches game`);
    await page.keyboard.press('p'); await page.locator('#pause-restart-button').click();
    check(await page.evaluate(() => window.__TIDELIGHT__.getState().seed === 20261019), `${label} restart retains seed`);
    await page.unroute('**/api/challenge/status'); await page.unroute('**/api/challenge');
  }
  await page.route('**/api/challenge/status', route => route.fulfill({ json: { provider: 'seed', available: false, notice: 'Seed 尚未配置 ARK_MODEL；当前使用本地关键词生成。' } }));
  await page.goto(base); await ready();
  await page.waitForFunction(() => document.getElementById('challenge-notice').textContent.includes('ARK_MODEL'));
  check(await text('ai-status') === 'Seed · 未配置', 'Missing Seed model status is actionable');
  check((await text('challenge-notice')).includes('ARK_MODEL'), 'Missing Seed model guidance visible');
  await page.route('**/api/challenge', route => route.fulfill({ json: { source: 'seed', challenge: { ...challenge, seed: 0 } } }));
  await page.locator('#challenge-prompt').fill('新手极光'); await page.locator('#generate-challenge').click();
  await page.waitForFunction(() => document.getElementById('challenge-source').textContent === '本地关键词');
  check(await text('challenge-source') === '本地关键词', 'Invalid provider result rejected by client');
  check(!await page.locator('#start-challenge-button').isDisabled(), 'Invalid result leaves playable local challenge');
  await page.unroute('**/api/challenge'); await page.unroute('**/api/challenge/status');
  let releaseStatus; const gate = new Promise(resolve => { releaseStatus = resolve; });
  await page.route('**/api/challenge/status', async route => { await gate; await route.fulfill({ json: { provider: 'deepseek', available: true, notice: 'Delayed initial status' } }); });
  await page.goto(base); await ready();
  await page.locator('#challenge-prompt').fill(''); await page.locator('#generate-challenge').click();
  releaseStatus(); await page.waitForFunction(() => document.getElementById('ai-status').textContent.includes('已配置'));
  check((await text('challenge-notice')).includes('1–200'), 'Late status cannot overwrite user feedback');
  await page.unroute('**/api/challenge/status');
  await page.route('**/api/challenge/status', route => route.fulfill({ json: { provider: 'deepseek', available: false, notice: 'DeepSeek 尚未配置 DEEPSEEK_API_KEY；当前使用本地关键词生成。' } }));
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.goto(base); await ready();
    await page.waitForFunction(() => document.getElementById('ai-status').textContent.includes('DeepSeek'));
    const fits = await page.evaluate(() => { const el = document.querySelector('.challenge-panel'), r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; });
    check(fits, `Provider status/notice fits ${size.width}px portrait`);
    await page.locator('#challenge-notice').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.logs/screenshots/providers-${size.width}.png` });
  }
  await page.unroute('**/api/challenge/status');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(base); await ready();
  const statusResponse = await page.request.get(base + '/api/challenge/status');
  const status = await statusResponse.json();
  check(statusResponse.ok() && ['deepseek', 'seed', 'openai', 'local', null].includes(status.provider), 'Real local status endpoint returns provider metadata');
  check(!Object.hasOwn(status, 'apiKey'), 'Real status never exposes credentials');
  for (const path of ['/.env.local', '/.env.example', '/scripts/ai-provider.mjs']) check((await page.request.get(base + path)).status() === 404, `Private file not served: ${path}`);
  check(errors.length === 0, 'No unhandled page exceptions');
  return { date: '2026-10-19', assertions: results.length, results, errors, liveModelTested: false, status };
}
