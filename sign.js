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
        console.log('✅ TG 通知发送成功');
    } catch (err) { 
        console.error('❌ TG 发送失败:', err.message); 
    }
}

async function takeScreenshot(page, name) {
    try {
        await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
        console.log(`📸 截图已保存: ${name}.png`);
    } catch (e) { 
        console.log(`❌ 截图失败: ${e.message}`); 
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    let browser;
    let page;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        console.log('🚀 步骤 1: 正在连接到本地 Chrome 浏览器...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 }
        });

        page = await browser.newPage();
        
        console.log('🌐 步骤 2: 正在打开登录页面...');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle0', timeout: 60000 });
        await delay(3000);
        
        console.log('⌨️ 步骤 3: 正在输入账号密码...');
        await page.evaluate((email, pwd) => {
            document.querySelectorAll('input')[0].value = email;
            document.querySelectorAll('input')[0].dispatchEvent(new Event('input', { bubbles: true }));
            document.querySelectorAll('input')[1].value = pwd;
            document.querySelectorAll('input')[1].dispatchEvent(new Event('input', { bubbles: true }));
        }, EMAIL, PASSWORD);
        
        console.log('🖱️ 步骤 4: 点击登录按钮...');
        await page.evaluate(() => document.querySelector('button[type="submit"]')?.click() || document.querySelector('button').click());
        
        console.log('⏳ 等待 10 秒，让页面完成重定向...');
        await delay(10000);

        console.log('🌐 步骤 5: 跳转到每日签到页面...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle0', timeout: 60000 });
        
        console.log('⏳ 等待 10 秒，确保签到页面完全加载...');
        await delay(10000); 

        console.log('🖱️ 步骤 6: 尝试点击“立即签到”按钮...');
        await page.evaluate(() => document.querySelector('button.ant-btn-primary')?.click());
        
        // ==========================================
        // === 核心逻辑：处理 Cloudflare 验证框 ===
        // ==========================================
        console.log('🕵️ 步骤 7: 等待 5 秒，检测是否有 Cloudflare 验证框弹出...');
        await delay(5000);
        const iframes = await page.$$('iframe');
        console.log(`🔍 页面上共发现 ${iframes.length} 个 iframe`);
        
        for (const iframe of iframes) {
            const src = await iframe.evaluate(el => el.src || '');
            const title = await iframe.evaluate(el => el.title || '');
            
            // 只要包含 cloudflare 或 turnstile 关键字就认为是目标
            if (src.includes('cloudflare') || src.includes('turnstile') || title.toLowerCase().includes('cloudflare')) {
                console.log(`🎯 找到 CF 验证框! (src: ${src.substring(0, 50)}...)`);
                const box = await iframe.boundingBox();
                
                if (box) {
                    console.log(`📏 验证框坐标: X=${box.x}, Y=${box.y}, 宽=${box.width}, 高=${box.height}`);
                    
                    // 【关键修复】：点击框的左侧 30px 处，而不是正中心！正中心是白板，左边才是框！
                    const clickX = box.x + 30; 
                    const clickY = box.y + (box.height / 2);
                    
                    console.log(`🖱️ 鼠标正在移动到复选框位置: X=${clickX}, Y=${clickY} 并点击...`);
                    await page.mouse.move(clickX, clickY, { steps: 10 }); // 模拟真实滑动
                    await delay(500);
                    await page.mouse.down();
                    await delay(100);
                    await page.mouse.up();
                    
                    console.log('✅ 点击验证框完成，等待 10 秒让 CF 验证通过...');
                    await delay(10000);
                }
            }
        }
        
        console.log('📸 记录最终页面状态截图...');
        await takeScreenshot(page, 'final_result');

        // ==========================================
        // === 严格验证是否真的签到成功 ===
        // ==========================================
        console.log('📊 步骤 8: 提取页面数据并严格验证结果...');
        const pageText = await page.evaluate(() => document.body.innerText);
        
        // 如果页面上依然存在这几个字，说明根本没成功
        if (pageText.includes('今日还未签到')) {
            throw new Error('页面依然显示“今日还未签到”，可能人机验证未通过或遇到其他限制！');
        }

        const data = {
            days: pageText.match(/(?:已连续签到|连续签到)\s*(\d+)\s*天/)?.[1] || "未知",
            pts: pageText.match(/(\d+)\s*(?:积分|pts)/i)?.[1] || "未知"
        };

        console.log(`🎉 抓取到数据 - 天数: ${data.days}, 积分: ${data.pts}`);
        messageResult += `✅ 签到成功！\n📅 连续签到：${data.days} 天\n💎 当前积分：${data.pts}`;

    } catch (error) {
        console.error('❌ 运行过程中发生错误:', error.message);
        messageResult += `❌ 签到失败\n原因：${error.message}`;
    } finally {
        if (browser) {
            console.log('🔌 断开浏览器连接...');
            await browser.disconnect();
        }
        console.log('📨 准备发送 Telegram 通知...');
        await sendTelegram(messageResult);
        console.log('🏁 脚本执行完毕。');
        process.exit(0);
    }
})();
