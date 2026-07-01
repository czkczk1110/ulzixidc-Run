const puppeteer = require('puppeteer-core');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;
const TG_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

// 确保存放截图的文件夹存在
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

// 封装一个安全的截图函数
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
            protocolTimeout: 240000 // 进一步拉长通信到 4 分钟
        });

        page = await browser.newPage();
        
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
            }
        });
        
        console.log('等待页面完成登录重定向...');
        await delay(8000);

        // --- 2. 跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle2', timeout: 60000 });

        // --- 3. 等待并截取 Cloudflare 5秒盾的状态 ---
        console.log('留出 15 秒供验证码环境自主加载...');
        await delay(15000); 
        
        // 【核心截图 1】：人机验证及签到专区初始画面
        await takeScreenshot(page, '1_before_signin_page');

        // --- 4. 寻找“立即签到”按钮 ---
        console.log('执行第三步：尝试寻找“立即签到”按钮...');
        const buttons = await page.$$('button');
        let targetButton = null;
        
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text.includes('立即签到')) {
                targetButton = btn;
                break;
            }
        }
        
        if (targetButton) {
            console.log('精准定位到“立即签到”按钮，开始触发物理点击...');
            // 【核心截图 2】：准备点击按钮那一瞬间
            await takeScreenshot(page, '2_just_before_click');
            
            // 执行物理点击
            await targetButton.click(); 
            console.log('点击事件已发送。');
        } else {
            console.log('未通过文本找到“立即签到”按钮，尝试使用常规选择器盲点...');
            await page.click('button.ant-btn-primary');
        }
        
        // 等待点击后的数据刷新
        await delay(8000);
        // 【核心截图 3】：点击完之后的最终状态
        await takeScreenshot(page, '3_after_clicked_result');

        // --- 5. 数据抓取与提取 ---
        console.log('第四步：提取数据...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/已连续签到\s*(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*pts/i);
            
            return {
                days: daysMatch ? daysMatch[1] : "未捕获到天数",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        });

        messageResult += `✅ 自动签到任务执行成功！\n📅 连续签到天数：${data.days} 天\n💎 获得/当前积分：${data.pts} pts`;
        console.log(messageResult);

    } catch (error) {
        console.error('运行出现异常:', error);
        messageResult += `❌ 签到失败\n原因：${error.message}`;
        
        // 【异常兜底截图】：崩盘时的画面快照
        if (page) {
            await takeScreenshot(page, 'error_dump_page');
        }
    } finally {
        if (browser) {
            await browser.disconnect();
        }
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
