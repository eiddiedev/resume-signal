from __future__ import annotations

import hashlib
import io
import json
import os
import re
import time
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

load_dotenv()

try:
    import redis
except ImportError:  # pragma: no cover - redis is optional at runtime
    redis = None


DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
REDIS_URL = os.getenv("REDIS_URL", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="Resume Signal API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=bool(ALLOWED_ORIGINS),
    allow_methods=["*"],
    allow_headers=["*"],
)

memory_cache: dict[str, dict[str, Any]] = {}
redis_client = redis.from_url(REDIS_URL, decode_responses=True) if redis and REDIS_URL else None


class MatchRequest(BaseModel):
    jobDescription: str


def cache_get(key: str) -> dict[str, Any] | None:
    if redis_client:
        value = redis_client.get(key)
        return json.loads(value) if value else None
    return memory_cache.get(key)


def cache_set(key: str, value: dict[str, Any], ttl: int = 60 * 60 * 12) -> None:
    if redis_client:
        redis_client.setex(key, ttl, json.dumps(value, ensure_ascii=False))
        return
    memory_cache[key] = value


def clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"第\s*\d+\s*页|page\s*\d+", "", text, flags=re.IGNORECASE)
    return text.strip()


def parse_pdf(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"PDF 解析失败：{exc}") from exc

    text = clean_text("\n\n".join(pages))
    if not text:
        raise HTTPException(status_code=422, detail="未能从 PDF 中提取到可分析文本。")
    return text


def resume_id_for(file_bytes: bytes) -> str:
    digest = hashlib.sha256(file_bytes).hexdigest()[:16]
    return f"resume-{digest}"


def extract_json(content: str) -> dict[str, Any]:
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?", "", content)
        content = re.sub(r"```$", "", content).strip()

    match = re.search(r"\{.*\}", content, flags=re.DOTALL)
    if not match:
        raise ValueError("模型未返回 JSON 对象")
    return json.loads(match.group(0))


async def deepseek_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("缺少 DEEPSEEK_API_KEY")

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    return extract_json(content)


def heuristic_extract(text: str) -> dict[str, Any]:
    email = re.search(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", text)
    phone = re.search(r"(?:\+?86[-\s]?)?1[3-9]\d{9}", text)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    name = lines[0][:12] if lines else "待识别"

    return {
        "candidate": {
            "name": name,
            "phone": phone.group(0) if phone else "",
            "email": email.group(0) if email else "",
            "address": "",
        },
        "intent": {"role": "", "salary": ""},
        "background": {
            "years": "",
            "education": "",
            "projects": lines[:5],
        },
        "sections": [
            {
                "title": "PDF 文本",
                "body": text[:180] + ("..." if len(text) > 180 else ""),
            }
        ],
        "summary": "已完成 PDF 文本解析。未配置 DeepSeek Key，因此仅返回正则与启发式提取结果。",
    }


def heuristic_match(parsed: dict[str, Any], job_description: str) -> dict[str, Any]:
    source = json.dumps(parsed, ensure_ascii=False).lower()
    tokens = [
        token
        for token in re.split(r"[\s,，。；;、/|]+", job_description)
        if len(token.strip()) >= 2
    ]
    matched = sorted({token for token in tokens if token.lower() in source})[:12]
    missing = [token for token in tokens if token not in matched][:8]
    score = min(92, 55 + len(matched) * 5)

    return {
        "score": {
            "overall": score,
            "skills": min(95, score + 4),
            "experience": max(45, score - 6),
            "education": max(45, score - 10),
            "aiConfidence": 42,
        },
        "jobKeywords": tokens[:16],
        "matchedKeywords": matched,
        "missingKeywords": missing,
        "summary": "已基于 PDF 文本和岗位描述完成启发式匹配。配置 DeepSeek 后会返回更准确的 AI 评分。",
    }


def as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, ensure_ascii=False)


