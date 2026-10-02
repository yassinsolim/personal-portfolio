// usage: node scripts/render-car-thumbs.mjs --url http://localhost:8080/ [carId ...]
// the car picker's pictures: each car on the garage turntable, three quarters
// from the front, cropped to the car and saved as static/images/cars/<id>.webp.
// needs a running build (npm run build, then serve build/)
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import ts from 'typescript';

const args = process.argv.slice(2);
const flag = args.indexOf('--url');
const url = flag >= 0 ? args.splice(flag, 2)[1] : 'http://localhost:8080/';
const WIDTH = 480;
const HEIGHT = 270;

const source = await fs.readFile(new URL('../src/Application/carOptions.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { carOptions } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const cars = carOptions.map((car) => car.id).filter((id) => !args.length || args.includes(id));

// the newest installed chromium build, as race-transition-check.mjs finds it
const findChromium = () => {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
    if (!existsSync(cache)) return undefined;
    const builds = readdirSync(cache)
        .filter((dir) => /^chromium-\d+$/.test(dir))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of builds) {
        const exe = path.join(
            cache,
            dir,
            'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        );
        if (existsSync(exe)) return exe;
    }
    return undefined;
};

const browser = await chromium.launch({
    headless: false,
    executablePath: findChromium(),
    args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await context.addInitScript((first) => {
    localStorage.setItem('yassinverse:selectedCar', first);
    localStorage.setItem('yassinverse:renderMode', 'quality');
    for (const key of Object.keys(localStorage)) if (key.startsWith('yassinverse:garage')) localStorage.removeItem(key);
}, cars[0]);
const page = await context.newPage();
await page.goto(`${url}?raceDebug=1&raceTier=high`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => performance.getEntriesByName('loader:os').length > 0, null, { timeout: 120000 });
await page.waitForSelector('.garage-launch', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('.garage-launch').click();
await page.waitForFunction(() => window.Application.world.raceManager?.garageOpen, null, { timeout: 120000 });
await page.addStyleTag({ content: '.garage-panel,.garage-title,.look-hint,.garage-launch{display:none!important}' });
await fs.mkdir('static/images/cars', { recursive: true });

for (const id of cars) {
    await page.evaluate((car) => {
        const select = document.querySelector('#car-switcher');
        select.value = car;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
    await page.waitForFunction(
        (car) => {
            const vehicle = window.Application.world.raceManager.vehicle;
            return vehicle.currentCarId === car && vehicle.carModel?.userData.raceWheelMeta?.length;
        },
        id,
        { timeout: 120000 }
    );
    // the car's box on screen once the orbit camera has settled
    const box = await page.evaluate(async () => {
        const manager = window.Application.world.raceManager;
        manager.chaseCamera.garageDragIdle = -1e9;
        manager.chaseCamera.garageAngle = -1.94;
        manager.chaseCamera.garagePitch = 0.12;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const camera = window.Application.camera.instance;
        const Box = window.Application.world.raceTransition.carBox.constructor;
        // the car's own meshes, not the soft shadow plane under it
        const b = new Box();
        manager.vehicle.carModel.traverse((child) => {
            if (child.isMesh && child.visible && !/shadow/i.test(child.name)) b.expandByObject(child);
        });
        const xs = [];
        const ys = [];
        for (let i = 0; i < 8; i++) {
            const p = camera.position
                .clone()
                .set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
                .project(camera);
            xs.push((p.x * 0.5 + 0.5) * innerWidth);
            ys.push((0.5 - p.y * 0.5) * innerHeight);
        }
        return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const shot = await page.screenshot();
    // the box widened to the picture's shape, with a margin
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const w = Math.max(box.x1 - box.x0, ((box.y1 - box.y0) * WIDTH) / HEIGHT) * 1.08;
    const h = (w * HEIGHT) / WIDTH;
    const left = Math.max(0, Math.round((cx - w / 2) * 2));
    const top = Math.max(0, Math.round((cy - h / 2) * 2));
    const out = path.join('static/images/cars', `${id}.webp`);
    await sharp(shot)
        .extract({
            left,
            top,
            width: Math.min(2560 - left, Math.round(w * 2)),
            height: Math.min(1440 - top, Math.round(h * 2)),
        })
        .resize(WIDTH, HEIGHT, { fit: 'cover' })
        .webp({ quality: 78 })
        .toFile(out);
    console.log(`${id}: ${out}`);
}
await browser.close();
