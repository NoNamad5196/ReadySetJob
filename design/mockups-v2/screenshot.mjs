import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let playwright;
const candidatePaths = [
  'playwright',
  '/data/home/.npm/_npx/9833c18b2d85bc59/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright'
];

for (const p of candidatePaths) {
  try {
    playwright = require(p);
    break;
  } catch (e) {
    // try next
  }
}

if (!playwright) {
  throw new Error('Playwright could not be loaded from candidate paths');
}

const { chromium } = playwright;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const desktopScreens = [
  { file: '1/dashboard.html', output: 'screenshots/1-dashboard.png' },
  { file: '1/kanban.html', output: 'screenshots/1-kanban.png' },
  { file: '1/editor.html', output: 'screenshots/1-editor.png' },
  { file: '2/dashboard.html', output: 'screenshots/2-dashboard.png' },
  { file: '2/kanban.html', output: 'screenshots/2-kanban.png' },
  { file: '2/editor.html', output: 'screenshots/2-editor.png' },
  { file: '3/dashboard.html', output: 'screenshots/3-dashboard.png' },
  { file: '3/kanban.html', output: 'screenshots/3-kanban.png' },
  { file: '3/editor.html', output: 'screenshots/3-editor.png' }
];

const mobileScreens = [
  { file: '1/kanban.html', output: 'screenshots/1-kanban-mobile.png' },
  { file: '2/kanban.html', output: 'screenshots/2-kanban-mobile.png' },
  { file: '3/kanban.html', output: 'screenshots/3-kanban-mobile.png' }
];

async function capture() {
  console.log('Starting Playwright screenshot capture for v2 mockups...');
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop captures (1440x900)
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });
  const desktopPage = await desktopContext.newPage();

  for (const item of desktopScreens) {
    const fullPath = path.join(__dirname, item.file);
    const fileUrl = `file://${fullPath}`;
    const outputPath = path.join(__dirname, item.output);

    console.log(`Capturing Desktop: ${item.file} -> ${item.output}`);
    await desktopPage.goto(fileUrl, { waitUntil: 'load' });
    await desktopPage.waitForTimeout(400);
    await desktopPage.screenshot({ path: outputPath, fullPage: false });
  }
  await desktopContext.close();

  // 2. Mobile captures (390x844)
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const mobilePage = await mobileContext.newPage();

  for (const item of mobileScreens) {
    const fullPath = path.join(__dirname, item.file);
    const fileUrl = `file://${fullPath}`;
    const outputPath = path.join(__dirname, item.output);

    console.log(`Capturing Mobile: ${item.file} -> ${item.output}`);
    await mobilePage.goto(fileUrl, { waitUntil: 'load' });
    await mobilePage.waitForTimeout(400);
    await mobilePage.screenshot({ path: outputPath, fullPage: false });
  }
  await mobileContext.close();

  await browser.close();
  console.log('All 12 v2 screenshots captured successfully!');
}

capture().catch((err) => {
  console.error('Error during screenshot capture:', err);
  process.exit(1);
});