def as_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [item.strip() for item in map(as_text, value) if item.strip()]
    if isinstance(value, str):
        return [item.strip() for item in re.split(r"[\n,，;；、|]+", value) if item.strip()]
    if isinstance(value, dict):
        items: list[str] = []
        for nested in value.values():
            items.extend(as_text_list(nested))
        return items
    return []


def normalize_url(value: Any) -> str:
    text = as_text(value).strip()
    if not text:
        return ""
    if re.match(r"^https?://", text, flags=re.IGNORECASE):
        return text
    return f"https://{text}"


def normalize_project(value: Any, index: int) -> dict[str, str]:
    if isinstance(value, str):
        return {
            "name": f"项目经历 {index + 1}",
            "url": "",
            "role": "",
            "techStack": "",
            "description": value,
        }

    project = as_object(value)
    return {
        "name": as_text(project.get("name") or project.get("title") or f"项目经历 {index + 1}"),
        "url": normalize_url(project.get("url") or project.get("link") or project.get("website")),
        "role": as_text(project.get("role") or project.get("responsibility")),
        "techStack": " / ".join(as_text_list(project.get("techStack") or project.get("stack") or project.get("technologies"))),
        "description": as_text(project.get("description") or project.get("body") or project.get("content")),
    }


def normalize_projects(value: Any) -> list[dict[str, str]]:
    if isinstance(value, list):
        projects = [normalize_project(project, index) for index, project in enumerate(value)]
        return [project for project in projects if project["name"] or project["url"] or project["description"]]
    if isinstance(value, str):
        return [
            {"name": f"项目经历 {index + 1}", "url": "", "description": description}
            for index, description in enumerate(as_text_list(value))
        ]
    if isinstance(value, dict):
        project = normalize_project(value, 0)
        return [project] if project["name"] or project["url"] or project["description"] else []
    return []


def normalize_education(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        return {
            "school": "",
            "major": "",
            "degree": "",
            "period": "",
            "courses": [],
            "summary": value,
        }

    education = as_object(value)
    return {
        "school": as_text(education.get("school") or education.get("university")),
        "major": as_text(education.get("major")),
        "degree": as_text(education.get("degree")),
        "period": as_text(education.get("period") or education.get("time")),
        "courses": as_text_list(education.get("courses")),
        "summary": as_text(education.get("summary")),
    }


def normalize_experience(value: Any) -> list[dict[str, str]]:
    if isinstance(value, list):
        experiences = []
        for index, item in enumerate(value):
            if isinstance(item, str):
                experiences.append(
                    {
                        "title": f"经历 {index + 1}",
                        "organization": "",
                        "period": "",
                        "description": item,
                    }
                )
                continue
            experience = as_object(item)
            experiences.append(
                {
                    "title": as_text(experience.get("title") or experience.get("name") or f"经历 {index + 1}"),
                    "organization": as_text(experience.get("organization") or experience.get("company") or experience.get("team")),
                    "period": as_text(experience.get("period") or experience.get("time")),
                    "description": as_text(experience.get("description") or experience.get("body") or experience.get("content")),
                }
            )
        return [item for item in experiences if item["title"] or item["description"]]
    if isinstance(value, str):
        return [{"title": "其他经历", "organization": "", "period": "", "description": value}]
    if isinstance(value, dict):
        return normalize_experience([value])
    return []


def as_score(value: Any) -> int:
    try:
        score = round(float(value))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, score))


def normalize_sections(value: Any) -> list[dict[str, str]]:
    if isinstance(value, list):
        sections = []
        for index, section in enumerate(value):
            if isinstance(section, str):
                sections.append({"title": f"解析片段 {index + 1}", "body": section})
                continue
            section_obj = as_object(section)
            sections.append(
                {
                    "title": as_text(section_obj.get("title") or section_obj.get("name") or f"解析片段 {index + 1}"),
                    "body": as_text(section_obj.get("body") or section_obj.get("content") or section_obj.get("text")),
                }
            )
        return [section for section in sections if section["title"] or section["body"]]
    if isinstance(value, str):
        return [{"title": "解析摘要", "body": value}]
    if isinstance(value, dict):
        return [{"title": as_text(title), "body": as_text(body)} for title, body in value.items()]
    return []


