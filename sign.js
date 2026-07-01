const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

const screenshotDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
}

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

async function takeScreenshot(page, name) {
    try {
        const filePath = path.join(screenshotDir, `${name}.png`);
        await page.screenshot({ path: filePath, fullPage: true });
        console.log(`📸 截图已保存: screenshots/${name}.png`);
    } catch (e) {
        console.log(`❌ 截图失败 (${name}):`, e.message);
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    let browser;
    let page;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        console.log('正在连接到本地 Chrome...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 1000 },
            protocolTimeout: 300000 // 延长至 5 分钟
        });

        page = await browser.newPage();
        
        // --- 1. 登录页面流程 ---
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
            }
        });
        
        console.log('等待页面完成登录重定向...');
        await delay(8000);

        // --- 2. 跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 强力破盾与关横幅等待 ---
        console.log('正在等待验证码和遮挡组件加载 (给予 20 秒宽裕时间)...');
        await delay(20000); 

        // 尝试自动关掉遮挡视线的 Cookie 横幅，防止干扰
        await page.evaluate(() => {
            // 寻找带有“X”号或者包含 cookies 文本框里的 button 并点击
            const closeBtn = document.querySelector('.ant-modal-close, .close, [class*="close"]');
            if (closeBtn) closeBtn.click();
            
            // 如果还存在，直接通过 JS 把整条蓝色横幅蒸发掉
            const elements = Array.from(document.querySelectorAll('div'));
            const cookieBar = elements.find(el => el.textContent.includes('cookies'));
            if (cookieBar) cookieBar.style.display = 'none';
        }).catch(() => {});

        // 截取点击前的最终画面
        await takeScreenshot(page, '1_before_signin_page');

        // --- 4. 绕过 CF 拦截：执行底层 DOM 级 JS 强制点击 ---
        console.log('执行第三步：正在通过底层注入直接激活“立即签到”方法...');
        
        const clickResult = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            // 匹配带有“立即签到”或含有四个方块乱码但实质是签到的主按钮
            const signBtn = buttons.find(b => b.textContent.includes('立即签到') || b.querySelector('.anticon-check-circle') || b.className.includes('ant-btn-primary'));
            
            if (signBtn) {
                // 核心：不用 Puppeteer 鼠标，直接用网页原生 JS 触发点击，能够百分百绕过 Input.dispatchMouseEvent 挂起错误！
                signBtn.click();
                return "已找到按钮并执行底层 JS 强制点击";
            }
            return "未在页面中定位到匹配按钮";
        });
        
        console.log(`底层反馈: ${clickResult}`);
        await delay(8000);

        // 截取点击后的画面
        await takeScreenshot(page, '3_after_clicked_result');

        // --- 5. 数据抓取与提取 ---
        console.log('第四步：提取数据...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/(?:已连续签到|连续签到)\s*(\d+)\s*天/) || bodyText.match(/(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "无法读取(可能今日已签过)",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        });

        messageResult += `✅ 自动签到任务处理完毕！\n📅 连续签到天数：${data.days} 天\n💎 获得/当前积分：${data.pts} pts`;
        console.log(messageResult);

    } catch (error) {
        console.error('运行出现异常:', error);
        messageResult += `❌ 签到失败\n原因：${error.message}`;
        if (page) {
            await takeScreenshot(page, 'error_dump_page').catch(() => {});
        }
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
