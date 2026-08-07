# 省柴柴·全平台商品比价助手

一只懂比价的柴犬。帮你逛遍各大主流购物平台，找到同款商品的最划算入手渠道。

## 功能

- **跨平台比价** — 一键搜遍多个购物平台，给出实时价格和购买入口
- **智能好物推荐** — 综合价格、店铺口碑、商品质量、个人偏好推荐
- **记你的偏好** — 越用越懂你

## 安装

1. 安装 [Node.js](https://nodejs.org/)
2. 将本目录作为 skill 加载到你的 agent 平台
3. 首次使用自动工作，无需配置密钥

## 用法示例

```bash
# 跨平台比价
node scripts/price.js --keyword 抽纸 --source all --limit 5

# 指定平台
node scripts/price.js --keyword iPhone 手机壳 --source jd

# 单品详情
node scripts/price.js --keyword 抽纸 --detail
```

## 隐私

本技能不收集任何个人信息。所有查询通过云端接口完成，返回结果仅含商品数据和购买入口，不存储用户偏好。