def normalize_resume_payload(value: dict[str, Any]) -> dict[str, Any]:
    candidate = as_object(value.get("candidate"))
    intent = as_object(value.get("intent"))
    background = as_object(value.get("background"))

    return {
        "candidate": {
            "name": as_text(candidate.get("name")),
            "phone": as_text(candidate.get("phone")),
            "email": as_text(candidate.get("email")),
            "address": as_text(candidate.get("address")),
            "website": normalize_url(candidate.get("website") or candidate.get("portfolio")),
            "github": normalize_url(candidate.get("github")),
        },
        "intent": {
            "role": as_text(intent.get("role")),
            "salary": as_text(intent.get("salary")),
            "availability": as_text(intent.get("availability")),
        },
        "background": {
            "years": as_text(background.get("years")),
            "education": normalize_education(background.get("education")),
            "skills": as_text_list(background.get("skills")),
            "projects": normalize_projects(background.get("projects")),
            "experiences": normalize_experience(background.get("experiences") or background.get("otherExperiences")),
            "highlights": as_text_list(background.get("highlights")),
        },
        "sections": normalize_sections(value.get("sections")),
        "summary": as_text(value.get("summary")),
    }


def normalize_match_payload(value: dict[str, Any]) -> dict[str, Any]:
    score = as_object(value.get("score"))

    return {
        "score": {
            "overall": as_score(score.get("overall")),
            "skills": as_score(score.get("skills")),
            "experience": as_score(score.get("experience")),
            "education": as_score(score.get("education")),
            "aiConfidence": as_score(score.get("aiConfidence")),
        },
        "jobKeywords": as_text_list(value.get("jobKeywords")),
        "matchedKeywords": as_text_list(value.get("matchedKeywords")),
        "missingKeywords": as_text_list(value.get("missingKeywords")),
        "summary": as_text(value.get("summary")),
    }


async def ai_extract_resume(text: str) -> dict[str, Any]:
    system_prompt = (
        "你是招聘系统中的简历结构化抽取引擎。只输出合法 JSON，不要输出解释。"
        "缺失字段用空字符串或空数组，不要编造。"
    )
    user_prompt = f"""
请从以下简历文本中抽取结构化信息。

必须返回 JSON，字段严格为：
{{
  "candidate": {{"name": "", "phone": "", "email": "", "address": ""}},
  "intent": {{"role": "", "salary": "", "availability": ""}},
  "background": {{
    "years": "",
    "education": {{"school": "", "major": "", "degree": "", "period": "", "courses": [], "summary": ""}},
    "skills": [],
    "projects": [{{"name": "", "url": "", "role": "", "techStack": [], "description": ""}}],
    "experiences": [{{"title": "", "organization": "", "period": "", "description": ""}}],
    "highlights": []
  }},
  "sections": [{{"title": "", "body": ""}}],
  "summary": ""
}}

抽取要求：
- 个人网站、作品集、GitHub 链接放入 candidate.website / candidate.github。
- 教育背景必须拆成 school、major、degree、period、courses。
- 技术栈放入 background.skills，去重并保留关键技术名。
- 项目经历尽量保留项目名、链接、角色、技术栈和一句描述。
- 社团、比赛、实习、团队协作、作品集等非项目内容放入 experiences 或 highlights。

简历文本：
{text[:12000]}
"""
    return normalize_resume_payload(await deepseek_json(system_prompt, user_prompt))


