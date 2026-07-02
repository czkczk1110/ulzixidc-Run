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
        let retries = 5;
        while (retries > 0) {
            try {
                browser = await puppeteer.connect({
                    browserURL: 'http://127.0.0.1:9222',
                    defaultViewport: { width: 1280, height: 800 }
                });
                console.log('✅ 成功连接到 Chrome 浏览器！');
                break;
            } catch (connectErr) {
                retries--;
                console.log(`⚠️ 连接稍微延迟，剩余重试次数: ${retries}。`);
                if (retries === 0) throw connectErr;
                await delay(3000);
            }
        }

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

        // 核心优化 1: 先关掉底部可能挡住点击的 Cookie 提示蓝条
        console.log('🧹 尝试清理页面遮挡物 (如 Cookie 提示栏)...');
        await page.evaluate(() => {
            // 点击右下角的关闭叉叉号
            const closeBtn = document.querySelector('span[aria-label="close"]') || document.querySelector('.anticon-close');
            if (closeBtn) closeBtn.click();
        }).catch(e => console.log('未找到或无法关闭 Cookie 栏，跳过'));
        await delay(1000);

        console.log('🖱️ 步骤 6: 尝试点击“立即签到”按钮...');
        await page.evaluate(() => {
            const btn = document.querySelector('button.ant-btn-primary') || document.querySelector('button');
            if (btn) btn.click();
        });
        await delay(5000);

        // ==========================================
        // === 核心逻辑：利用绝对物理坐标盲点验证框 ===
        // ==========================================
        console.log('🕵️ 步骤 7: 采用空间坐标系定位物理点击 Cloudflare 验证框...');
        
        // 依据 1280x800 分辨率截图分析：
        // 整个验证区域居中靠下，Verify 小方框中心恰好在 X: 575, Y: 680 的绝对位置
        const clickX = 575;
        const clickY = 680;
        
        console.log(`🖱️ 模拟真人鼠标轨迹滑动到固定坐标: X=${clickX}, Y=${clickY}`);
        await page.mouse.move(clickX, clickY, { steps: 15 }); 
        await delay(800);
        
        console.log('点击小方框...');
        await page.mouse.down();
        await delay(150);
        await page.mouse.up();
        
        console.log('✅ 盲点完成，给系统 15 秒缓冲，处理人机响应及数据刷新...');
        await delay(15000);
        
        console.log('📸 记录最终页面状态截图...');
        await takeScreenshot(page, 'final_result');

        // ==========================================
        // === 严格验证是否真的签到成功 ===
        // ==========================================
        console.log('📊 步骤 8: 提取页面数据并验证结果...');
        const pageText = await page.evaluate(() => document.body.innerText);
        
        if (pageText.includes('今日还未签到')) {
            throw new Error('页面依然显示“今日还未签到”，物理点击未触发或人机拦截失败！');
        }

        const data = {
            days: pageText.match(/(?:已连续签到|连续签到)\s*(\d+)\s*天/)?.[1] || "未知",
            pts: pageText.match(/(\d+)\s*(?:积分|pts)/i)?.[1] || "未知"
        };

        console.log(`🎉 签到成功 - 天数: ${data.days}, 积分: ${data.pts}`);
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
