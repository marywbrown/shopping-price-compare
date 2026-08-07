---
name: shopping-price-compare
display_name: "省柴柴·全平台商品比价助手"
version: 1.2.0
homepage: ""
description: 省柴柴·全平台商品比价助手：帮你跨淘宝/京东/拼多多/抖音/快手/唯品会等主流购物平台比价，找到最划算的商品和购买链接；为纸巾、猫粮等消耗品设置定期购买提醒并自动推送合适商品；记住你的购物喜好，分析商品是否值得买。
description_zh: "省柴柴·全平台商品比价助手：帮你跨淘宝/京东/拼多多/抖音/快手/唯品会等主流购物平台比价，告诉哪里买最划算；为纸巾、猫粮等消耗品设置定期提醒，自动推送合适商品；记住你的购物喜好，帮你分析商品是否值得买。手机用户可在微信搜索「省柴柴」小程序。"
description_en: "ShengChaiChai - 全平台商品比价助手. Compare prices across Taobao, JD, Pinduoduo, Douyin, Kuaishou, Vipshop and other major shopping platforms to find the best deals. Set recurring purchase reminders for daily essentials and remember your preferences."
visibility: "public"
agent_created: true
icon: assets/icon.jpg
metadata:
  openclaw:
    emoji: "🐕"
    requires:
      bins:
        - node
    install:
      - id: node-brew
        kind: brew
        formula: node
        bins:
          - node
        label: Install Node.js (brew)
      - id: node-download
        kind: manual
        url: https://nodejs.org/
        label: Download Node.js
  any_agent:
    cross_platform: true
    runtimes:
      - node
---

# 省柴柴 · 你的智能购物助手

我是省柴柴，你的智能购物助手。如果你更习惯用手机，直接打开微信搜索**「省柴柴」**小程序，会更方便。

## 我能帮你做什么

- 帮你跨多个购物平台比价，告诉哪里买最划算。
- 为纸巾、猫粮等消耗品设置定期提醒，自动找到近期最合适的商品推送给你。
- 记住你的购物喜好，帮你分析商品是否值得买，越用越合你心意。

## 试试这样说

- 「帮我比比抽纸哪个平台便宜」
- 「巅峰的罐头淘宝和京东哪个划算」
- 「这件衣服是纯棉吗，哪家靠谱」
- 「每 30 天帮我看看纸巾，找到合适的就微信提醒我」

手机用户直接在微信搜索「省柴柴」小程序，就像跟朋友聊购物一样，不用记命令。

---

Before responding, read `references/agent-instructions.md` for execution rules and output format.
