# 安装:把「周登 情报官」装进你的 AI Agent

这是一个 Claude Skill。装好后,你只要对周登说「**来份今日情报**」「**土耳其能源早报**」,
它就自动抓最新新闻、生成三语 HTML 情报面板发给你。

## 前置
- **Node 18+**(生成器要用):https://nodejs.org 下 LTS 版装一次。
- 一个能跑 Claude Code / Claude 技能的环境(你现有的周登 Agent 即可)。

## 安装(Mac / Linux)
把整个 `zhoudeng-epc-intel` 文件夹放进你的技能目录:

```bash
# 解压后,把文件夹拷到 ~/.claude/skills/
mkdir -p ~/.claude/skills
cp -R zhoudeng-epc-intel ~/.claude/skills/

# 确认在位:
ls ~/.claude/skills/zhoudeng-epc-intel
# 应看到 SKILL.md  generate.mjs  feeds.json  data/
```

Windows:把 `zhoudeng-epc-intel` 文件夹拷到 `%USERPROFILE%\.claude\skills\` 下即可。

## 用法
装好后,在周登对话里直接说:
- 「周登,来份今日情报」/「今日土耳其能源早报」/「刷新 EPC 情报面板」
- 「generate today's Turkey energy brief」

周登会:①联网搜最新真实新闻 → ②更新 `data/news.json`(三语)→ ③运行 `node generate.mjs`
生成 HTML → ④把文件发给你。想直接落到桌面,它会用:
```bash
OUT="$HOME/Desktop/土耳其EPC情报_$(date +%Y%m%d).html" node generate.mjs
```

## 手动跑一次(不经 Agent 也能用)
```bash
cd ~/.claude/skills/zhoudeng-epc-intel
OUT="$HOME/Desktop/土耳其EPC情报.html" node generate.mjs
open "$HOME/Desktop/土耳其EPC情报.html"
```

## 说明
- 情报面板三语(🇹🇷TR/🇬🇧EN/🇨🇳中文)、可打印/PDF、离线可看、顶部署名「🛰 周登 · AI 情报官」。
- 数据真实、每条带来源链接;`data/news.json` 是唯一真相源,想手改内容改它再重跑生成器。
- 联网时自动抓 16 个真实 RSS 源的实时头条(带国旗+分类标签);无网时只显示策划数据。
- 可选:机器翻译实时头条(`TRANSLATE=google`)、隐私友好访问统计(改 `data/news.json` 的 `meta.analytics`),默认都关。
