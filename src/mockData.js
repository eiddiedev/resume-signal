export const sampleJobDescription =
  "我们正在招聘一名 Python 后端工程师，负责阿里云 Serverless 函数计算服务、RESTful API、PDF 文本解析、AI 模型调用与 Redis 缓存。希望候选人具备 3 年以上后端经验，熟悉工程化交付、错误处理和线上部署。";

export const mockResumeResult = {
  resumeId: "mock-resume-20260424",
  candidate: {
    name: "林澈",
    phone: "138-0000-2468",
    email: "linche@example.com",
    address: "上海市杨浦区",
  },
  intent: {
    role: "Python 后端工程师",
    salary: "25K-35K",
  },
  background: {
    years: "4 年",
    education: "本科 · 软件工程",
    projects: [
      {
        name: "Fut.Map - 全球足球数据地图可视化",
        url: "https://fm.eiddie.top",
        description:
          "独立开发 | Next.js / Three.js / Mapbox GL / Framer Motion。面向足球内容场景，独立完成视觉方案、交互逻辑与前端实现，打造沉浸式数据浏览体验。",
      },
      {
        name: "Resume Signal API",
        url: "",
        description: "搭建 Serverless 简历解析服务，支持 PDF 多页文本抽取、DeepSeek 信息抽取与 Redis 缓存。",
      },
    ],
  },
  sections: [
    {
      title: "文本解析",
      body: "PDF 内容已按段落清洗，移除重复空白、页眉页脚与不可见字符。",
    },
    {
      title: "信息抽取",
      body: "模型识别出联系方式、求职意向、学历、项目经历与工作年限。",
    },
    {
      title: "岗位匹配",
      body: "技能关键词与 Serverless、Python、缓存、RESTful API 高度重合。",
    },
  ],
  score: {
    overall: 86,
    skills: 91,
    experience: 82,
    education: 78,
    aiConfidence: 88,
  },
  matchedKeywords: [
    "Python",
    "Serverless",
    "RESTful API",
    "PDF 解析",
    "Redis",
    "AI 模型",
    "错误处理",
  ],
  missingKeywords: ["阿里云 FC 生产部署", "CI/CD"],
  cacheHit: true,
  summary:
    "候选人与岗位要求匹配度较高，后端工程经验、AI 调用链路和缓存设计均覆盖题目核心要求，建议进入技术面。",
};

export function buildMockResult(fileName, jobDescription) {
  const hasServerless = /serverless|函数计算|fc/i.test(jobDescription);
  const hasRedis = /redis|缓存/i.test(jobDescription);
  const hasAi = /ai|模型|大模型|llm/i.test(jobDescription);
  const overall = 78 + (hasServerless ? 4 : 0) + (hasRedis ? 2 : 0) + (hasAi ? 2 : 0);

  return {
    ...mockResumeResult,
    resumeId: `mock-${Date.now()}`,
    sourceFile: fileName,
    score: {
      ...mockResumeResult.score,
      overall: Math.min(overall, 92),
      skills: hasServerless ? 91 : 84,
    },
    cacheHit: Math.random() > 0.45,
  };
}
