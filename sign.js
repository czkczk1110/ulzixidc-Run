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
    try {
        await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
    } catch (e) { console.log(`截图失败: ${e.message}`); }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    let browser;
    let page;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 }
        });

        page = await browser.newPage();
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle0', timeout: 60000 });
        await delay(3000);
        
        await page.evaluate((email, pwd) => {
            document.querySelectorAll('input')[0].value = email;
            document.querySelectorAll('input')[1].value = pwd;
        }, EMAIL, PASSWORD);
        
        await page.evaluate(() => document.querySelector('button[type="submit"]')?.click() || document.querySelector('button').click());
        await delay(10000);

        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle0', timeout: 60000 });
        await delay(10000); 

        // 尝试点击签到
        await page.evaluate(() => document.querySelector('button.ant-btn-primary')?.click());
        
        // 处理 Cloudflare 验证
        console.log('检测 Cloudflare 验证框...');
        await delay(5000);
        const iframes = await page.$$('iframe');
        for (const iframe of iframes) {
            const src = await iframe.evaluate(el => el.src || '');
            if (src.includes('cloudflare')) {
                const box = await iframe.boundingBox();
                if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
            }
        }
        
        await delay(10000);
        await takeScreenshot(page, 'final_result');

        const data = await page.evaluate(() => {
            const body = document.body.innerText;
            return {
                days: body.match(/(\d+)\s*天/)?.[1] || "未知",
                pts: body.match(/(\d+)\s*(?:积分|pts)/i)?.[1] || "未知"
            };
        });

        messageResult += `✅ 签到完毕！\n📅 天数：${data.days}\n💎 积分：${data.pts}`;

    } catch (error) {
        messageResult += `❌ 签到失败：${error.message}`;
    } finally {
        if (browser) await browser.disconnect();
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
