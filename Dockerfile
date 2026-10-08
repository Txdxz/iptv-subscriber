# 使用轻量级 Node.js Alpine 镜像
FROM node:20-alpine

# 安装 curl 与时区数据
RUN apk add --no-cache curl tzdata

# 设置系统时区为北京时间 (Asia/Shanghai)
ENV TZ=Asia/Shanghai
RUN cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# 拷贝代码与依赖文件
COPY package.json ./
COPY config.json ./
COPY src/ ./src/

# 创建持久化数据目录
RUN mkdir -p /app/data /app/data/history

# 暴露 M3U 订阅端口
EXPOSE 8088

# 启动守护进程 (含定时筛选与 HTTP 订阅服务)
CMD ["node", "src/scheduler.js"]
