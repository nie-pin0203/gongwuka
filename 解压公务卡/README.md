# 公务卡管家

原生 HTML、CSS、JavaScript 手机账本。首页、支出、报销、设置四栏导航，支持分次还款、月份筛选、JSON 备份恢复和 CSV 导入导出。

首次使用为空账本。账目只保存在当前浏览器的 localStorage。切换域名、浏览器或设备前，请在设置中导出 JSON，并在新设备手动恢复。

## GitHub Pages 发布

将本目录文件放在仓库 main 分支根目录。仓库 Settings → Pages → Deploy from a branch，选择 main 和 /(root)，保存并启用 Enforce HTTPS。index.html 应直接位于根目录。

资源、manifest、service worker 均使用相对路径，可在 /gongwuka/ 等仓库子目录下使用。

## 红米使用

Chrome 打开 HTTPS 地址，等待“离线缓存已就绪”，通过浏览器菜单添加到主屏幕或安装应用。HyperOS / MIUI 可能限制后台，本应用保存操作立即写入本地，无需后台任务。定期通过设置导出 JSON，并确认下载成功。

## 更新

更新应用资源时递增 sw.js 缓存版本。关闭所有应用窗口和网站标签后重新打开，以启用新版。localStorage 的 official-card-ledger-v1 存储键及数据格式保持兼容。

公开仓库只提交应用代码与图标。私人备份和发票请保存在个人设备。
