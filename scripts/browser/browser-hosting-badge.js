// No model calls. Exercise the public hosting overlay without dismissing it.
// Locally, a 197x64 iframe fixture reproduces the observed collapsed badge.
async (page) => {
  const base = page.url().split('/').slice(0, 3).join('/');
  const results = [];
  const check = (ok, name) => {
    if (!ok) throw new Error(name);
    results.push({ name, result: 'pass' });
  };
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(base + '/?test=1');
    await page.waitForFunction(() => !!window.__TIDELIGHT__);
    await page.evaluate(() => {
      if (document.getElementById('nl-badge-frame')) return;
      const badge = document.createElement('iframe');
      badge.id = 'nl-badge-frame';
      badge.title = 'Hosting badge test fixture';
      badge.srcdoc = '<p>Hosting badge fixture</p>';
      badge.style.cssText = 'position:fixed;right:0;bottom:0;width:197px;height:64px;border:0;z-index:2147483645';
      document.body.append(badge);
    });
    await page.locator('#start-button').click();
    await page.evaluate(() => window.__TIDELIGHT__.loadScenario('empty'));
    const layout = await page.evaluate(() => {
      const app = document.getElementById('app').getBoundingClientRect();
      const badge = document.getElementById('nl-badge-frame').getBoundingClientRect();
      const dash = document.getElementById('dash-button');
      const r = dash.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        separated: app.bottom <= badge.top,
        clickable: hit === dash || dash.contains(hit),
        inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    check(layout.separated && layout.clickable && layout.inViewport && !layout.overflow,
      `Badge does not cover game or dash at ${size.width}x${size.height}`);
    await page.locator('#dash-button').click();
    await page.evaluate(() => window.__TIDELIGHT__.step(50));
    check(await page.evaluate(() => window.__TIDELIGHT__.getState().player.dashCooldown > 0),
      `Real button click dashes at ${size.width}x${size.height}`);
    await page.screenshot({ path: `.logs/screenshots/hosting-badge-${size.width}x${size.height}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/');
  return { date: new Date().toISOString(), assertions: results.length, results };
}
