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
        
        // 新增：连不上时自动重试 5 次的机制，防止 Chrome 启动慢导致报错
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
                console.log(`⚠️ 连接稍微延迟，剩余重试次数: ${retries}。原因: ${connectErr.message}`);
                if (retries === 0) throw connectErr;
                await delay(3000); // 连不上就等 3 秒再连
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

        console.log('🖱️ 步骤 6: 尝试点击“立即签到”按钮...');
        await page.evaluate(() => document.querySelector('button.ant-btn-primary')?.click());
        
        // ==========================================
        // === 穿透 Shadow DOM 处理 Cloudflare 验证框 ===
        // ==========================================
        console.log('🕵️ 步骤 7: 开始检测 Cloudflare 验证框...');
        
        let cfBox = null;
        for (let i = 0; i < 6; i++) {
            await delay(3000); 
            
            cfBox = await page.evaluate(() => {
                let targetBox = null;
                
                function checkNode(node) {
                    if (!node) return false;
                    
                    if (node.tagName === 'IFRAME') {
                        const src = node.src || '';
                        const title = node.title || '';
                        if (src.includes('cloudflare') || src.includes('turnstile') || title.toLowerCase().includes('cloudflare')) {
                            const rect = node.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                targetBox = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
                                return true;
                            }
                        }
                    }
                    
                    if (node.shadowRoot) {
                        for (let child of node.shadowRoot.children) {
                            if (checkNode(child)) return true;
                        }
                    }
                    
                    for (let child of node.children) {
                        if (checkNode(child)) return true;
                    }
                    return false;
                }
                
                checkNode(document.body);
                return targetBox;
            });

            if (cfBox) {
                console.log(`🎯 成功定位到 CF 验证框! 坐标: X=${cfBox.x}, Y=${cfBox.y}`);
                break;
            } else {
                console.log(`🔍 第 ${i+1} 次扫描未找到验证框，继续等待...`);
            }
        }

        if (cfBox) {
            const clickX = cfBox.x + 30; 
            const clickY = cfBox.y + (cfBox.height / 2);
            
            console.log(`🖱️ 鼠标移动到复选框并点击: X=${clickX}, Y=${clickY}`);
            await page.mouse.move(clickX, clickY, { steps: 10 }); 
            await delay(500);
            await page.mouse.down();
            await delay(100);
            await page.mouse.up();
            
            console.log('✅ 点击验证框完成，等待 12 秒让 CF 验证通过...');
            await delay(12000);
        } else {
            console.log('⚠️ 未检测到验证框，直接判断页面结果。');
        }
        
        console.log('📸 记录最终页面状态截图...');
        await takeScreenshot(page, 'final_result');

        // ==========================================
        // === 严格验证是否真的签到成功 ===
        // ==========================================
        console.log('📊 步骤 8: 提取页面数据并验证结果...');
        const pageText = await page.evaluate(() => document.body.innerText);
        
        if (pageText.includes('今日还未签到')) {
            throw new Error('页面依然显示“今日还未签到”，可能人机验证未通过或遇到其他限制！');
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
