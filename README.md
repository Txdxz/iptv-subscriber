# Feed Dispatcher & Sync Tool

本项目是一套轻量、高效、低维护成本的个人日常数据流调度与同步工具。系统每天定时对候选数据源执行健康检查、权重匹配与存活复检，并原子更新对外提供固定的订阅数据通道。

客户端只需在首次订阅时填写一次固定地址，后续每日由后台自动重新调度更新，无需手动频繁更换订阅。

---

## 目录
- [一、核心特性与设计原则](#一核心特性与设计原则)
- [二、调度策略与权重规则](#二调度策略与权重规则)
- [三、部署方案指南](#三部署方案指南)
  - [方案 A：本地局域网 / 容器化部署（首选推荐）](#方案-a本地局域网--容器化部署首选推荐)
  - [方案 B：GitHub Actions 自动化调度分发（免服务器）](#方案-bgithub-actions-自动化调度分发免服务器)
  - [方案 C：云服务器部署](#方案-c云服务器部署)
- [四、配置项说明 (config.json)](#四配置项说明-configjson)
- [五、命令行操作与维护](#五命令行操作与维护)
- [六、测试与健康校验](#六测试与健康校验)

---

## 一、核心特性与设计原则

- **完整源替换**：只完整采用选出的单一最优源，绝不跨源混剪拼接数据。
- **沿用存活源**：优先复检上期选出的源，只要数据源依然保持存活有效，立即停止当日全量筛选并继续沿用，避免客户端频繁重载。
- **原子替换**：采用写入临时文件后 rename 机制，彻底杜绝网络中断产生的半写入或空文件。
- **全失败兜底**：若某天远程数据源临时不可用，系统自动保留历史有效版本，并通过 Webhook 发出告警。
- **进程文件锁**：防止定时任务和手动触发并发竞争。
- **历史快照与回滚**：保留最近多次更新的历史快照，支持一键 CLI 回滚。
- **纯标准库零外部依赖**：仅使用 Node.js 核心模块，轻量安全，启动迅速。

---

## 二、调度策略与权重规则

系统严格执行多级权重梯队，从高到低逐档匹配：
- **Tier 1 ~ Tier 9**：按网络类型与地域延迟定义的不同优先级策略组（可在 config.json 中灵活自定义）。

### 筛选短路与排序逻辑：
- **同档位排序**：更新时间降序 > 项目数降序 > 稳定标识升序。
- **高档优先**：一旦高优先级档位找到并验证通过有效源，立即停止后续低档位的所有网络请求与验证。

---

## 三、部署方案指南

### 方案 A：本地局域网 / 容器化部署（首选推荐）

#### 1. Docker Compose 部署
```bash
docker compose up -d --build
```
容器启动后，即可在局域网内直接访问服务提供的订阅地址。

#### 2. 直接运行（系统自带 Node.js 18+）
```bash
# 启动守护进程（含每日定时筛选 + HTTP订阅服务）
node src/scheduler.js
```
如果需要后台常驻，可以使用 pm2：
```bash
pm2 start src/scheduler.js --name "feed-sync"
```

---

### 方案 B：GitHub Actions 自动化调度分发（免服务器）

依托 GitHub Actions 免费算力与 GitHub Pages 静态托管：

1. 将本项目推送至 GitHub 仓库；
2. 进入仓库 **Settings -> Pages**，将 **Source** 选择为 **GitHub Actions**；
3. 进入仓库 **Settings -> Secrets and variables -> Actions**：
   - 添加 `QYWX_WEBHOOK_URL`（可选）：通知机器人地址；
   - 添加 `SUBSCRIBE_KEY`（推荐）：自定义一个私有访问密钥，作为生成文件的路径，防止未授权访问；
4. 工作流文件 `.github/workflows/update-iptv.yml` 已配置就绪：
   - 每天北京时间 17:00 (UTC 09:00) 自动触发运行筛选；
   - 也可以在 Actions 界面随时点击 **Run workflow** 手动触发；
   - 根路径已配置 404 防探测保护，只有携带私有密钥的客户端方可获取订阅。

---

### 方案 C：云服务器部署

1. 在服务器上运行 Docker 或 Node 进程（端口 8088）。
2. 可配合 Nginx 绑定域名并配置反向代理：
   ```nginx
   location /feed/ {
       proxy_pass http://127.0.0.1:8088/;
       proxy_set_header Host $host;
   }
   ```
3. 在 config.json 中配置 `"auth_token": "your_secret"`，访问时带上 Token 参数，防止地址被未授权探测扫出。

---

## 四、配置项说明 (config.json)

```json
{
  "site": {
    "base_url": "https://example.com",
    "request_timeout_ms": 15000,
    "user_agent": "Mozilla/5.0 ..."
  },
  "server": {
    "port": 8088,
    "host": "0.0.0.0",
    "m3u_route": "/feed/current.m3u",
    "status_route": "/feed/status",
    "auth_token": "",
    "cache_control": "no-cache, no-store, must-revalidate"
  },
  "schedule": {
    "daily_time": "17:00",
    "timezone": "Asia/Shanghai",
    "run_on_startup": true
  },
  "priorities": [
    // 权重规则配置，支持自由增减与调整
  ],
  "validation": {
    "enable_stream_probe": false,
    "probe_channels_count": 3,
    "probe_timeout_ms": 3000,
    "min_pass_channels": 1,
    "min_channels_threshold": 10
  },
  "notification": {
    "enabled": true,
    "webhook_url": "",
    "notify_on_first_success": true,
    "notify_on_source_change": true,
    "notify_on_all_failed": true,
    "notify_on_retained_same": false
  }
}
```

---

## 五、命令行操作与维护

```bash
# 1. 立即手动触发一轮筛选
node src/cli.js --run-now

# 2. 查看当前运行状态与当前源元数据
node src/cli.js --status

# 3. 列出所有可用的历史快照备份
node src/cli.js --list-history

# 4. 一键回滚到指定的历史版本
node src/cli.js --rollback <filename>

# 5. 执行全套自动化测试
npm test
```

---

## 六、测试与健康校验

执行 npm test，全部 12 项用例 100% 通过：
- 严格规则隔离校验
- 节点档位权重与多关键字匹配
- 状态过滤规则 (新上线/存活状态识别)
- 同档位多候选智能排序
- 格式校验与错误数据拦截
- 高优先级命中即停短路机制
- 高优先级失败按顺序降级
- 上期存活源优先沿用机制
- 全部失败保留旧版本不覆盖
- 冷启动首次失败明确记录
- 任务并发文件锁与写入保护
- 内置 HTTP 服务固定订阅与缓存策略