async def ai_match_resume(parsed: dict[str, Any], job_description: str) -> dict[str, Any]:
    system_prompt = (
        "你是招聘匹配评分引擎。根据候选人简历和岗位需求进行谨慎评分。"
        "只输出合法 JSON，不要输出解释；不要虚构简历中没有的信息。"
    )
    user_prompt = f"""
岗位需求：
{job_description}

候选人结构化简历：
{json.dumps(parsed, ensure_ascii=False)}

请返回 JSON，字段严格为：
{{
  "score": {{
    "overall": 0,
    "skills": 0,
    "experience": 0,
    "education": 0,
    "aiConfidence": 0
  }},
  "jobKeywords": [],
  "matchedKeywords": [],
  "missingKeywords": [],
  "summary": ""
}}

评分要求：
- 所有分数为 0-100 的整数。
- jobKeywords 提取岗位需求中的关键技能、经验、工具、业务要求。
- matchedKeywords 只能包含简历中有证据支持的关键词。
- missingKeywords 放岗位需要但简历证据不足的关键词。
- summary 用一句中文说明是否建议进入下一轮。
"""
    return normalize_match_payload(await deepseek_json(system_prompt, user_prompt))


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "deepseekConfigured": bool(DEEPSEEK_API_KEY),
        "cache": "redis" if redis_client else "memory",
        "time": int(time.time()),
    }


@app.post("/api/resumes")
async def upload_resume(file: UploadFile = File(...)) -> dict[str, Any]:
    if file.content_type not in {"application/pdf", "application/octet-stream"} and not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 简历。")

    file_bytes = await file.read()
    resume_id = resume_id_for(file_bytes)
    cache_key = f"resume:{resume_id}"
    cached = cache_get(cache_key)
    if cached:
        return {**cached, "cacheHit": True}

    text = parse_pdf(file_bytes)
    try:
        parsed = await ai_extract_resume(text)
        mode = "deepseek"
    except Exception as exc:
        if DEEPSEEK_API_KEY:
            raise HTTPException(status_code=502, detail=f"DeepSeek 信息抽取失败：{exc}") from exc
        parsed = heuristic_extract(text)
        mode = "heuristic"

    result = {
        "resumeId": resume_id,
        "sourceFile": file.filename,
        "rawTextPreview": text[:500],
        "parseMode": mode,
        "cacheHit": False,
        **parsed,
    }
    cache_set(cache_key, result)
    return result


@app.post("/api/debug/extract-text")
async def debug_extract_text(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    text = parse_pdf(file_bytes)
    return {
        "sourceFile": file.filename,
        "characters": len(text),
        "preview": text[:1200],
    }


@app.post("/api/resumes/{resume_id}/match")
async def match_resume(resume_id: str, payload: MatchRequest) -> dict[str, Any]:
    job_description = payload.jobDescription.strip()
    if not job_description:
        raise HTTPException(status_code=400, detail="岗位需求描述不能为空。")

    cached_resume = cache_get(f"resume:{resume_id}")
    if not cached_resume:
        raise HTTPException(status_code=404, detail="未找到已解析的简历，请先上传 PDF。")

    match_digest = hashlib.sha256(job_description.encode("utf-8")).hexdigest()[:16]
    cache_key = f"match:{resume_id}:{match_digest}"
    cached_match = cache_get(cache_key)
    if cached_match:
        return {**cached_match, "cacheHit": True}

    parsed_for_ai = {
        "candidate": cached_resume.get("candidate", {}),
        "intent": cached_resume.get("intent", {}),
        "background": cached_resume.get("background", {}),
        "sections": cached_resume.get("sections", []),
        "summary": cached_resume.get("summary", ""),
    }

    try:
        matched = await ai_match_resume(parsed_for_ai, job_description)
        mode = "deepseek"
    except Exception as exc:
        if DEEPSEEK_API_KEY:
            raise HTTPException(status_code=502, detail=f"DeepSeek 匹配评分失败：{exc}") from exc
        matched = heuristic_match(parsed_for_ai, job_description)
        mode = "heuristic"

    result = {
        **parsed_for_ai,
        **matched,
        "resumeId": resume_id,
        "sourceFile": cached_resume.get("sourceFile", ""),
        "matchMode": mode,
        "cacheHit": False,
    }
    cache_set(cache_key, result)
    return result
