const { connect } = require('puppeteer-real-browser');
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

// 修复黑屏：直接截取标准视窗画面
async function takeScreenshot(page, name) {
    try {
        const filePath = path.join(screenshotDir, `${name}.png`);
        await page.screenshot({ path: filePath }); 
        console.log(`📸 截图已保存: screenshots/${name}.png`);
    } catch (e) {
        console.log(`❌ 截图失败 (${name}):`, e.message);
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTurnstileSolved(page, timeoutMs = 20000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        const token = await page.evaluate(() => {
            const el = document.querySelector('input[name="cf-turnstile-response"]');
            return el ? el.value : '';
        });
        if (token && token.length > 0) {
            console.log('✅ 人机验证已成功通过！(Token 已填充)');
            return true;
        }
        await delay(1000);
    }
    return false;
}

(async () => {
    let browser;
    let page;
    let messageResult = "🔔 *Ulzix 自动签到通知*\n";

    try {
        console.log('正在启动 undetected Chrome 浏览器并进行初始化...');
        
        // 核心改动：使用 puppeteer-real-browser 启动真实对抗指纹浏览器
        const response = await connect({
            headless: "auto", // 虚拟帧缓冲无头模式，解决 Linux 上的过检测难题
            turnstile: true,  // 自动处理并点击 Cloudflare Turnstile 验证码
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--proxy-server=socks5://127.0.0.1:10080', // 接入 xray 本地代理
                '--lang=zh-CN'
            ]
        });

        browser = response.browser;
        page = response.page;

        // 设置标准电脑视窗大小
        await page.setViewport({ width: 1280, height: 800 });

        // 监听并自动关闭页面弹窗，防止 alert 导致 puppeteer 挂起超时
        page.on('dialog', async dialog => {
            console.log(`💬 检测到页面弹窗提示: [${dialog.type()}] "${dialog.message()}"`);
            await dialog.dismiss().catch(() => {});
            console.log('👉 已自动关闭弹窗。');
        });

        // --- 1. 登录流程 ---
        console.log('正在打开登录页面...');
        await page.goto('https://idc-new.ulzix.com/login', { waitUntil: 'networkidle0', timeout: 60000 });
        await delay(5000);
        
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
        await delay(10000);

        // --- 2. 跳转至签到专区 ---
        console.log('正在跳转到每日签到网址...');
        await page.goto('https://idc-new.ulzix.com/pointmall/signin', { waitUntil: 'networkidle0', timeout: 60000 });

        console.log('给予 20 秒宽裕时间等待页面完全渲染...');
        await delay(20000); 

        await takeScreenshot(page, '1_before_signin_page');

        // ====== 【处理 Cloudflare Turnstile】 ======
        console.log('正在等待 Cloudflare Turnstile 在后台自动完成验证并打勾...');
        const isSolved = await waitForTurnstileSolved(page, 20000);
        if (isSolved) {
            console.log('✅ 人机验证已成功绕过！');
        } else {
            console.log('⚠️ 警告: 未能确认人机验证通过，将尝试强行点击签到。');
        }

        // --- 3. 定位签到按钮并尝试点击 ---
        console.log('执行第三步：正在定位签到按钮并尝试点击...');
        
        const clickStatus = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const signinBtn = buttons.find(b => b.textContent.includes('立即签到'));
            if (signinBtn) {
                signinBtn.click();
                return "成功触发【立即签到】按钮点击事件";
            }
            
            const primaryButton = document.querySelector('button.ant-btn-primary') || document.querySelector('button');
            if (primaryButton) {
                primaryButton.click();
                return "成功触发主按钮点击事件";
            }
            return "未找到合适的按钮元素";
        }).catch(err => `点击捕获发生异常: ${err.message}`);
        
        console.log(`按钮点击执行状态: ${clickStatus}`);
        
        // 延长等待时间至 15 秒，确保异步接口把积分更新到网页DOM里
        console.log('等待异步数据刷新响应...');
        await delay(15000); 

        await takeScreenshot(page, '3_after_clicked_result');

        // --- 4. 调试：直接在控制台输出当前网页内容，破除黑屏迷雾 ---
        console.log('=== [调试信息] 当前页面文本内容预览 ===');
        const dumpText = await page.evaluate(() => document.body.innerText);
        console.log(dumpText.substring(0, 800)); // 打印前800个字，让我们能在 Actions 日志里直接看汉字
        console.log('======================================');

        // --- 5. 提取数据 ---
        console.log('第四步：提取数据...');
        const data = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const daysMatch = bodyText.match(/(?:已连续签到|连续签到|已签到)\s*(\d+)\s*天/) || bodyText.match(/(\d+)\s*天/);
            const ptsMatch = bodyText.match(/(\d+)\s*(?:pts|积分|点数)/i) || bodyText.match(/积分\s*:\s*(\d+)/);
            
            return {
                days: daysMatch ? daysMatch[1] : "已成功点击(请去官网确认天数)",
                pts: ptsMatch ? ptsMatch[1] : "未知"
            };
        }).catch(() => ({ days: "提取失败", pts: "提取失败" }));

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
            // 改用 close() 确保关闭浏览器实例
            await browser.close().catch(() => {});
        }
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
