const { test, expect } = require('@playwright/test');

const consoleErrors = [];

function track(page) {
  page.on('pageerror', (err) => consoleErrors.push(String(err && err.message ? err.message : err)));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon\.ico/i.test(text)) return;
    consoleErrors.push(text);
  });
}

async function openMap(page) {
  track(page);
  await page.goto('/');
  await page.waitForSelector('.node[data-id="nebula"]');
  await page.waitForSelector('.node[data-id="its"]');
}

function boxesOverlap(a, b) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 1 && height > 1;
}

test.describe.configure({ mode: 'serial' });

test.afterEach(() => {
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('page loads and the tree renders', async ({ page }) => {
  await openMap(page);
  for (const id of ['nebula', 'its', 'promo', 'tan', 'cott']) {
    await expect(page.locator(`.node[data-id="${id}"]`)).toHaveCount(1);
  }
  expect(await page.locator('.node').count()).toBeGreaterThanOrEqual(5);
});

test('node boxes do not overlap', async ({ page }) => {
  await openMap(page);
  await page.locator('#expand').click();
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 45);
  await page.waitForTimeout(400);
  const boxes = await page.locator('.node-box').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.closest('.node').dataset.id,
      label: el.closest('.node').getAttribute('aria-label'),
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  }));
  expect(boxes).toHaveLength(45);
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    expect(boxes[i].width).toBeGreaterThan(0);
    expect(boxes[i].height).toBeGreaterThan(0);
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) hits.push(`${boxes[i].label} × ${boxes[j].label}`);
    }
  }
  expect(hits, hits.join(', ')).toEqual([]);
});

test('search Eagle dims other bubbles and Enter opens Eagle Country', async ({ page }) => {
  await openMap(page);
  await page.locator('#expand').click();
  await page.waitForFunction(() => document.querySelectorAll('.node').length === 45);
  await page.locator('#search').fill('Eagle');
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('.node')];
    if (nodes.length !== 45) return false;
    return nodes.every((node) => {
      const opacity = Number(node.getAttribute('opacity'));
      return Math.abs(opacity - 1) < 0.01 || Math.abs(opacity - 0.2) < 0.01;
    });
  });
  const opacities = await page.locator('.node').evaluateAll((els) => els.map((el) => ({
    id: el.dataset.id,
    opacity: Number(el.getAttribute('opacity')),
  })));
  const bright = opacities.filter((node) => node.opacity > 0.5).map((node) => node.id).sort();
  expect(bright).toEqual(['its-taig2k-services-eagle', 'promo-outreach-eagle']);
  for (const node of opacities) {
    if (bright.includes(node.id)) expect(node.opacity).toBeCloseTo(1, 1);
    else expect(node.opacity).toBeCloseTo(0.2, 1);
  }
  await page.locator('#search').press('Enter');
  await expect(page.locator('#panel')).toHaveClass(/is-open/);
  await expect(page.locator('#label')).toHaveValue('Eagle Country');
});

test('clicking a bubble opens the detail panel', async ({ page }) => {
  await openMap(page);
  await page.locator('.node[data-id="cott"]').click();
  await expect(page.locator('#panel')).toHaveClass(/is-open/);
  await expect(page.locator('#label')).toHaveValue('COTT');
  await expect(page.locator('#note')).toBeVisible();
  await expect(page.locator('#status button')).toHaveCount(5);
});

test('a note survives reload and the bubble shows TODAY', async ({ page }) => {
  await openMap(page);
  await page.locator('.node[data-id="tan"]').click();
  await page.locator('#note').fill('CI round trip');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/bubbles/tan') && res.request().method() === 'PATCH' && res.ok()),
    page.locator('#saveNote').click(),
  ]);
  await expect(page.locator('.node[data-id="tan"]')).toContainText('TODAY');
  await page.reload();
  await page.waitForSelector('.node[data-id="tan"]');
  await expect(page.locator('.node[data-id="tan"]')).toContainText('TODAY');
  await page.locator('.node[data-id="tan"]').click();
  await expect(page.locator('#note')).toHaveValue('CI round trip');
});

test('a 390px viewport does not scroll sideways and the panel is usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  await page.locator('.node[data-id="cott"]').click();
  await expect(page.locator('#panel')).toHaveClass(/is-open/);
  await page.locator('#note').scrollIntoViewIfNeeded();
  const note = await page.locator('#note').boundingBox();
  expect(note).toBeTruthy();
  expect(note.x).toBeGreaterThanOrEqual(0);
  expect(note.x + note.width).toBeLessThanOrEqual(390);
  await page.locator('#note').fill('mobile note');
  await expect(page.locator('#note')).toHaveValue('mobile note');
  const after = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth);
});
