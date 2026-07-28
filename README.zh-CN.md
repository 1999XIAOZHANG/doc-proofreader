# 文档标准化智能校对系统

[English](./README.md) | **简体中文**

基于 LangChain + LLM 的 Word 文档智能校对工具，自动识别文档领域并逐段给出校对建议。

上传 `.docx` 文档后，系统会先识别文档所属领域，再以该领域专家的身份逐段检查拼写、语法、用词和表达问题，并在右侧原生 Word 预览中定位到对应段落，供你参考。

![应用界面截图](test_doc/3.png)

## 项目结构

```
文件解析修改/
├── backend/                 # 后端服务
│   ├── main.py             # FastAPI 入口
│   ├── schemas.py          # 数据模型
│   ├── document_store.py   # 文档存储管理
│   ├── llm_checker.py      # LLM 校对器
│   ├── requirements.txt    # Python 依赖
│   ├── .env.example        # 环境配置示例
│   └── uploads/            # 上传文件目录
└── frontend/               # 前端应用
    ├── src/
    │   ├── App.tsx        # 主组件
    │   ├── api.ts         # API 封装
    │   ├── types.ts       # TypeScript 类型
    │   └── components/    # 组件
    ├── package.json       # Node 依赖
    └── vite.config.ts     # Vite 配置
```

## 快速开始

### 1. 配置环境

复制 `backend/.env.example` 为 `backend/.env`，填入你的 API 密钥：

```env
# 方案一：OpenRouter（推荐，有免费模型）
OPENAI_API_KEY=your_openrouter_api_key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=
```
> 🔓 **OpenRouter 免费模型推荐**：
> - 更多免费模型请查看: https://openrouter.ai/models

### 2. 启动后端服务

```bash
cd backend
pip install -r requirements.txt
python main.py
```

后端服务将在 `http://localhost:6545` 启动，API 文档见 `http://localhost:6545/docs`。

> 🌐 **网络代理说明**：如果你的 API 服务（如 OpenRouter/OpenAI）需要科学上网，请直接在 `backend/.env` 中配置代理，后端启动时会自动读取：
>
> ```env
> HTTP_PROXY=http://127.0.0.1:7890
> HTTPS_PROXY=http://127.0.0.1:7890
> ```
>
> 将 `7890` 替换为你本地代理的实际端口。不需要代理时留空即可（默认直连）。若无法连接 LLM，分析会直接返回「LLM 调用失败」的错误提示。

### 3. 启动前端服务

```bash
cd frontend
npm install
npm run dev
```

前端服务将在 `http://localhost:3000` 启动（若端口被占用，Vite 会自动切换到 3001/3002）。

## 功能特性

### 1. 文档上传与分析
- 支持 .docx 格式 Word 文档
- 自动提取文档段落
- 自动识别文档领域
- 实时展示分析进度（已分析段落数 / 总数）

### 2. 校对建议
- 左侧流式展示校对建议列表
- 显示原词、建议修改和中文理由
- 点击建议卡片可在右侧原生 Word 预览中定位并高亮对应段落（仅供参考）

### 3. 原生文档预览
- 右侧使用 docx-preview 原样渲染 Word 文档

## 使用流程

1. **上传文档**: 点击"上传Word文档"按钮，选择 .docx 文件
2. **查看校对**: 系统自动分析并在左侧列出校对建议
3. **定位原文**: 点击某条建议卡片，右侧文档预览会跳转并高亮对应段落（仅供参考）

![演示动画](test_doc/1.gif)

![演示动画](test_doc/2.gif)

## LLM 校对说明

校对分两步进行：

1. **领域识别**：先根据文档正文自动判断文档所属领域（如结晶工艺、制药、化工等）。
2. **逐段校对**：以该领域专家的身份逐段检查拼写、语法、用词和表达问题，并给出中文修改理由。

## 开发说明

### 调整 LLM Prompt

在 `backend/llm_checker.py` 中修改 `domain_prompt`（领域识别）或 `proofread_prompt`（逐段校对）。

## 常见问题

**Q: 支持其他格式的文档吗？**
A: 目前仅支持 .docx 格式，如需支持 .doc 需先转换格式。

**Q: 如何更换其他 LLM 模型？**
A: 修改 `.env` 文件中的 `OPENAI_BASE_URL` 和 `LLM_MODEL` 即可。

**Q: 为什么分析时提示「LLM 调用失败」？**
A: 通常是后端无法连接到 LLM 服务导致的。请检查 API 密钥是否正确，以及是否按上文配置了网络代理。
