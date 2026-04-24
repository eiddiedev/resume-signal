import { buildMockResult } from "./mockData";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
const MOCK_LATENCY = 780;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(readableError(message) || `Request failed with ${response.status}`);
  }
  return response.json();
}

function readableError(message) {
  if (!message) return "";
  try {
    const parsed = JSON.parse(message);
    return parsed.detail || parsed.message || message;
  } catch {
    return message;
  }
}

function withConnectionHint(error) {
  if (error instanceof TypeError) {
    return new Error("无法连接后端。请确认 FastAPI 已在 http://localhost:8000 启动，并重启前端 dev server。");
  }
  return error;
}

async function mockAnalyze(file, jobDescription, reason = "未配置后端，已切换演示数据") {
  await delay(MOCK_LATENCY);
  return {
    mode: "mock",
    notice: reason,
    data: buildMockResult(file.name, jobDescription),
  };
}

export async function analyzeResume(file, jobDescription) {
  if (!API_BASE_URL) {
    return mockAnalyze(file, jobDescription);
  }

  const form = new FormData();
  form.append("file", file);

  let uploaded;
  try {
    uploaded = await requestJson(`${API_BASE_URL}/api/resumes`, {
      method: "POST",
      body: form,
    });
  } catch (error) {
    throw withConnectionHint(error);
  }

  const resumeId = uploaded.resumeId ?? uploaded.id;
  if (!resumeId) {
    throw new Error("后端上传接口缺少 resumeId，无法继续匹配。");
  }

  let matched;
  try {
    matched = await requestJson(`${API_BASE_URL}/api/resumes/${resumeId}/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobDescription }),
    });
  } catch (error) {
    throw withConnectionHint(error);
  }

  return {
    mode: "api",
    notice: `已连接真实后端：${API_BASE_URL}`,
    data: normalizeResult({ ...uploaded, ...matched, resumeId }),
  };
}

function normalizeResult(raw) {
  const candidate = asObject(raw.candidate ?? raw.basicInfo);
  const intent = asObject(raw.intent ?? raw.jobIntent);
  const background = asObject(raw.background);
  const score = asObject(raw.score ?? raw.matchScore);

  return {
    resumeId: asText(raw.resumeId),
    sourceFile: asText(raw.sourceFile),
    parseMode: asText(raw.parseMode),
    matchMode: asText(raw.matchMode),
    candidate: {
      name: asText(candidate.name),
      phone: asText(candidate.phone),
      email: asText(candidate.email),
      address: asText(candidate.address),
      website: normalizeUrl(candidate.website || candidate.portfolio),
      github: normalizeUrl(candidate.github),
    },
    intent: {
      role: asText(intent.role),
      salary: asText(intent.salary),
      availability: asText(intent.availability),
    },
    background: {
      years: asText(background.years),
      education: normalizeEducation(background.education),
      skills: asTextList(background.skills),
      projects: normalizeProjects(background.projects),
      experiences: normalizeExperiences(background.experiences || background.otherExperiences),
      highlights: asTextList(background.highlights),
    },
    sections: normalizeSections(raw.sections ?? raw.parsedSections),
    score: {
      overall: asScore(score.overall),
      skills: asScore(score.skills),
      experience: asScore(score.experience),
      education: asScore(score.education),
      aiConfidence: asScore(score.aiConfidence),
    },
    jobKeywords: asTextList(raw.jobKeywords ?? raw.keywords?.job),
    matchedKeywords: asTextList(raw.matchedKeywords ?? raw.keywords?.matched),
    missingKeywords: asTextList(raw.missingKeywords ?? raw.keywords?.missing),
    cacheHit: Boolean(raw.cacheHit),
    summary: asText(raw.summary ?? raw.analysis),
  };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function asTextList(value) {
  if (Array.isArray(value)) {
    return value.map(asText).map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,，;；、|]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(asTextList);
  }

  return [];
}

function normalizeSections(value) {
  if (Array.isArray(value)) {
    return value
      .map((section, index) => {
        if (typeof section === "string") {
          return { title: `解析片段 ${index + 1}`, body: section };
        }
        const objectSection = asObject(section);
        return {
          title: asText(objectSection.title || objectSection.name || `解析片段 ${index + 1}`),
          body: asText(objectSection.body || objectSection.content || objectSection.text),
        };
      })
      .filter((section) => section.title || section.body);
  }

  if (typeof value === "string") {
    return [{ title: "解析摘要", body: value }];
  }

  if (value && typeof value === "object") {
    return Object.entries(value).map(([title, body]) => ({
      title,
      body: asText(body),
    }));
  }

  return [];
}

function normalizeProjects(value) {
  if (Array.isArray(value)) {
    return value
      .map((project, index) => normalizeProject(project, index))
      .filter((project) => project.name || project.description || project.url);
  }

  if (typeof value === "string") {
    return asTextList(value).map((description, index) => ({
      name: `项目经历 ${index + 1}`,
      url: "",
      description,
    }));
  }

  if (value && typeof value === "object") {
    return [normalizeProject(value, 0)].filter(
      (project) => project.name || project.description || project.url,
    );
  }

  return [];
}

function normalizeEducation(value) {
  if (typeof value === "string") {
    return {
      school: "",
      major: "",
      degree: "",
      period: "",
      courses: [],
      summary: value,
    };
  }

  const education = asObject(value);
  return {
    school: asText(education.school || education.university),
    major: asText(education.major),
    degree: asText(education.degree),
    period: asText(education.period || education.time),
    courses: asTextList(education.courses),
    summary: asText(education.summary),
  };
}

function normalizeExperiences(value) {
  if (Array.isArray(value)) {
    return value
      .map((experience, index) => normalizeExperience(experience, index))
      .filter((experience) => experience.title || experience.description);
  }

  if (typeof value === "string") {
    return [{ title: "其他经历", organization: "", period: "", description: value }];
  }

  if (value && typeof value === "object") {
    return [normalizeExperience(value, 0)];
  }

  return [];
}

function normalizeExperience(experience, index) {
  if (typeof experience === "string") {
    return {
      title: `经历 ${index + 1}`,
      organization: "",
      period: "",
      description: experience,
    };
  }

  const objectExperience = asObject(experience);
  return {
    title: asText(objectExperience.title || objectExperience.name || `经历 ${index + 1}`),
    organization: asText(objectExperience.organization || objectExperience.company || objectExperience.team),
    period: asText(objectExperience.period || objectExperience.time),
    description: asText(objectExperience.description || objectExperience.body || objectExperience.content),
  };
}

function normalizeProject(project, index) {
  if (typeof project === "string") {
    return {
      name: `项目经历 ${index + 1}`,
      url: "",
      role: "",
      techStack: "",
      description: project,
    };
  }

  const objectProject = asObject(project);
  return {
    name: asText(objectProject.name || objectProject.title || `项目经历 ${index + 1}`),
    url: normalizeUrl(objectProject.url || objectProject.link || objectProject.website),
    role: asText(objectProject.role || objectProject.responsibility),
    techStack: asTextList(objectProject.techStack || objectProject.stack || objectProject.technologies).join(" / "),
    description: asText(objectProject.description || objectProject.body || objectProject.content),
  };
}

function normalizeUrl(value) {
  const text = asText(value).trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `https://${text}`;
}

function asScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
