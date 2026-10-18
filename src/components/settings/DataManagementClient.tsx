"use client";

import { ArchiveRestore, DatabaseBackup, Download, FileSpreadsheet, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";

export function DataManagementClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function restore(file: File) {
    if (!window.confirm("恢复备份会用备份内容替换当前书库和学习数据。系统会先保留恢复前的数据库与书籍目录，是否继续？")) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setRestoring(true);
    setMessage("");
    setError("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/data/restore", { method: "POST", body: form });
      const result = await response.json() as { error?: string; details?: string; books?: number; words?: number; notes?: number };
      if (!response.ok) throw new Error([result.error, result.details].filter(Boolean).join(" "));
      setMessage(`恢复完成：${result.books || 0} 本书、${result.words || 0} 个生词、${result.notes || 0} 条笔记。`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复备份失败。");
    } finally {
      setRestoring(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="data-management-card">
      <header>
        <div className="settings-icon"><DatabaseBackup size={20} /></div>
        <div><span>数据备份与迁移</span><h2>把书库和学习记录握在自己手里</h2><p>完整备份包含数据库、原始 EPUB/PDF 和封面；CSV 可单独导出生词、笔记与阅读记录。</p></div>
        <ShieldCheck className="settings-check" size={20} />
      </header>
      <div className="data-actions">
        <a className="data-action is-primary" href="/api/data/backup" download><DatabaseBackup size={17} /><span><strong>下载完整备份</strong><small>ZIP · 可用于迁移和恢复</small></span><Download size={15} /></a>
        <a className="data-action" href="/api/data/export?kind=vocabulary" download><FileSpreadsheet size={17} /><span><strong>导出生词</strong><small>CSV · 含语境和复习状态</small></span><Download size={15} /></a>
        <a className="data-action" href="/api/data/export?kind=notes" download><FileSpreadsheet size={17} /><span><strong>导出笔记</strong><small>CSV · 含原文与 AI 回答</small></span><Download size={15} /></a>
        <a className="data-action" href="/api/data/export?kind=reading" download><FileSpreadsheet size={17} /><span><strong>导出阅读记录</strong><small>CSV · 时长与进度变化</small></span><Download size={15} /></a>
      </div>
      <div className="restore-zone">
        <div><ArchiveRestore size={17} /><span><strong>从备份恢复</strong><small>恢复前会在 data/backups 中保留安全副本</small></span></div>
        <input ref={inputRef} className="visually-hidden" id="restore-backup" type="file" accept=".zip,application/zip" disabled={restoring} onChange={(event) => { const file = event.target.files?.[0]; if (file) void restore(file); }} />
        <label className="button secondary" htmlFor="restore-backup" aria-disabled={restoring}>{restoring ? <LoaderCircle className="spin" size={15} /> : <ArchiveRestore size={15} />}{restoring ? "恢复中…" : "选择备份"}</label>
      </div>
      {message ? <p className="data-message is-success" role="status">{message}</p> : null}
      {error ? <p className="data-message is-error" role="alert">{error}</p> : null}
    </section>
  );
}
