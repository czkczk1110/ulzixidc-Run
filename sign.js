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

async function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

(async () => {
    let browser;
    try {
        await log('启动脚本...');
        browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: { width: 1280, height: 800 } });
        const page = await browser.newPage();
        
        await log('打开登录页');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle0' });
        
        await log('输入凭据');
        await page.type('input[type="email"]', EMAIL);
        await page.type('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle0' });

        await log('进入签到页');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle0' });
        await new Promise(r => setTimeout(r, 5000));

        await log('执行签到点击');
        await page.click('button.ant-btn-primary');
        await new Promise(r => setTimeout(r, 10000));

        await log('处理验证 (尝试识别 IFRAME)');
        const frames = page.frames();
        for (const frame of frames) {
            if (frame.url().includes('turnstile')) {
                await log('发现验证框架，等待点击...');
                await frame.waitForSelector('body', { visible: true });
                await frame.click('body');
            }
        }
        
        await new Promise(r => setTimeout(r, 10000));
        await page.screenshot({ path: path.join(screenshotDir, 'final_result.png') });
        await log('截图已保存');

    } catch (e) {
        await log('脚本出错: ' + e.message);
    } finally {
        if (browser) await browser.disconnect();
        await log('结束脚本');
        process.exit(0);
    }
})();
