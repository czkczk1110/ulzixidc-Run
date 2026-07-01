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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    let browser;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        console.log('正在连接到本地 Chrome...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 },
            protocolTimeout: 120000 // 将通信超时大幅延长到 2 分钟，防止被 CF 盾拖住时死锁
        });

        const page = await browser.newPage();
        
        // --- 1. 打开并填写登录信息 ---
        console.log('正在打开登录页面...');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(4000);
        
        console.log('开始输入邮箱与密码...');
        await page.evaluate((email, pwd) => {
            let emailInput = document.querySelector('input[placeholder*="邮箱"]') || document.querySelectorAll('input')[0];
            let passwordInput = document.querySelector('input[placeholder*="密码"]') || document.querySelectorAll('input')[1];
            
            if (emailInput && passwordInput) {
                emailInput.value = email;
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
            if (loginBtn) loginBtn.click();
            else {
                const firstBtn = document.querySelector('button');
                if (firstBtn) firstBtn.click();
                else throw new Error("未找到登录按钮");
            }
        });
        
        console.log('等待页面完成登录重定向...');
        await delay(8000);

        // --- 2. 跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 等待 Cloudflare 盾自主稳定 ---
        console.log('留出 15 秒供浏览器指纹和代理环境自主通过 Cloudflare 5秒盾...');
        await delay(15000); 

        // --- 4. 模拟真人鼠标物理点击“立即签到” ---
        console.log('执行第三步：尝试寻找并物理点击“立即签到”按钮...');
        
        // 通过 Puppeteer 原生定位文本包含“立即签到”的按钮，不走 evaluate 执行内部 js
        const [signButton] = await page.$$('button');
        let clicked = false;
        
        // 抓取页面所有的 button 元素，从外部模拟鼠标点击
        const buttons = await page.$$('button');
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes('立即签到')) {
                console.log('精准定位到“立即签到”按钮，发射物理点击事件...');
                await btn.click(); // 模拟真人鼠标指针敲击
                clicked = true;
                break;
            }
        }
        
        if (!clicked) {
            console.log('未通过文本找到按钮，尝试兜底点击页面上可能属于签到的主蓝色按钮...');
            // 如果文本因为 CF 没刷出来，直接尝试点击页面中央偏下的那个主蓝色按钮
            await page.click('button.ant-btn-primary').catch(() => {
                console.log('兜底选择器点击未生效');
            });
        }
        
        // 等待数据刷新
        await delay(6000);

        // --- 5. 数据抓取与提取 ---
        console.log('第四步：提取连续签到天数和获得的积分...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/已连续签到\s*(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "数据未变动(可能今日已签过/需下次看成效)",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        });

        messageResult += `✅ 自动签到任务执行成功！\n📅 连续签到天数：${data.days} 天\n💎 获得/当前积分：${data.pts} pts`;
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
