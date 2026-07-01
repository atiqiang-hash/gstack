# 桌面版 — BETAŞ EPC Intelligence 面板

把这个文件夹放到桌面，就能在本机每天定时自动刷新面板（09:00 / 10:00 / 11:00 /
12:00 / 14:00，按你电脑的本地时间；如果你的电脑时区是土耳其，那就是土耳其时间）。

刷新做的事：拉取真实 RSS 头条、更新趋势历史、重算概览、刷新时间戳，重新生成
`index.html`。用浏览器打开 `index.html` 即可查阅。

## 前置：安装 Node.js（一次即可）

到 https://nodejs.org 下载安装 **Node 18 或更高版本**。安装后重启终端。
验证：终端里运行 `node --version`，能打印版本号即可。

## 立刻刷新一次（测试）

- **macOS / Linux**：终端里 `bash desktop/refresh.sh`
- **Windows**：双击 `desktop\refresh.cmd`

跑完后打开同目录的 `index.html`，实时流（📡）应已填充真实头条。

## 设置每天定时刷新

### macOS / Linux（用 cron）
```bash
bash desktop/install-macos-linux.sh      # 安装 5 个每日定时任务
bash desktop/uninstall-macos-linux.sh    # 需要时移除
```
查看：`crontab -l | grep betas-epc-dashboard`

### Windows（用任务计划程序）
在 PowerShell 里：
```powershell
powershell -ExecutionPolicy Bypass -File desktop\install-windows.ps1     # 安装
powershell -ExecutionPolicy Bypass -File desktop\uninstall-windows.ps1   # 移除
```
在「任务计划程序」里搜索 `BETAS-EPC-Dashboard` 可查看/管理。

## 说明

- **时区**：定时用的是你电脑的本地时间。你的电脑设成土耳其时间（UTC+3），
  这几个点就正好是 9/10/11/12/14 土耳其时间。若电脑在别的时区，改一下安装脚本里的
  小时数即可（macOS/Linux 是 `for H in 9 10 11 12 14`；Windows 是 `$times` 列表）。
- **电脑要开着**：定时任务只在电脑开机时触发。错过的那次不会补跑，等下一个点。
- **本地刷新更新什么**：实时 RSS 头条、趋势曲线、时间戳会每天更新；卡片里的
  “策划情报”（EPC 合同、招标表、YEKA 等）是人工维护的，更新它需要重新下载或用
  在线版（GitHub Pages，见项目根 README）。
- **完全离线也能看**：没网时 `index.html` 依然显示策划好的真实数据，只有实时流会空。
- **可选机器翻译 / 访问统计**：见项目根 `README.md` 的对应章节（本地也适用，
  例如 `TRANSLATE=google bash desktop/refresh.sh`）。

## 想要“零维护、始终最新”？

用在线版：把仓库合并到 `main` 后，在 GitHub 仓库 Settings → Pages →
Source 选 “GitHub Actions”。云端会在 09/10/11/12/14 土耳其时间自动刷新并发布，
手机电脑打开网址即可，无需本机 Node、无需电脑常开。
