# 省省 · 商品比价 · 用户偏好与自我学习

> 让助手能"记住"用户偏好、并"学习"改进。两个本地文件，由助手在对话中读写。

## 文件位置

- `user_prefs.json` — 用户偏好（长期）
- `learning_log.json` — 学习记录（追加，不覆盖）

## user_prefs.json 结构

```json
{
  "excludedPlatforms": ["pdd"],
  "categoryPrefs": {
    "clothing": ["纯棉"],
    "sanitary": [],
    "digital": [],
    "food": [],
    "unknown": []
  },
  "globalPrefs": ["看重销量"]
}
```

## 写入方式

调用 `remember.js` 脚本：
- 记品类偏好：`node remember.js --category clothing --value "纯棉"`
- 记跨品类：`node remember.js --global "看重销量"`
- 排除平台：`node remember.js --exclude-platform pdd`
- 记常用设备：`node remember.js --device mobile` 或 `--device desktop`

## 读取时机

**每次检索前**读 `user_prefs.json`：
- 把 `excludedPlatforms` 从检索中排除
- 把 `categoryPrefs` 与 `globalPrefs` 作为筛选/表述依据

## 写入时机

- 用户表达偏好（"要纯棉""数码只要正品"）→ 调用 `remember.js` 落盘，回复："好嘞，我记下了～"
- 用户明显不满意 → 记 `negative`，并回复："明白，我会按这个调整。"
- 用户需求没打中 → 记 `miss`。

## 目标

持续把比价做得更好。
