# 对照翻译网页

一个基于 `Vue 3 + Node/Express` 的本地文档对照翻译工具，支持上传 `pdf / doc / docx / txt`，自动提取英文内容并生成中英双栏句子对照。

## 功能

- 本地文件上传与读取
- 支持 `PDF`、`Word(.doc/.docx)`、`TXT`
- 左侧显示原文分句
- 左侧显示英文原句
- 右侧显示对应中文译句
- 鼠标悬停任一侧句子时，另一侧对应句同步高亮
- 去掉逐词展示，页面更适合阅读和校对

## 运行方式

### 1. 启动后端

```powershell
npm install
npm run dev
```

默认端口：`3001`

### 2. 启动前端

```powershell
npm install
npm run dev
```

默认地址：`http://localhost:5173`

## 说明

- 前端默认请求 `http://localhost:3001`
- 如需修改后端地址，可在前端启动前设置 `VITE_API_BASE`
- 翻译优先使用 `MyMemory` 在线接口，按多句分批翻译后再拆回句子，整体会比逐词或完全单句翻译更自然
- 当前页面固定为“英文原文 -> 中文译文”的对照模式
