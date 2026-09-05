#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vless2config.py — 把 VLESS_LINK 解析成 Xray config.json（增强版）

修复原 workflow 内联脚本的问题：
  1. 支持 reality 协议（realitySettings: publicKey/shortId/serverName/fingerprint/spiderX）
  2. 支持 flow=xtls-rprx-vision（写入 users[0].flow）
  3. 支持 grpc / httpupgrade / xhttp / h2 网络
  4. 支持 tls 的 alpn / fingerprint / allowInsecure
用法：VLESS_LINK="vless://..." python3 vless2config.py
"""
import os
import json
import re
import sys
from urllib.parse import urlparse, parse_qs


def parse_vless(link: str) -> dict:
    if not link.startswith("vless://"):
        raise ValueError("节点格式错误（必须以 vless:// 开头）")

    pattern = re.compile(r"vless://(.*?)@(.*?):(\d+)(.*)")
    match = pattern.match(link)
    if not match:
        raise ValueError("节点格式错误（无法解析 uuid@host:port）")
    uuid, address, port, rest = match.groups()
    remain = urlparse("http://localhost" + rest.split("#")[0])
    params = parse_qs(remain.query)

    def p(name, default=None):
        vals = params.get(name)
        return vals[0] if vals else default

    network = p("type", "tcp")
    security = p("security", "none")
    flow = p("flow", "")

    user = {"id": uuid, "encryption": "none", "level": 0}
    if flow:
        user["flow"] = flow  # xtls-rprx-vision 等

    outbound = {
        "protocol": "vless",
        "settings": {"vnext": [{
            "address": address, "port": int(port), "users": [user]
        }]},
        "streamSettings": {"network": network, "security": security}
    }
    ss = outbound["streamSettings"]

    # ---------- 网络层 ----------
    if network == "ws":
        ws = {"path": p("path", "/")}
        if p("host"):
            ws["headers"] = {"Host": p("host")}
        ss["wsSettings"] = ws
    elif network == "grpc":
        grpc = {"serviceName": p("path", "")}
        if p("host"):
            grpc["authority"] = p("host")
        ss["grpcSettings"] = grpc
    elif network == "httpupgrade":
        hu = {"path": p("path", "/")}
        if p("host"):
            hu["headers"] = {"Host": p("host")}
        ss["httpupgradeSettings"] = hu
    elif network == "xhttp":
        xh = {"path": p("path", "/")}
        if p("host"):
            xh["headers"] = {"Host": p("host")}
        ss["xhttpSettings"] = xh
    elif network == "h2":
        ss["httpSettings"] = {"path": p("path", "/"), "host": [p("host", address)]}

    # ---------- 安全层 ----------
    if security == "tls":
        tls = {"serverName": p("sni", p("host", address))}
        if p("alpn"):
            tls["alpn"] = [x.strip() for x in p("alpn").split(",") if x.strip()]
        if p("fp"):
            tls["fingerprint"] = p("fp")
        if p("allowInsecure", "").lower() in ("1", "true", "yes"):
            tls["allowInsecure"] = True
        ss["tlsSettings"] = tls
    elif security == "reality":
        ss["realitySettings"] = {
            "serverName": p("sni", address),
            "fingerprint": p("fp", "chrome"),
            "publicKey": p("pbk", ""),
            "shortId": p("sid", ""),
            "spiderX": p("spx", "/"),
        }

    return outbound


def main():
    link = os.environ.get("VLESS_LINK", "").strip()
    if not link:
        print("❌ 环境变量 VLESS_LINK 为空", file=sys.stderr)
        sys.exit(1)

    outbound = parse_vless(link)

    config = {
        "log": {"loglevel": "warning"},
        "inbounds": [{
            "port": 10080,
            "protocol": "socks",
            "settings": {"auth": "noauth", "udp": True},
            "listen": "127.0.0.1"
        }],
        "outbounds": [outbound]
    }
    with open("config.json", "w") as f:
        json.dump(config, f, indent=4)

    # 打印摘要（UUID 打码，避免日志泄露）
    u = outbound["settings"]["vnext"][0]["users"][0]["id"]
    masked = u[:6] + "****" if len(u) > 6 else "****"
    ss = outbound["streamSettings"]
    print(f"✅ Xray 配置生成成功")
    print(f"   地址: {outbound['settings']['vnext'][0]['address']}:{outbound['settings']['vnext'][0]['port']}")
    print(f"   UUID: {masked}  网络: {ss.get('network')}  安全: {ss.get('security')}")
    if ss.get("security") == "reality":
        rs = ss["realitySettings"]
        print(f"   Reality: serverName={rs['serverName']} fingerprint={rs['fingerprint']} "
              f"publicKey={'****' if rs['publicKey'] else '(空!)'} shortId={rs['shortId'] or '(空!)'}")
    if "flow" in outbound["settings"]["vnext"][0]["users"][0]:
        print(f"   Flow: {outbound['settings']['vnext'][0]['users'][0]['flow']}")


if __name__ == "__main__":
    main()
