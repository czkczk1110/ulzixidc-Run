const puppeteer = require('puppeteer-core');
const axios = require('axios');

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
        console.log('正在连接到本地 Chrome...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // --- 1. 图一：打开并填写登录信息 ---
        console.log('正在打开登录页面...');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('输入邮箱与密码...');
        // 精准匹配 placeholder="请输入邮箱" / placeholder="请输入密码"
        await page.waitForSelector('input[placeholder*="邮箱"]', { timeout: 15000 });
        await page.type('input[placeholder*="邮箱"]', EMAIL);
        await page.type('input[placeholder*="密码"]', PASSWORD);
        
        console.log('点击登录按钮...');
        // 对应图一标志4：包含“登录”二字的蓝色主按钮
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const loginBtn = buttons.find(b => b.textContent.trim() === '登录');
            if (loginBtn) loginBtn.click();
            else throw new Error("未找到登录按钮");
        });
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('成功登录，转跳中...');

        // --- 2. 图二：跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 图二标志2：点击并处理 Cloudflare Turnstile 真人验证 ---
        console.log('等待 Cloudflare 5秒盾验证框加载...');
        await page.waitForTimeout(5000); // 留出时间给浏览器渲染 CF 框架

        // 尝试点击 Cloudflare 验证复选框
        try {
            const frames = page.frames();
            const cfFrame = frames.find(f => f.url().includes('cloudflarechallenges.com'));
            if (cfFrame) {
                console.log('检测到 Cloudflare 验证盾，正在尝试点击复选框...');
                await cfFrame.waitForSelector('#challenge-stage', { timeout: 5000 });
                await cfFrame.click('#challenge-stage');
                console.log('已点击验证按钮，等待验证通过...');
                await page.waitForTimeout(6000); 
            } else {
                console.log('未发现明显 CF 框架，跳过手动点击，交由浏览器指纹代劳。');
            }
        } catch (cfErr) {
            console.log('点击 CF 验证框时发生非致命异常，继续下一步:', cfErr.message);
        }

        // --- 4. 图二标志3：点击“立即签到” ---
        console.log('执行第三步：点击立即签到...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const signBtn = buttons.find(b => b.textContent.includes('立即签到'));
            if (signBtn) {
                signBtn.click();
            } else {
                console.log("未发现立即签到按钮，可能今日已签到过。");
            }
        });
        
        // 等待数据刷新
        await page.waitForTimeout(5000);

        // --- 5. 图二标志4、5：数据抓取与提取 ---
        console.log('第四步：提取连续签到天数和获取的积分...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            // 正则匹配“已连续签到 X 天”以及 类似 “10 pts” 
            const daysMatch = bodyText.match(/已连续签到\s*(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "数据未变动(可能今日已签过)",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        });

        messageResult += `✅ 自动签到任务执行成功！\n📅 标志4（连续签到）：${data.days} 天\n💎 标志5（获得积分）：${data.pts} pts`;
        console.log(messageResult);

    } catch (error) {
        console.error('运行出现异常:', error);
        messageResult += `❌ 签到失败\n原因：${error.message}`;
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
