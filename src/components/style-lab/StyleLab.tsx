"use client";

import { Bot, BookOpen, Check, ChevronLeft, Library, Palette, Settings2, Sparkles } from "lucide-react";
import { useState } from "react";

type ThemeName = "quiet" | "os" | "night";

const THEMES: Array<{ id: ThemeName; name: string; label: string; thesis: string; signature: string }> = [
  { id: "quiet", name: "Quiet Margin", label: "01 · 纸张边注", thesis: "像一本安静的现代纸书，工具只在你需要时出现。", signature: "与原文对齐的页边批注轨道" },
  { id: "os", name: "Reading OS", label: "02 · 阅读操作系统", thesis: "借鉴 Linear 的秩序感：紧凑、键盘优先、状态一眼可扫。", signature: "命令条与精确的上下文状态" },
  { id: "night", name: "Night Study", label: "03 · 夜间书桌", thesis: "深蓝而非纯黑，让长时间夜读保持沉浸和层次。", signature: "聚焦当前段落的柔和阅读光束" },
];

export function StyleLab() {
  const [theme, setTheme] = useState<ThemeName>("quiet");
  const [screen, setScreen] = useState<"library" | "reader">("library");
  const [aiOpen, setAiOpen] = useState(true);
  const [applied, setApplied] = useState(false);
  const current = THEMES.find((item) => item.id === theme)!;

  function applyTheme() {
    localStorage.setItem("reader-theme", theme);
    document.documentElement.dataset.theme = theme;
    setApplied(true);
    window.setTimeout(() => setApplied(false), 1800);
  }

  return (
    <div className="page-shell style-lab-page">
      <section className="page-heading compact">
        <div><p className="eyebrow">Three clickable directions</p><h1>先选择阅读气质，再统一整套界面。</h1><p>三套方案使用相同信息架构，差异来自密度、字体、颜色与标志性阅读交互，而不只是换皮。</p></div>
      </section>
      <div className="style-lab-toolbar">
        <div className="theme-tabs" role="tablist" aria-label="视觉方案">
          {THEMES.map((item) => <button role="tab" aria-selected={theme === item.id} className={theme === item.id ? "is-active" : ""} key={item.id} onClick={() => { setTheme(item.id); setApplied(false); }}><span>{item.label}</span><strong>{item.name}</strong></button>)}
        </div>
        <div className="lab-actions"><div className="segmented-control"><button className={screen === "library" ? "is-active" : ""} onClick={() => setScreen("library")}>书库页</button><button className={screen === "reader" ? "is-active" : ""} onClick={() => setScreen("reader")}>阅读器</button></div><button className="button primary" onClick={applyTheme}>{applied ? <><Check size={16} /> 已应用</> : <><Palette size={16} /> 应用此方案</>}</button></div>
      </div>

      <section className={`style-preview preview-${theme}`}>
        <div className="preview-notes"><span>{current.name}</span><h2>{current.thesis}</h2><p><strong>标志元素：</strong>{current.signature}</p></div>
        <div className="preview-window">
          {screen === "library" ? <LibraryPreview theme={theme} /> : <ReaderPreview aiOpen={aiOpen} setAiOpen={setAiOpen} />}
        </div>
      </section>

      <div className="direction-rationale">
        <article><span>参考 Readwise Reader</span><p>保留内容优先、键盘操作、批注与资料库之间的连续感。</p></article>
        <article><span>参考 Linear</span><p>提炼稳定的标题栏层级、紧凑控件、可预测的状态和克制动效。</p></article>
        <article><span>本项目专属</span><p>学习角色始终是第一等状态；AI 是页边导师，不抢走正文中心。</p></article>
      </div>
    </div>
  );
}

function LibraryPreview({ theme }: { theme: ThemeName }) {
  return (
    <div className="mock-app mock-library">
      <header><div className="mock-brand"><BookOpen size={17} /><strong>Margin</strong></div><nav><span className="active"><Library size={14} />Library</span><span>Notes</span><span>Roles</span></nav><button>Import</button></header>
      <main>
        <div className="mock-title"><span>READING SPACE</span><h2>{theme === "os" ? "Continue where you left off" : "继续昨晚的阅读。"}</h2></div>
        <section className="mock-featured"><div className="mock-cover"><small>BARNEY STINSON</small><strong>THE<br />BRO<br />CODE</strong></div><div><span>LAST OPENED · 12 MIN AGO</span><h3>The Bro Code</h3><p>Barney Stinson</p><div className="mock-progress"><i /></div><small>Chapter 4 · 32%</small></div><button>Continue <ChevronLeft size={13} /></button></section>
        <div className="mock-section-title"><span>ALL BOOKS</span><strong>3 titles</strong></div>
        <div className="mock-book-row">{["THE BRO CODE", "ON WRITING", "THE ELEMENTS"].map((title, index) => <article key={title}><div className={`mini-cover c${index}`}>{title}</div><strong>{title}</strong><span>{[32, 68, 14][index]}% read</span></article>)}</div>
      </main>
    </div>
  );
}

function ReaderPreview({ aiOpen, setAiOpen }: { aiOpen: boolean; setAiOpen: (open: boolean) => void }) {
  return (
    <div className={`mock-app mock-reader ${aiOpen ? "ai-visible" : ""}`}>
      <header><span><ChevronLeft size={15} /> The Bro Code</span><div><button><Sparkles size={13} /> IELTS prep</button><button aria-label="阅读设置"><Settings2 size={13} /></button><button onClick={() => setAiOpen(!aiOpen)}><Bot size={13} /> AI</button></div></header>
      <aside className="mock-toc"><span>CONTENTS</span>{["Introduction", "Article 01", "Article 02", "Article 03"].map((item, index) => <button className={index === 1 ? "active" : ""} key={item}>{item}</button>)}</aside>
      <main><span className="chapter-label">ARTICLE 01 · THE BRO CODE</span><h2>Bro’s Before Ho’s</h2><p>A Bro is always entitled to do something stupid, as long as the rest of his Bros are all doing it.</p><p className="focused">When a Bro gets a dog, it must be at least as tall as his knee when full-grown.</p><p>Whether he cares to admit it or not, a Bro always wants another Bro to succeed.</p><div className="mock-selection"><button>Explain</button><button>Translate</button><button>Highlight</button></div></main>
      {aiOpen ? <aside className="mock-ai"><header><span>AI TUTOR</span><button aria-label="关闭 AI 预览" onClick={() => setAiOpen(false)}>×</button></header><blockquote>“as long as”</blockquote><div className="mock-answer"><span>IELTS PREP</span><strong>在此处表示“只要……”</strong><p>It introduces a condition. The sentence means the action is acceptable if the other Bros are doing it too.</p><em>Useful pattern · as long as + clause</em></div><div className="mock-prompt">Ask a follow-up…</div></aside> : null}
      <footer><i style={{ width: "32%" }} /><span>32%</span></footer>
    </div>
  );
}
