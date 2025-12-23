import React, { useState, useRef, useEffect } from "react";
import "./App.css";

import katex from "katex";
import "katex/dist/katex.min.css";

interface SearchItem {
  query: string;
  status: "searching" | "done";
  result?: string;
}

interface Message {
  type: "user" | "model";
  content: string;
  thinking?: string;
  images?: string[];
  searches?: SearchItem[];
}

interface SSEEvent {
  type: "token" | "done" | "error" | "status" | "search_result";
  content?: string;
  message?: string;
  stage?: string;
  query?: string;
}

type ModelStage = "thinking" | "searching" | "answer";

interface Message {
  type: "user" | "model";
  content: string;
  thinking?: string;
  searches?: SearchItem[];
  stage?: ModelStage;
}

interface ModelInfo {
  model: string;
  display_name: string;
}

const MODES = [
  { value: "direct_reasoning", label: "Direct Reasoning" },
  { value: "naive_rag", label: "Naive RAG" },
  { value: "agentic_search", label: "Agentic Search" },
];

/** ========= Markdown + LaTeX 渲染（保留原功能） ========= */
type MdBlock =
  | { type: "code"; lang?: string; code: string }
  | { type: "math"; tex: string; display: boolean }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "hr" }
  | { type: "blockquote"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

const isHr = (line: string) => {
  const t = line.trim();
  return /^(-{3,}|\*{3,}|_{3,})$/.test(t);
};

const isFenceStart = (line: string) => line.trim().startsWith("```");
const fenceLang = (line: string) => line.trim().slice(3).trim();

const isHeading = (line: string) => /^\s{0,3}#{1,6}\s+/.test(line);
const parseHeading = (line: string) => {
  const m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
  const level = (m?.[1]?.length || 1) as 1 | 2 | 3 | 4 | 5 | 6;
  const text = (m?.[2] || "").trim();
  return { level, text };
};

const isBlockquote = (line: string) => /^\s{0,3}>\s?/.test(line);

const isUlItem = (line: string) => /^\s{0,3}[-*+]\s+/.test(line);
const isOlItem = (line: string) => /^\s{0,3}\d+\.\s+/.test(line);

const stripUl = (line: string) => line.replace(/^\s{0,3}[-*+]\s+/, "");
const stripOl = (line: string) => line.replace(/^\s{0,3}\d+\.\s+/, "");
const stripQuote = (line: string) => line.replace(/^\s{0,3}>\s?/, "");

// ✅ 块级 LaTeX（$$ ... $$）
const isMathFenceLine = (line: string) => line.trim().startsWith("$$");

const parseMarkdownToBlocks = (src: string): MdBlock[] => {
  const text = (src || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (isFenceStart(line)) {
      const lang = fenceLang(line) || undefined;
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !isFenceStart(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && isFenceStart(lines[i])) i++;
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (isMathFenceLine(line)) {
      const t = line.trim();

      // 单行 $$...$$
      if (t.length > 4 && t.endsWith("$$")) {
        const tex = t.slice(2, -2).trim();
        blocks.push({ type: "math", tex, display: true });
        i++;
        continue;
      }

      // 多行 $$ ... $$
      const collected: string[] = [];
      const afterStart = t.slice(2).trim();
      if (afterStart) collected.push(afterStart);

      i++;
      while (i < lines.length) {
        const cur = lines[i];
        const curTrim = cur.trim();

        if (curTrim.endsWith("$$")) {
          const beforeEnd = curTrim.slice(0, -2).trim();
          if (beforeEnd) collected.push(beforeEnd);
          i++;
          break;
        } else {
          collected.push(cur);
          i++;
        }
      }

      blocks.push({
        type: "math",
        tex: collected.join("\n").trim(),
        display: true,
      });
      continue;
    }

    if (isHr(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (isHeading(line)) {
      const { level, text } = parseHeading(line);
      blocks.push({ type: "heading", level, text });
      i++;
      continue;
    }

    if (isBlockquote(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].trim() === "" || isBlockquote(lines[i]))) {
        if (lines[i].trim() === "") quoteLines.push("");
        else quoteLines.push(stripQuote(lines[i]));
        i++;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n").trim() });
      continue;
    }

    if (isUlItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isUlItem(lines[i])) {
        items.push(stripUl(lines[i]));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (isOlItem(line)) {
      const items: string[] = [];
      while (i < lines.length && isOlItem(lines[i])) {
        items.push(stripOl(lines[i]));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !isFenceStart(lines[i]) &&
      !isMathFenceLine(lines[i]) &&
      !isHr(lines[i]) &&
      !isHeading(lines[i]) &&
      !isBlockquote(lines[i]) &&
      !isUlItem(lines[i]) &&
      !isOlItem(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: paraLines.join("\n") });
  }

  return blocks;
};

const renderKatexHTML = (tex: string, displayMode: boolean) => {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });
  } catch {
    return null;
  }
};

type InlineToken =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; label: string; url: string }
  | { type: "math"; tex: string };

const tokenizeInline = (line: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let buf = "";

  const flush = () => {
    if (buf) {
      tokens.push({ type: "text", text: buf });
      buf = "";
    }
  };

  const n = line.length;
  let i = 0;

  while (i < n) {
    const ch = line[i];

    if (ch === "\\" && i + 1 < n && line[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }

    if (ch === "`") {
      const j = line.indexOf("`", i + 1);
      if (j !== -1) {
        flush();
        tokens.push({ type: "code", text: line.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    if (ch === "[") {
      const closeBracket = line.indexOf("]", i + 1);
      if (closeBracket !== -1 && line[closeBracket + 1] === "(") {
        const closeParen = line.indexOf(")", closeBracket + 2);
        if (closeParen !== -1) {
          flush();
          const label = line.slice(i + 1, closeBracket);
          const url = line.slice(closeBracket + 2, closeParen);
          tokens.push({ type: "link", label, url });
          i = closeParen + 1;
          continue;
        }
      }
      buf += ch;
      i++;
      continue;
    }

    // inline math $...$
    if (ch === "$") {
      if (i + 1 < n && line[i + 1] === "$") {
        buf += "$$";
        i += 2;
        continue;
      }

      let j = i + 1;
      while (j < n) {
        if (line[j] === "$" && line[j - 1] !== "\\") break;
        j++;
      }

      if (j < n && line[j] === "$") {
        const tex = line.slice(i + 1, j).trim();
        if (tex.length > 0) {
          flush();
          tokens.push({ type: "math", tex });
          i = j + 1;
          continue;
        }
      }

      buf += "$";
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  flush();
  return tokens;
};

const renderEmphasis = (text: string, keyBase: string): React.ReactNode[] => {
  const pattern = /(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    const matchText = m[0];
    const idx = m.index;

    if (idx > lastIndex) nodes.push(text.slice(lastIndex, idx));

    if (m[1]) {
      nodes.push(<strong key={`${keyBase}-b-${idx}`}>{matchText.slice(2, -2)}</strong>);
    } else if (m[2]) {
      nodes.push(<del key={`${keyBase}-del-${idx}`}>{matchText.slice(2, -2)}</del>);
    } else if (m[3]) {
      nodes.push(<em key={`${keyBase}-i-${idx}`}>{matchText.slice(1, -1)}</em>);
    }

    lastIndex = idx + matchText.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const renderInline = (text: string, keyBase: string): React.ReactNode[] => {
  const lines = (text || "").split("\n");
  const out: React.ReactNode[] = [];

  lines.forEach((line, lineIdx) => {
    const tokens = tokenizeInline(line);
    tokens.forEach((t, tokIdx) => {
      const k = `${keyBase}-l${lineIdx}-t${tokIdx}`;

      if (t.type === "code") {
        out.push(<code key={`${k}-code`}>{t.text}</code>);
      } else if (t.type === "link") {
        out.push(
          <a key={`${k}-link`} href={t.url} target="_blank" rel="noreferrer">
            {t.label}
          </a>
        );
      } else if (t.type === "math") {
        const html = renderKatexHTML(t.tex, false);
        if (html) {
          out.push(
            <span
              key={`${k}-math`}
              className="katex-inline"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        } else {
          out.push(
            <code key={`${k}-math-fallback`} className="katex-error">
              ${t.tex}$
            </code>
          );
        }
      } else {
        out.push(...renderEmphasis(t.text, `${k}-txt`));
      }
    });

    if (lineIdx !== lines.length - 1) out.push(<br key={`${keyBase}-br-${lineIdx}`} />);
  });

  return out;
};

const PureMarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const blocks = React.useMemo(() => parseMarkdownToBlocks(content), [content]);

  return (
    <div className="markdown-body">
      {blocks.map((b, idx) => {
        const k = `md-${idx}`;

        if (b.type === "code") {
          const cls = b.lang ? `language-${b.lang}` : undefined;
          return (
            <pre key={k}>
              <code className={cls}>{b.code}</code>
            </pre>
          );
        }

        if (b.type === "math") {
          const html = renderKatexHTML(b.tex, true);
          if (html) {
            return (
              <div
                key={k}
                className="katex-block"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
          return (
            <pre key={k} className="katex-error-block">
              {`$$\n${b.tex}\n$$`}
            </pre>
          );
        }

        if (b.type === "hr") return <hr key={k} />;

        if (b.type === "heading") {
          const children = renderInline(b.text, k);
          const Tag = (`h${b.level}` as unknown) as React.ElementType;
          return <Tag key={k}>{children}</Tag>;
        }

        if (b.type === "blockquote") {
          return (
            <blockquote key={k}>
              <p>{renderInline(b.text, k)}</p>
            </blockquote>
          );
        }

        if (b.type === "ul") {
          return (
            <ul key={k}>
              {b.items.map((it, j) => (
                <li key={`${k}-li-${j}`}>{renderInline(it, `${k}-li-${j}`)}</li>
              ))}
            </ul>
          );
        }

        if (b.type === "ol") {
          return (
            <ol key={k}>
              {b.items.map((it, j) => (
                <li key={`${k}-li-${j}`}>{renderInline(it, `${k}-li-${j}`)}</li>
              ))}
            </ol>
          );
        }

        return <p key={k}>{renderInline(b.text, k)}</p>;
      })}
    </div>
  );
};
/** ========= Markdown + LaTeX 渲染结束 ========= */

/** ========= Agentic Search 标签渲染（think / search / search_result） ========= */
type AgentSeg =
  | { type: "markdown"; text: string }
  | { type: "think"; text: string; inProgress?: boolean }
  | { type: "search"; text: string; inProgress?: boolean }
  | { type: "search_result"; text: string; inProgress?: boolean };

const parseAgenticSegmentsStreaming = (src: string): AgentSeg[] => {
  const s = src || "";
  const tags: Array<"think" | "search" | "search_result"> = ["think", "search", "search_result"];

  const openOf = (t: string) => `<${t}>`;
  const closeOf = (t: string) => `</${t}>`;

  const segs: AgentSeg[] = [];
  let i = 0;

  while (i < s.length) {
    let nextType: (typeof tags)[number] | null = null;
    let nextIdx = -1;

    for (const t of tags) {
      const idx = s.indexOf(openOf(t), i);
      if (idx !== -1 && (nextIdx === -1 || idx < nextIdx)) {
        nextIdx = idx;
        nextType = t;
      }
    }

    if (nextIdx === -1 || !nextType) {
      const rest = s.slice(i);
      if (rest) segs.push({ type: "markdown", text: rest });
      break;
    }

    if (nextIdx > i) {
      segs.push({ type: "markdown", text: s.slice(i, nextIdx) });
    }

    const openTag = openOf(nextType);
    const closeTag = closeOf(nextType);
    const start = nextIdx + openTag.length;
    const end = s.indexOf(closeTag, start);

    if (end === -1) {
      const inner = s.slice(start);
      segs.push({ type: nextType, text: inner, inProgress: true } as AgentSeg);
      break;
    } else {
      const inner = s.slice(start, end);
      segs.push({ type: nextType, text: inner } as AgentSeg);
      i = end + closeTag.length;
    }
  }

  return segs.filter((x) => !(x.type === "markdown" && x.text.trim() === ""));
};

const SearchListRenderer: React.FC<{ searches?: SearchItem[] }> = ({ searches }) => {
  if (!searches || searches.length === 0) return null;

  return (
    <details className="agent-searches">
      <summary>搜索</summary>
      <div className="agent-panel">
        {searches.map((s, idx) => (
          <div className="agent-search-item" key={`${s.query}-${idx}`}>
            <div className="agent-search-row">
              <span className="agent-chip">Query</span>
              <span className="agent-search-q">{s.query}</span>
              <span className={`agent-status ${s.status}`}>
                {s.status === "searching" ? "Searching" : "Done"}
              </span>
            </div>
            {s.result && (
              <details className="agent-result" open={false}>
                <summary>Search result</summary>
                <div className="agent-panel">
                  <PureMarkdownRenderer content={s.result} />
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </details>
  );
};

const ModelOutputRenderer: React.FC<{ content: string; searches?: SearchItem[] }> = ({ content, searches }) => {
  const segs = React.useMemo(() => parseAgenticSegmentsStreaming(content), [content]);
  const hasAgentTags = React.useMemo(() => segs.some((s) => s.type !== "markdown"), [segs]);

  return (
    <div className="agent-stack">
      {!hasAgentTags && <SearchListRenderer searches={searches} />}

      {segs.map((seg, idx) => {
        const key = `${seg.type}-${idx}`;

        if (seg.type === "markdown") {
          return <PureMarkdownRenderer key={key} content={seg.text} />;
        }

        if (seg.type === "think") {
          const title = seg.inProgress ? "Thinking" : "Thinking Process";
          return (
            <details key={key} className="agent-think" open={!!seg.inProgress}>
              <summary>{title}</summary>
              <div className="agent-panel">
                <PureMarkdownRenderer content={(seg.text || "").trim()} />
              </div>
            </details>
          );
        }

        if (seg.type === "search") {
          return (
            <div key={key} className={`agent-search ${seg.inProgress ? "progress" : ""}`}>
              <span className="agent-chip">Search</span>
              <span className="agent-search-q">{(seg.text || "").trim()}</span>
              {seg.inProgress && <span className="agent-status searching">Searching</span>}
            </div>
          );
        }

        return (
          <details key={key} className="agent-result" open={false}>
            <summary>Search result</summary>
            <div className="agent-panel">
              <PureMarkdownRenderer content={(seg.text || "").trim()} />
            </div>
          </details>
        );
      })}
    </div>
  );
};
/** ========= Agentic Search 标签渲染结束 ========= */

const App: React.FC = () => {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [mode, setMode] = useState("direct_reasoning");

  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 2) 不要强制拉到底 + 回到底部按钮
  const isAtBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // 5) 图片预览（lightbox）
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const handleChatScroll = () => {
    const el = chatRef.current;
    if (!el) return;

    const threshold = 80;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < threshold;

    isAtBottomRef.current = atBottom;
    setShowScrollToBottom(!atBottom);
  };

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        setModels(data.models || []);
        if (data.models?.length > 0) {
          setSelectedModel(data.models[0].model);
        }
      });
  }, []);

  // ✅ 修复：只在用户接近底部时自动滚动；用户上翻就不强制拉回
  useEffect(() => {
    if (isAtBottomRef.current || forceScrollRef.current) {
      requestAnimationFrame(() => scrollToBottom("auto"));
      forceScrollRef.current = false;
    }
  }, [messages]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".model-dropdown")) setShowModelDropdown(false);
      if (!t.closest(".mode-dropdown")) setShowModeDropdown(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // lightbox ESC 关闭
  useEffect(() => {
    if (!lightboxSrc) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxSrc]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;

    setImages((prev) => [...prev, ...files]);
    setImagePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);

    e.target.value = "";
  };

  const removeSelectedImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    setImagePreviews((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed);
      return next;
    });
  };

  const findLastModelIndex = (arr: Message[]) => {
    const idx = arr.slice().reverse().findIndex((m) => m.type === "model");
    return idx === -1 ? -1 : arr.length - 1 - idx;
  };

  const upsertSearch = (
    msg: Message,
    patch: { query: string; status?: "searching" | "done"; result?: string }
  ): Message => {
    const searches = msg.searches ? [...msg.searches] : [];
    const q = patch.query.trim();
    if (!q) return msg;

    let foundIndex = -1;
    for (let i = searches.length - 1; i >= 0; i--) {
      if (searches[i].query === q) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      searches.push({
        query: q,
        status: patch.status || "searching",
        result: patch.result,
      });
    } else {
      const prev = searches[foundIndex];
      searches[foundIndex] = {
        ...prev,
        status: patch.status || prev.status,
        result: patch.result ?? prev.result,
      };
    }

    return { ...msg, searches };
  };

  const handleSubmit = async () => {
    if (!query.trim() && images.length === 0) return;
    if (!selectedModel) return;

    // 2) 发送/生成时，默认回到底部（如果用户刚刚发送）
    forceScrollRef.current = true;

    setLoading(true);

    const sentPreviewImages = images.map((img) => URL.createObjectURL(img));

    setMessages((prev) => {
      const userMsg: Message = { type: "user", content: query || "(图片)" };
      if (sentPreviewImages.length > 0) userMsg.images = sentPreviewImages;

      return [...prev, userMsg, { type: "model", content: "", thinking: "", searches: [] }];
    });

    const formData = new FormData();
    formData.append("query", query);
    formData.append("model", selectedModel);
    formData.append("mode", mode);
    images.forEach((img) => formData.append("files", img));

    setQuery("");
    setImages([]);

    setImagePreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });

    const resp = await fetch("/api/infer", {
      method: "POST",
      body: formData,
    });

    if (!resp.body) {
      setLoading(false);
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const event: SSEEvent = JSON.parse(line.slice(5).trim());

        if (event.type === "token" && event.content) {
          const token = event.content;

          setMessages((prev) => {
            const modelIndex = findLastModelIndex(prev);
            if (modelIndex === -1) return prev;

            const msg = prev[modelIndex];
            const updatedMsg = { ...msg, content: msg.content + token };

            const updated = [...prev];
            updated[modelIndex] = updatedMsg;
            return updated;
          });
        }

        if (event.type === "status" && event.stage === "searching" && event.content) {
          const q = event.content.trim();
          if (!q) continue;

          setMessages((prev) => {
            const modelIndex = findLastModelIndex(prev);
            if (modelIndex === -1) return prev;

            const msg = prev[modelIndex];
            const updatedMsg = upsertSearch(msg, { query: q, status: "searching" });

            const updated = [...prev];
            updated[modelIndex] = updatedMsg;
            return updated;
          });
        }

        if (event.type === "search_result" && event.query && event.content) {
          const q = event.query.trim();

          setMessages((prev) => {
            const modelIndex = findLastModelIndex(prev);
            if (modelIndex === -1) return prev;

            const msg = prev[modelIndex];
            const updatedMsg = upsertSearch(msg, { query: q, status: "done", result: event.content });

            const updated = [...prev];
            updated[modelIndex] = updatedMsg;
            return updated;
          });
        }

        if (event.type === "error") {
          setMessages((prev) => [...prev, { type: "model", content: event.message || "Error" }]);
          setLoading(false);
        }

        if (event.type === "done") {
          setLoading(false);
        }
      }
    }
  };

  const currentModelName =
    models.find((m) => m.model === selectedModel)?.display_name || "Select Model";

  const currentModeName = MODES.find((m) => m.value === mode)?.label || "Select Inference Mode";

  const canSend = query.trim().length > 0 || images.length > 0;

  return (
    <div className="container">
      <div className="top-bar">
        <div className="model-dropdown">
          {/* 3/4) model按钮上下居中 + 去边框 + 小箭头 + hover灰底 */}
          <button
            className="model-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setShowModelDropdown(!showModelDropdown);
            }}
          >
            <span className="trigger-text">{currentModelName}</span>
            <svg
              className="trigger-caret"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>

          {showModelDropdown && (
            <div className="dropdown-menu down">
              {models.map((m) => (
                <div
                  key={m.model}
                  className={`dropdown-item ${selectedModel === m.model ? "active" : ""}`}
                  onClick={() => {
                    setSelectedModel(m.model);
                    setShowModelDropdown(false);
                  }}
                >
                  <div className="item-title">{m.display_name}</div>
                  <div className="item-desc">Model: {m.model}</div>
                  {selectedModel === m.model && <span className="checkmark">✓</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        <h1>人大北自科 项目展示</h1>
      </div>

      <div className="chat-box" ref={chatRef} onScroll={handleChatScroll}>
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.type}`}>
            <div className="message-stack">
              {m.images && m.images.length > 0 && (
                <div className="chat-images">
                  {m.images.map((src, j) => (
                    <img
                      key={j}
                      src={src}
                      alt="preview"
                      onClick={() => setLightboxSrc(src)}
                      title="Click to preview"
                    />
                  ))}
                </div>
              )}

              <div className={`bubble ${m.type}`}>
                {m.type === "model" ? (
                  <div className="model-content">
                    <ModelOutputRenderer content={m.content} searches={m.searches} />
                  </div>
                ) : (
                  <pre>{m.content}</pre>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* 2) 回到最下方按钮（用户不在底部时出现） */}
        <div className={`scroll-bottom-wrap ${showScrollToBottom ? "show" : ""}`}>
          <button
            type="button"
            className="scroll-bottom-btn"
            onClick={() => {
              scrollToBottom("smooth");
              isAtBottomRef.current = true;
              setShowScrollToBottom(false);
            }}
            aria-label="Scroll to bottom"
            title="Back to bottom"
          >
            <svg
              className="scroll-bottom-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14" />
              <path d="M7 14l5 5 5-5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="input-area">
        {imagePreviews.length > 0 && (
          <div className="image-preview">
            {imagePreviews.map((src, idx) => (
              <div key={`${src}-${idx}`} className="preview-item">
                <img
                  src={src}
                  alt={`selected-${idx}`}
                  onClick={() => setLightboxSrc(src)}
                  title="Click to preview"
                />
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => removeSelectedImage(idx)}
                  disabled={loading}
                  aria-label="Remove image"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          rows={3}
          placeholder="Please enter your question here..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={loading}
        />

        <div className="action-row">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept="image/*"
            multiple
            onChange={handleImageSelect}
          />

          <div className="left-controls">
            <div className="mode-dropdown">
              {/* 4) mode按钮去边框 + 小箭头 + hover灰底 */}
              <button
                className="mode-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowModeDropdown(!showModeDropdown);
                }}
              >
                <span className="trigger-text">{currentModeName}</span>
                <svg
                  className="trigger-caret"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </button>

              {showModeDropdown && (
                <div className="dropdown-menu up" onClick={(e) => e.stopPropagation()}>
                  {MODES.map((m) => (
                    <div
                      key={m.value}
                      className={`dropdown-item ${mode === m.value ? "active" : ""}`}
                      onClick={() => {
                        setMode(m.value);
                        setShowModeDropdown(false);
                      }}
                    >
                      <div className="item-title">{m.label}</div>
                      {mode === m.value && <span className="checkmark">✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="right-controls">
            <button
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              aria-label="Upload image"
              title="Upload image"
              type="button"
            >
              <svg
                className="upload-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <button
              className={`send-btn ${loading ? "loading" : ""}`}
              onClick={handleSubmit}
              disabled={loading || !canSend}
              aria-label="Send message"
              title="Send"
            >
              <span className="icon-wrapper" aria-hidden="true">
                {loading ? (
                  <span className="spinner" />
                ) : (
                  <svg
                    className="arrow-up"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 19V5" />
                    <path d="M7 10l5-5 5 5" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 5) 点击图片预览 */}
      {lightboxSrc && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="preview"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="lightbox-close"
            onClick={() => setLightboxSrc(null)}
            aria-label="Close preview"
            title="Close"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
