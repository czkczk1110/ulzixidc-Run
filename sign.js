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

        // ==========================================
        // === 强力清除遮挡物 ===
        // ==========================================
        console.log('🧹 暴力移除 Cookie 提示等遮挡物...');
        await page.evaluate(() => {
            // 直接遍历所有元素，遇到包含 cookie 提示的直接删掉，而不是去点关闭按钮
            const allDivs = document.querySelectorAll('div');
            for (let div of allDivs) {
                if (div.innerText && div.innerText.includes('本网站使用 cookies 技术')) {
                    div.remove();
                }
            }
        });
        await delay(1000);

        console.log('🖱️ 步骤 6: 点击“立即签到”按钮...');
        await page.evaluate(() => {
            const btn = document.querySelector('button.ant-btn-primary') || document.querySelector('button');
            if (btn) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' }); // 先滚动到居中位置
                btn.click();
            }
        });
        
        console.log('🕵️ 步骤 7: 使用浏览器内核级 API 抓取 Cloudflare 验证框...');
        
        let cfBox = null;
        // 给它 15 秒钟的时间弹出，每 1.5 秒扫描一次所有底层的 frame
        for (let i = 0; i < 10; i++) {
            await delay(1500);
            
            // 获取浏览器当前所有的 frame (无视跨域和 Shadow DOM)
            const frames = page.frames();
            for (const frame of frames) {
                const url = frame.url();
                // 如果 frame 的 URL 包含 cloudflare 挑战相关字眼
                if (url.includes('cloudflare') || url.includes('turnstile')) {
                    try {
                        const frameEl = await frame.frameElement();
                        if (frameEl) {
                            const box = await frameEl.boundingBox();
                            // 确保它确实在屏幕上渲染出来了，有宽度和高度
                            if (box && box.width > 10 && box.height > 10) {
                                cfBox = box;
                                console.log(`🎯 第 ${i+1} 次扫描，底层 API 成功捕获验证框! 坐标 X=${cfBox.x}, Y=${cfBox.y}`);
                                break;
                            }
                        }
                    } catch (e) {
                        // 忽略权限报错
                    }
                }
            }
            if (cfBox) break; // 找到了就跳出大循环
        }

        if (cfBox) {
            // 精确计算：X轴为框体左侧往右偏移 30 像素，Y轴为垂直居中
            const clickX = cfBox.x + 30;
            const clickY = cfBox.y + (cfBox.height / 2);
            
            console.log(`🖱️ 鼠标精准移动到相对位置并点击: X=${clickX}, Y=${clickY}`);
            await page.mouse.move(clickX, clickY, { steps: 15 }); 
            await delay(500);
            
            await page.mouse.down();
            await delay(100);
            await page.mouse.up();
            
            console.log('✅ 点击完成，给系统 15 秒缓冲进行人机验证...');
            await delay(15000);
        } else {
            console.log('⚠️ 15秒内未捕获到验证框，可能是未触发人机验证。');
        }
        
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
