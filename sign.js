const puppeteer = require('puppeteer-core');
const axios = require('axios');

// 从环境变量获取配置
const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegram(message) {
    if (!TG_TOKEN || !TG_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log('TG 通知发送成功');
    } catch (err) {
        console.error('TG 通知发送失败:', err.message);
    }
}

(async () => {
    let browser;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        console.log('正在启动 CloakBrowser...');
        // 连接到 GitHub 工作流中启动的 CloakBrowser / Chrome 实例
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // --- 1. 登录页面操作 ---
        console.log('正在打开登录页面...');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('正在输入账号密码...');
        await page.waitForSelector('input[placeholder*="邮箱"]', { timeout: 15000 });
        await page.type('input[placeholder*="邮箱"]', EMAIL);
        await page.type('input[placeholder*="密码"]', PASSWORD);
        
        console.log('点击登录...');
        await Promise.all([
            page.click('button:has-text("登录")'), // 兼容伪类，若不行则改用普通选择器或点击包含"登录"的文字
            // 或者使用通用的包含文本点击：
            page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const loginBtn = buttons.find(b => b.textContent.includes('登录'));
                if (loginBtn) loginBtn.click();
            }),
            page.waitForNavigation({ waitUntil: 'networkidle2' })
        ]);

        // --- 2. 跳转到签到页面 ---
        console.log('正在跳转到签到页面...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 处理 Cloudflare Turnstile 验证码 ---
        console.log('等待 Cloudflare 验证框加载...');
        // 尝试等待 CF 框架出现并处理（CloakBrowser 结合住宅/节点代理通常能自动过或者减少验证难度）
        // 等待几秒给 CloakBrowser 自动化框架自行绕过/稳定时间
        await new Promise(resolve => setTimeout(resolve, 8000)); 

        // --- 4. 点击立即签到 ---
        console.log('尝试点击立即签到按钮...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const signBtn = buttons.find(b => b.textContent.includes('立即签到'));
            if (signBtn) signBtn.click();
        });
        
        // 等待签到请求完成
        await new Promise(resolve => setTimeout(resolve, 5000));

        // --- 5. 获取标志4和标志5的数据 ---
        console.log('正在获取签到结果数据...');
        const checkData = await page.evaluate(() => {
            // 寻找包含“已连续签到”的文本节点
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/已连续签到\s*(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "未知",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        });

        messageResult += `✅ 签到状态：执行完毕\n📅 连续签到：${checkData.days} 天\n💎 获得积分：${checkData.pts} pts`;
        console.log(messageResult);

    } catch (error) {
        console.error('运行中出错:', error);
        messageResult += `❌ 签到失败\n错误原因：${error.message}`;
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        // 发送通知
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
