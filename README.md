# ulzixidc-Run

VLESS_LINK	你的 vless://...

USER_EMAIL	你的登录邮箱

USER_PASSWORD	你的登录密码

TG_BOT_TOKEN

TG_CHAT_ID


-引入 puppeteer-real-browser 插件。这是目前在 GitHub 绕过Cloudflare Turnstile 的开源方案。     
它是如何起作用的：     
-隐藏自动化特征：它会底层修改并擦除所有 Puppeteer 相关的特征，模拟完美的真实人类浏览器指纹（包括 TLS 握手和 HTTP/2 设置）。     
-虚拟显示屏模式（Xvfb）：xvfb 虚拟帧缓冲服务启动一个“伪有头”浏览器，骗过Cloudflare 并完美渲染出Turnstile 验证框。      
-后台自动过检：它内置了全自动对准并点击 Cloudflare 验证框的逻辑，只需数秒即可完成勾选。       
-化繁为简：puppeteer-real-browser 会自动接管和管理其生命周期。    
