import { Component, useState } from "react";
import { analyzeResume } from "./api";
import { sampleJobDescription } from "./mockData";

function App() {
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState(sampleJobDescription);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [apiNotice, setApiNotice] = useState("后端未调用");
  const [isDragging, setIsDragging] = useState(false);

  const isAnalyzing = status === "loading";

  function handleFile(candidate) {
    setError("");
    if (!candidate) return;

    const isPdf =
      candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setFile(null);
      setError("请上传 PDF 格式的简历。");
      return;
    }

    setFile(candidate);
  }

  async function handleAnalyze() {
    setError("");

    if (!file) {
      setError("请先上传 PDF 简历。");
      return;
    }

    if (!jobDescription.trim()) {
      setError("请填写岗位需求。");
      return;
    }

    setStatus("loading");
    setResult(null);

    try {
      const response = await analyzeResume(file, jobDescription.trim());
      setApiNotice(response.notice);
      setResult(response.data);
      setStatus("done");
    } catch (requestError) {
      setApiNotice("请求失败");
      setError(`分析失败：${requestError.message}`);
      setStatus("idle");
    }
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <p>Resume Signal</p>
          <h1>简历匹配分析</h1>
        </div>
        <span>{formatStatus(status)}</span>
      </header>

      <section className="upload-first" aria-label="上传简历">
        <label
          className={`upload-box ${isDragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFile(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
          <span>{file ? "已选择 PDF" : "上传简历 PDF"}</span>
          <strong>{file ? file.name : "点击选择或拖拽到这里"}</strong>
        </label>
      </section>

      <section className="control-grid">
        <div className="jd-panel">
          <div className="panel-title">
            <h2>岗位需求</h2>
            <button type="button" onClick={() => setJobDescription(sampleJobDescription)}>
              样例
            </button>
          </div>
          <textarea
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="粘贴岗位 JD..."
          />
        </div>

        <div className="action-panel">
          <button type="button" onClick={handleAnalyze} disabled={isAnalyzing}>
            {isAnalyzing ? "分析中" : "开始分析"}
          </button>
          {error ? <p className="error">{error}</p> : <p>{apiNotice}</p>}
        </div>
      </section>

      <ResultErrorBoundary resetKey={result?.resumeId || status}>
        {isAnalyzing ? <LoadingState /> : result ? <ResultView result={result} /> : <EmptyState />}
      </ResultErrorBoundary>
    </main>
  );
}

class ResultErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return <p className="error">结果格式异常，页面已保护。请重新分析。</p>;
    }

    return this.props.children;
  }
}

function EmptyState() {
  return (
    <section className="empty">
      <p>上传简历并点击开始分析后，这里会显示候选人、学历、技能、关键词、项目和其他经历。</p>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="empty">
      <p>正在调用 DeepSeek 分析简历...</p>
    </section>
  );
}

function ResultView({ result }) {
  const candidate = result.candidate ?? {};
  const background = result.background ?? {};
  const education = background.education ?? {};
  const score = result.score ?? {};

  return (
    <section className="result-grid" aria-label="分析结果">
      <article className="result-card score-card">
        <h2>匹配度</h2>
        <strong>{score.overall ?? 0}%</strong>
        <p>{result.summary || "已完成分析。"}</p>
        <div className="score-breakdown">
          <ScoreLine label="技能" value={score.skills} />
          <ScoreLine label="经验" value={score.experience} />
          <ScoreLine label="学历" value={score.education} />
          <ScoreLine label="置信" value={score.aiConfidence} />
        </div>
      </article>

      <article className="result-card">
        <h2>候选人</h2>
        <strong className="candidate-name">{candidate.name || "未识别"}</strong>
        <InfoLine label="电话" value={candidate.phone} />
        <InfoLine label="邮箱" value={candidate.email} />
        <InfoLine label="意向" value={result.intent?.role} />
        <InfoLine label="到岗" value={result.intent?.availability} />
        <LinkLine label="作品集" value={candidate.website} />
        <LinkLine label="GitHub" value={candidate.github} />
      </article>

      <article className="result-card">
        <h2>学历</h2>
        <strong className="section-main">{education.school || "待识别"}</strong>
        <InfoLine label="专业" value={joinParts([education.major, education.degree])} />
        <InfoLine label="时间" value={education.period} />
        <KeywordBlock title="课程" items={education.courses ?? []} tone="miss" />
      </article>

      <article className="result-card">
        <h2>技能栈</h2>
        <KeywordBlock title="提取" items={background.skills ?? []} tone="hit" />
        <KeywordBlock title="亮点" items={background.highlights ?? []} tone="miss" />
      </article>

      <article className="result-card">
        <h2>关键词</h2>
        <KeywordBlock title="JD" items={result.jobKeywords ?? []} tone="miss" />
        <KeywordBlock title="命中" items={result.matchedKeywords ?? []} tone="hit" />
        <KeywordBlock title="缺口" items={result.missingKeywords ?? []} tone="miss" />
      </article>

      <article className="result-card projects-card">
        <h2>项目经历</h2>
        {(background.projects ?? []).length ? (
          background.projects.slice(0, 5).map((project, index) => (
            <ProjectItem project={project} key={`${project.name}-${index}`} />
          ))
        ) : (
          <p>未识别到项目经历。</p>
        )}
      </article>

      {(background.experiences ?? []).length ? (
        <article className="result-card projects-card">
          <h2>其他经历</h2>
          {background.experiences.slice(0, 4).map((experience, index) => (
            <ExperienceItem experience={experience} key={`${experience.title}-${index}`} />
          ))}
        </article>
      ) : null}
    </section>
  );
}

function InfoLine({ label, value }) {
  return (
    <p className="info-line">
      <span>{label}</span>
      <strong>{value || "待识别"}</strong>
    </p>
  );
}

function ScoreLine({ label, value = 0 }) {
  return (
    <p className="score-line">
      <span>{label}</span>
      <meter min="0" max="100" value={value} />
      <strong>{value}</strong>
    </p>
  );
}

function LinkLine({ label, value }) {
  if (!value) return null;

  return (
    <p className="info-line">
      <span>{label}</span>
      <a href={value} target="_blank" rel="noreferrer">
        {value.replace(/^https?:\/\//, "")}
      </a>
    </p>
  );
}

function KeywordBlock({ title, items, tone }) {
  return (
    <div className="keyword-block">
      <span>{title}</span>
      <div>
        {items.length ? (
          items.slice(0, 10).map((item) => (
            <em className={tone} key={item}>
              {item}
            </em>
          ))
        ) : (
          <small>暂无</small>
        )}
      </div>
    </div>
  );
}

function ProjectItem({ project }) {
  const name = project?.name || "项目经历";
  const description = project?.description || "";
  const url = project?.url || "";

  return (
    <div className="project">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
      ) : (
        <strong>{name}</strong>
      )}
      {project?.role || project?.techStack ? (
        <small>{joinParts([project.role, project.techStack])}</small>
      ) : null}
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function ExperienceItem({ experience }) {
  return (
    <div className="project">
      <strong>{experience.title || "其他经历"}</strong>
      {joinParts([experience.organization, experience.period]) ? (
        <small>{joinParts([experience.organization, experience.period])}</small>
      ) : null}
      {experience.description ? <p>{experience.description}</p> : null}
    </div>
  );
}

function joinParts(parts) {
  return parts.filter(Boolean).join(" · ");
}

function formatStatus(status) {
  if (status === "loading") return "Analyzing";
  if (status === "done") return "Done";
  return "Ready";
}

export default App;
