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

// 替代旧版被移除的 waitForTimeout
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        
        // 留出 3 秒等登录框完全渲染
        await delay(3000);
        
        console.log('开始输入邮箱与密码...');
        // 超强兼容选择器逻辑：先找具有属性的，找不到直接硬塞前两个 input 框
        await page.evaluate((email, pwd) => {
            let emailInput = document.querySelector('input[placeholder*="邮箱"]') || document.querySelectorAll('input')[0];
            let passwordInput = document.querySelector('input[placeholder*="密码"]') || document.querySelectorAll('input')[1];
            
            if (emailInput && passwordInput) {
                emailInput.value = email;
                // 触发前端输入框绑定的 input 事件，防止双向绑定不更新
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                
                passwordInput.value = pwd;
                passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                throw new Error("页面上未定位到任何输入框");
            }
        }, EMAIL, PASSWORD);
        
        console.log('点击登录按钮...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const loginBtn = buttons.find(b => b.textContent.trim() === '登录');
            if (loginBtn) {
                loginBtn.click();
            } else {
                // 如果找不到包含“登录”文字的按钮，直接点页面上的第一个主 button
                const firstBtn = document.querySelector('button');
                if (firstBtn) firstBtn.click();
                else throw new Error("未找到登录按钮");
            }
        });
        
        console.log('等待页面完成登录重定向...');
        await delay(6000);

        // --- 2. 图二：跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 图二标志2：处理 Cloudflare Turnstile 真人验证 ---
        console.log('等待 Cloudflare 5秒盾验证框稳定并自动验证...');
        await delay(8000); // 留出充足时间让 Cloak 代理环境自主通过或稳定网络

        try {
            const frames = page.frames();
            const cfFrame = frames.find(f => f.url().includes('cloudflarechallenges.com'));
            if (cfFrame) {
                console.log('检测到 Cloudflare 验证盾结构，尝试强制激活点击...');
                await cfFrame.click('#challenge-stage').catch(() => {});
                await delay(5000); 
            }
        } catch (cfErr) {
            console.log('跳过挑战框交互，交由原生指纹环境:', cfErr.message);
        }

        // --- 4. 图二标志3：点击“立即签到” ---
        console.log('执行第三步：点击立即签到...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const signBtn = buttons.find(b => b.textContent.includes('立即签到'));
            if (signBtn) {
                signBtn.click();
            } else {
                console.log("未发现立即签到按钮，可能已被点击。");
            }
        });
        
        // 等待数据刷新
        await delay(5000);

        // --- 5. 图二标志4、5：数据抓取与提取 ---
        console.log('第四步：提取连续签到天数和获得的积分...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/已连续签到\s*(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "未捕获到数字(可能今天已签过)",
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
