# 文字足迹网页上线步骤

这个项目是一个极简私密网页：

- 只有知道管理员密码的人能登录查看。
- 可以上传文字，也可以上传图片版文字并识别成文字。
- 上传时必须填写撰写时间。
- 系统会自动提取关键词。
- 首页上方显示全部内容汇总出的 word cloud。
- 下方按撰写时间展示全部足迹。
- 不同设备或不同 IP 登录后，内容会实时同步更新。

## 本地预览

在这个文件夹打开终端，运行：

```bash
ADMIN_PASSWORD=你的管理员密码 npm start
```

然后打开：

```text
http://localhost:3000
```

如果想换端口：

```bash
PORT=4000 ADMIN_PASSWORD=你的管理员密码 npm start
```

## 最简单上线方式：Render

### 1. 放到 GitHub

1. 新建一个 GitHub 仓库。
2. 把这个文件夹里的全部文件上传到仓库。

### 2. 在 Render 创建网页服务

1. 打开 Render。
2. 选择 New。
3. 选择 Web Service。
4. 连接刚才的 GitHub 仓库。
5. 设置：

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

### 3. 设置管理员密码

在 Render 的 Environment Variables 添加：

```text
ADMIN_PASSWORD=你自己的强密码
NODE_ENV=production
```

### 4. 设置数据保存位置

为了让上传内容和图片在重启后不丢失，需要添加一个 Disk：

```text
Mount Path: /var/data
Size: 1 GB
```

再添加一个 Environment Variable：

```text
DATA_DIR=/var/data
```

### 5. Deploy

点击 Deploy。部署完成后，Render 会给你一个网址。

打开这个网址，输入管理员密码，就可以使用。

## 使用提醒

- 管理员密码不要写进代码，只在 Render 的 Environment Variables 里设置。
- 如果没有设置 Disk，内容可能会在服务重启或重新部署后丢失。
- 图片文字识别在浏览器里完成，第一次加载 OCR 组件可能会慢一点。
