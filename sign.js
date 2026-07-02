const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

async function sendTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (err) { console.error('TG 发送失败'); }
}

async function takeScreenshot(page, name) {
    await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    let browser;
    try {
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: { width: 1280, height: 800 } });
        const page = await browser.newPage();
        
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle0' });
        await page.evaluate((e, p) => {
            const inputs = document.querySelectorAll('input');
            inputs[0].value = e; inputs[1].value = p;
        }, EMAIL, PASSWORD);
        await page.evaluate(() => document.querySelector('button[type="submit"]')?.click());
        await delay(10000);

        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle0' });
        await delay(5000);

        // 优化：仅隐藏遮挡物，不删除 DOM
        await page.evaluate(() => {
            const cookies = Array.from(document.querySelectorAll('div')).find(el => el.innerText?.includes('cookies'));
            if (cookies) cookies.style.display = 'none';
        });

        console.log('点击签到按钮...');
        await page.evaluate(() => document.querySelector('button.ant-btn-primary')?.click());
        await delay(8000);

        // 使用更稳健的 iframe 定位方式
        const frames = page.frames();
        for (const frame of frames) {
            if (frame.url().includes('turnstile')) {
                console.log('检测到 CF 验证框，执行点击...');
                // 获取 iframe 内部的验证复选框并点击
                await frame.evaluate(() => {
                    const checkbox = document.querySelector('input[type="checkbox"]') || document.querySelector('#checkbox');
                    if (checkbox) checkbox.click();
                });
                break;
            }
        }
        
        await delay(15000);
        await takeScreenshot(page, 'final_result');
        
        const text = await page.evaluate(() => document.body.innerText);
        const success = text.includes('连续签到') && !text.includes('今日还未签到');
        
        await sendTelegram(success ? "✅ 签到成功！" : "❌ 签到疑似失败，请查看截图。");
        
    } catch (error) {
        console.error(error.message);
    } finally {
        if (browser) await browser.disconnect();
        process.exit(0);
    }
})();
