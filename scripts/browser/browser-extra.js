async (page) => {
  const base = page.url().split('/').slice(0, 3).join('/');
  const results = [];
  const check = (condition, name, detail = '') => { if (!condition) throw new Error(`${name}: ${detail}`); results.push({ name, result: 'pass', detail }); };
  await page.addInitScript(() => {
    window.__readyCount = 0;
    window.addEventListener('tidelight:ready', () => window.__readyCount++);
  });
  await page.goto(base + '/?test=1');
  await page.waitForFunction(() => !!window.__TIDELIGHT__);
  check(await page.evaluate(() => window.__readyCount === 1), 'Ready event fires once');
  await page.evaluate(() => window.__TIDELIGHT__.loadScenario('empty'));
  await page.locator('#mute-button').focus();
  const wasMuted = await page.evaluate(() => window.__TIDELIGHT__.getState().muted);
  await page.keyboard.press('Space');
  const nativeSpace = await page.evaluate(() => window.__TIDELIGHT__.getState());
  check(nativeSpace.muted !== wasMuted && nativeSpace.player.dashCooldown === 0, 'Space on focused mute activates button without dashing');
  await page.evaluate(() => {
    window.__TIDELIGHT__.restart();
    window.__TIDELIGHT__.restart();
    window.__TIDELIGHT__.restart();
  });
  await page.keyboard.press('p');
  check(await page.evaluate(() => window.__TIDELIGHT__.getState().phase === 'paused'), 'Repeated restarts do not duplicate keyboard listeners');
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.__TIDELIGHT__);
  await page.locator('#start-button').scrollIntoViewIfNeeded();
  check(await page.locator('#start-button').isVisible(), 'Title Start remains usable at 200%-equivalent viewport');
  await page.locator('#start-button').click();
  await page.keyboard.press('p');
  await page.locator('#resume-button').scrollIntoViewIfNeeded();
  check(await page.locator('#resume-button').isVisible(), 'Paused menu remains usable at 200%-equivalent viewport');

  const fallbackContext = await page.context().browser().newContext();
  await fallbackContext.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
  });
  const fallback = await fallbackContext.newPage();
  const fallbackErrors = [];
  fallback.on('pageerror', error => fallbackErrors.push(error.message));
  await fallback.route('**/*.png', route => route.abort());
  await fallback.goto(base + '/?test=1');
  await fallback.waitForFunction(() => !!window.__TIDELIGHT__ && Object.values(window.__TIDELIGHT__.getMetrics().assets).every(value => value === 'failed'));
  await fallback.locator('#start-button').click();
  await fallback.evaluate(() => window.__TIDELIGHT__.loadScenario('survival'));
  await fallback.evaluate(() => window.__TIDELIGHT__.step(75000));
  check(await fallback.evaluate(() => window.__TIDELIGHT__.getState().phase === 'gameover') && fallbackErrors.length === 0, 'Blocked storage, unavailable audio, and missing art keep full round playable');
  check(await fallback.locator('#asset-error').isVisible(), 'Missing-art warning is visible');
  await fallback.screenshot({ path: '.logs/screenshots/fallback-result.png' });
  await fallbackContext.close();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/?test=1');
  await page.waitForFunction(() => !!window.__TIDELIGHT__);
  await page.locator('#start-button').click();
  const live = await page.evaluate(async () => {
    const api = window.__TIDELIGHT__;
    api.setAutoRun(true);
    const samples = [];
    const began = performance.now();
    return await new Promise(resolve => {
      const timer = setInterval(() => {
        const s = api.getState();
        const angle = (performance.now() - began) / 1600;
        api.setInput(Math.cos(angle), Math.sin(angle));
        samples.push(api.getMetrics());
        if (s.phase === 'gameover' || performance.now() - began >= 12000) {
          clearInterval(timer); api.setAutoRun(false);
          resolve({ seconds: (performance.now() - began) / 1000, state: api.getState(), samples });
        }
      }, 100);
    });
  });
  check(live.samples.every(m => m.entities.sparks <= 16 && m.entities.hazards <= 7 && m.entities.particles <= 160 && m.entities.wake <= 30), 'Live gameplay entity/effect counts remain bounded', `observed ${live.seconds.toFixed(1)}s`);
  const fps = live.samples.slice(10).map(m => m.fps).sort((a, b) => a - b);
  check(fps.length > 0, 'Live browser frame metrics collected', `median ${fps[Math.floor(fps.length / 2)]} FPS; min ${fps[0]} FPS; Edge desktop only`);
  await page.goto(base + '/');
  await page.waitForFunction(() => !!window.__TIDELIGHT__);
  return { date: new Date().toISOString(), assertions: results.length, results, liveSummary: { seconds: live.seconds, endPhase: live.state.phase, fpsMedian: fps[Math.floor(fps.length / 2)], fpsMin: fps[0] } };
}
