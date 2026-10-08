# IPTV 源每日自动筛选 + 固定 M3U 订阅服务

本项目针对目标网站 `https://iptv.cqshushu.com/index.php`，实现一套轻量、稳定、低维护成本的自动化服务。专为山西家庭用户设计，每天自动按特定优先级挑选最佳 IPTV 源，原子更新并对外提供始终不变的固定 M3U 订阅地址。

电视端只需在首次订阅时填写一次固定地址，后续每日由后台自动重新筛选更新，无需手动频繁更换订阅。

---

## 📺 订阅地址

- **GitHub Pages 订阅地址**：
  `https://Txdxz.github.io/iptv-subscriber/current.m3u`
- **当前状态接口**：
  `https://Txdxz.github.io/iptv-subscriber/status.json`

---

## 🚀 部署与使用

- 每天北京时间 17:00 (UTC 09:00) 自动执行并发布到 GitHub Pages；
- 可在 Actions 页面随时手动点击 **Run workflow** 触发更新；
- 详见项目代码与完整配置。
