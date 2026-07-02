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

// 修复黑屏：不再使用 fullPage: true，直接截取标准视窗画面
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

// 新增辅助函数：循环检测隐藏的 cf-turnstile-response，判断是否已经通过验证
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
        console.log('正在连接到本地 Chrome...');
        browser = await puppeteer.connect({
            browserURL: 'http://127.0.0.1:9222',
            defaultViewport: { width: 1280, height: 800 },
            protocolTimeout: 60000
        });

        page = await browser.newPage();
        
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

        // === 【新增处理人机验证逻辑】 ===
        console.log('正在检测并处理 Cloudflare Turnstile 人机验证...');
        
        // 查找人机验证的 iframe 容器
        const turnstileIframe = await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', { timeout: 15000 }).catch(() => null);
        
        if (turnstileIframe) {
            console.log('检测到 Cloudflare Turnstile 验证框，准备进行模拟点击...');
            
            // 先检查是否已经自动通过验证
            let isSolved = await page.evaluate(() => {
                const el = document.querySelector('input[name="cf-turnstile-response"]');
                return el && el.value && el.value.length > 0;
            });
            
            if (!isSolved) {
                // 获取验证框的绝对物理坐标
                const rect = await turnstileIframe.boundingBox();
                if (rect) {
                    console.log(`验证框坐标: x=${rect.x.toFixed(1)}, y=${rect.y.toFixed(1)}, 宽度=${rect.width}, 高度=${rect.height}`);
                    
                    // 标准 Turnstile 尺寸一般是 300x65。复选框在左侧，x 轴向右偏移 30 像素，y 轴垂直居中。
                    const clickX = rect.x + 30;
                    const clickY = rect.y + (rect.height / 2);
                    
                    // 模拟真实鼠标轨迹滑动并点击，增强防爬检测通过率
                    await page.mouse.move(clickX, clickY, { steps: 15 });
                    await delay(500); 
                    await page.mouse.click(clickX, clickY);
                    console.log(`👉 已模拟鼠标移动并点击人机验证坐标: (${clickX.toFixed(1)}, (${clickY.toFixed(1)})`);
                    
                    await delay(2000);
                    await takeScreenshot(page, '2_after_turnstile_clicked');
                } else {
                    console.log('❌ 无法获取人机验证框的位置信息。');
                }
                
                // 循环等待验证成功，设置最长等待时间为 20 秒
                console.log('等待 Cloudflare 校验完成...');
                isSolved = await waitForTurnstileSolved(page, 20000);
            } else {
                console.log('✅ 人机验证已自动通过，无需额外点击。');
            }
            
            if (!isSolved) {
                console.log('⚠️ 警告: 未检测到验证通过状态，可能被 Cloudflare 拦截。将强行尝试点击签到按钮。');
            }
        } else {
            console.log('未检测到 Cloudflare Turnstile 验证框，直接跳过此步骤。');
        }
        // ==============================

        // --- 3. 定位签到按钮并尝试点击 ---
        console.log('执行第三步：正在定位签到按钮并尝试点击...');
        
        const clickStatus = await page.evaluate(() => {
            // 改进：为了避免误点其他按钮，优先查找包含“立即签到”文本的按钮
            const buttons = Array.from(document.querySelectorAll('button'));
            const signinBtn = buttons.find(b => b.textContent.includes('立即签到'));
            if (signinBtn) {
                signinBtn.click();
                return "成功触发【立即签到】按钮点击事件";
            }
            
            // 备用兜底逻辑
            const primaryButton = document.querySelector('button.ant-btn-primary') || document.querySelector('button');
            if (primaryButton) {
                primaryButton.click();
                return "成功触发主按钮点击事件";
            }
            return "未找到合适的按钮元素";
        }).catch(err => `点击捕获发生异常: ${err.message}`);
        
        console.log(`按钮点击执行状态: ${clickStatus}`);
        
        // 核心改动：延长等待时间至 15 秒，确保异步接口把积分更新到网页DOM里
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
            await browser.disconnect();
        }
        await sendTelegram(messageResult);
        process.exit(0);
    }
})();
