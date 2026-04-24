# Resume Signal | AI 赋能的智能简历分析系统

一个用于招聘场景的智能简历分析系统。系统支持上传单个 PDF 简历，自动解析多页 PDF 文本，调用 DeepSeek 抽取候选人关键信息，并根据岗位需求进行关键词分析、匹配评分和结构化 JSON 返回。前端提供极简可用的交互页面，后端可部署到阿里云函数计算等 Serverless 环境。

## 功能完成度

- 已实现：单个 PDF 上传接口、PDF 多页文本解析、文本清洗、DeepSeek 结构化抽取。
- 已实现：姓名、电话、邮箱、地址等基本信息抽取。
- 已实现：求职意向、期望薪资、到岗时间、学历背景、技能栈、项目经历、其他经历抽取。
- 已实现：岗位 JD 关键词提取、命中/缺口关键词分析、综合匹配度、技能/经验/学历/AI 置信度评分。
- 已实现：结构化 JSON 返回、内存缓存、可选 Redis 缓存。
- 已实现：React 前端页面、GitHub Pages 静态部署配置。
- 已实现：FastAPI 后端 Dockerfile，可用于阿里云函数计算自定义容器部署。
- 未内置：扫描件 OCR。如果 PDF 是纯图片，需要额外接入 OCR 服务。

## 技术栈

- React 19 + Vite
- 原生 CSS 变量与响应式布局
- GitHub Pages 静态部署
- `VITE_API_BASE_URL` 可选接入真实后端
- Python FastAPI 后端
- DeepSeek Chat Completions API
- PDF 解析：pypdf
- 缓存：内存缓存，生产可配置 Redis
- Serverless：FastAPI ASGI + Dockerfile，可部署到阿里云函数计算自定义容器

## 本地运行

前端：

```bash
npm install
npm run dev
```

后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

在 `backend/.env` 中填入：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

启动后端：

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

检查后端和 DeepSeek 配置：

```bash
curl http://127.0.0.1:8000/api/health
```

如果真实简历分析失败，可先检查 PDF 是否能提取文字：

```bash
curl -X POST http://127.0.0.1:8000/api/debug/extract-text -F file=@你的简历.pdf
```

如果返回 `未能从 PDF 中提取到可分析文本`，说明该 PDF 很可能是扫描件或图片型 PDF，需要增加 OCR 能力后才能解析。

前端 `.env` 配置：

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## 构建

```bash
npm run build
npm run preview
```

## 后端接口约定

不配置后端时，页面会自动使用本地 mock 数据，保证线上演示可完整走通。接入真实后端时，在前端 `.env` 中配置：

```bash
VITE_API_BASE_URL=https://your-api-domain.com
```

前端会调用：

```http
POST /api/resumes
Content-Type: multipart/form-data

file=<PDF>
```

```http
POST /api/resumes/:resumeId/match
Content-Type: application/json

{
  "jobDescription": "岗位需求描述"
}
```

推荐返回结构：

```json
{
  "resumeId": "resume-001",
  "candidate": {
    "name": "候选人姓名",
    "phone": "138-0000-0000",
    "email": "candidate@example.com",
    "address": "上海"
  },
  "intent": {
    "role": "Python 后端工程师",
    "salary": "25K-35K",
    "availability": "两周内到岗"
  },
  "background": {
    "years": "4 年",
    "education": {
      "school": "湖南工业大学",
      "major": "人工智能",
      "degree": "本科",
      "period": "2024.09 - 2028.06",
      "courses": ["机器学习", "数据结构与算法"]
    },
    "skills": ["React", "Next.js", "TypeScript"],
    "projects": [
      {
        "name": "Fut.Map - 全球足球数据地图可视化",
        "url": "https://fm.eiddie.top",
        "role": "独立开发",
        "techStack": "Next.js / Three.js / Mapbox GL / Framer Motion",
        "description": "独立开发 | Next.js / Three.js / Mapbox GL / Framer Motion。面向足球内容场景，独立完成视觉方案、交互逻辑与前端实现，打造沉浸式数据浏览体验。"
      }
    ],
    "experiences": [
      {
        "title": "Trae on Campus 校园大使",
        "organization": "字节跳动",
        "period": "",
        "description": "负责 Trae IDE 校园推广与开发者社区运营。"
      }
    ],
    "highlights": ["独立/协助开发 GitHub 项目 10+"]
  },
  "sections": [
    {
      "title": "文本解析",
      "body": "PDF 内容已完成清洗和结构化处理。"
    }
  ],
  "score": {
    "overall": 86,
    "skills": 91,
    "experience": 82,
    "education": 78,
    "aiConfidence": 88
  },
  "jobKeywords": ["Python", "Serverless", "Redis"],
  "matchedKeywords": ["Python", "Serverless", "Redis"],
  "missingKeywords": ["CI/CD"],
  "cacheHit": true,
  "summary": "候选人与岗位要求匹配度较高，建议进入技术面。"
}
```

## GitHub Pages 部署

项目已设置 `vite.config.js` 的 `base: "./"`，适合部署到 GitHub Pages。

默认部署到 GitHub Pages 时不注入后端地址，页面会使用前端演示数据，确保评审可以打开页面完成基本交互。真实后端部署完成后，可在构建环境中设置公开的 `VITE_API_BASE_URL`。

```bash
npm run deploy
```

部署前需要将仓库推送到 GitHub，并确保 `gh-pages` 分支作为 Pages 来源。

预期线上演示地址：

```text
https://eiddiedev.github.io/resume-signal/
```

## 阿里云 Serverless 部署说明

后端位于 `backend/`，是标准 FastAPI ASGI 应用。推荐部署到阿里云函数计算自定义容器：

- 容器构建文件：`backend/Dockerfile`
- 容器启动命令：`uvicorn app:app --host 0.0.0.0 --port 9000`
- 环境变量：`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`ALLOWED_ORIGINS`
- 如需跨实例缓存，配置 `REDIS_URL`
- 前端部署后，将 `VITE_API_BASE_URL` 指向函数计算 HTTP 触发器公网地址

本地验证容器：

```bash
cd backend
docker build -t resume-signal-api .
docker run --rm -p 9000:9000 --env-file .env resume-signal-api
```
