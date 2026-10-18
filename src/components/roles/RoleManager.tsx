"use client";

import {
  BookOpenText,
  Braces,
  Check,
  Copy,
  GraduationCap,
  Link2,
  MessageSquareQuote,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRoundCog,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildRolePrompt } from "@/lib/ai/build-prompt";
import type { LearningRole } from "@/lib/types";

const EMPTY_ROLE: Omit<LearningRole, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  description: "",
  currentLevel: "B1–B2",
  goal: "",
  targetScore: null,
  focusAreas: [],
  answerLanguage: "bilingual",
  explanationDepth: "standard",
  tone: "teacher",
  featureFlags: {
    includeExamTips: false,
    includePronunciation: true,
    includeExamples: true,
    includeCollocations: true,
    includeGrammar: true,
  },
  customInstructions: "",
  isDefault: false,
};

const ROLE_FEATURES: ReadonlyArray<{
  key: keyof LearningRole["featureFlags"];
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { key: "includePronunciation", label: "发音", description: "音标与重音", icon: Volume2 },
  { key: "includeExamples", label: "例句", description: "放回真实语境", icon: MessageSquareQuote },
  { key: "includeCollocations", label: "搭配", description: "常见词组用法", icon: Link2 },
  { key: "includeGrammar", label: "语法", description: "句子结构提示", icon: Braces },
  { key: "includeExamTips", label: "考试提示", description: "识别高频考点", icon: GraduationCap },
];

export function RoleManager() {
  const [roles, setRoles] = useState<LearningRole[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<LearningRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadRoles = useCallback(async (preferredId?: string) => {
    const response = await fetch("/api/roles");
    const result = (await response.json()) as LearningRole[];
    setRoles(result);
    const nextId = preferredId || result[0]?.id || "";
    setSelectedId(nextId);
    setDraft(result.find((role) => role.id === nextId) ?? null);
  }, []);

  useEffect(() => {
    // Loading from the local API is the external synchronization owned by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoles();
  }, [loadRoles]);

  const preview = useMemo(() => draft ? buildRolePrompt(draft) : "", [draft]);

  function newRole() {
    const now = new Date().toISOString();
    setCreating(true);
    setSelectedId("");
    setDraft({ id: "draft", createdAt: now, updatedAt: now, ...EMPTY_ROLE });
  }

  function copyRole() {
    if (!draft) return;
    const now = new Date().toISOString();
    setCreating(true);
    setSelectedId("");
    setDraft({ ...draft, id: "draft", name: `${draft.name} 副本`, isDefault: false, createdAt: now, updatedAt: now });
  }

  async function saveRole() {
    if (!draft?.name.trim() || !draft.goal.trim()) {
      setNotice("请填写角色名称和学习目标。");
      return;
    }
    setSaving(true);
    setNotice("");
    const payload = {
      name: draft.name,
      description: draft.description,
      currentLevel: draft.currentLevel,
      goal: draft.goal,
      focusAreas: draft.focusAreas,
      answerLanguage: draft.answerLanguage,
      explanationDepth: draft.explanationDepth,
      tone: draft.tone,
      featureFlags: draft.featureFlags,
      customInstructions: draft.customInstructions,
      isDefault: draft.isDefault,
    };
    const response = await fetch(creating ? "/api/roles" : `/api/roles/${draft.id}`, {
      method: creating ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      setNotice(result.error || "保存失败。");
    } else {
      setNotice("角色已保存。后续新对话会立即使用更新后的要求。");
      setCreating(false);
      setSelectedId(result.id);
      await loadRoles(result.id);
    }
    setSaving(false);
  }

  async function deleteRole() {
    if (!draft || creating) return;
    if (!window.confirm(`删除学习角色“${draft.name}”？历史回答仍会保留角色名称快照。`)) return;
    const response = await fetch(`/api/roles/${draft.id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) return setNotice(result.error || "删除失败。");
    setSelectedId("");
    await loadRoles();
  }

  return (
    <div className="page-shell roles-page">
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">Roles · AI instruction profiles</p>
          <h1>学习角色</h1>
          <p>为不同阅读目标配置回答语言、讲解深度、关注点和语气。</p>
        </div>
        <button className="button primary" onClick={newRole}><Plus size={17} aria-hidden="true" /> 创建角色</button>
      </section>

      <div className="role-layout">
        <aside className="role-list" aria-label="学习角色列表">
          <div className="section-label"><UserRoundCog size={14} aria-hidden="true" />学习角色</div>
          {roles.map((role) => (
            <button
              className={`role-list-item ${!creating && role.id === selectedId ? "is-active" : ""}`}
              key={role.id}
              onClick={() => { setCreating(false); setSelectedId(role.id); setDraft(role); }}
            >
              <span><strong>{role.name}</strong><small>{role.description}</small></span>
              {role.isDefault ? <em><Check size={12} aria-hidden="true" /> 默认</em> : null}
            </button>
          ))}
          <button className="role-list-item add" onClick={newRole}><Plus size={16} aria-hidden="true" /> 新建自定义角色</button>
        </aside>

        {draft ? (
          <section className="role-editor" key={draft.id}>
            <div className="editor-header">
              <div><p className="eyebrow">{creating ? "New role" : "Edit role"}</p><h2>{creating ? "配置新的学习角色" : draft.name}</h2></div>
              <div className="editor-actions">
                {!creating ? <button className="icon-button" aria-label="复制角色" onClick={copyRole}><Copy size={17} aria-hidden="true" /></button> : null}
                {!creating ? <button className="icon-button danger" aria-label="删除角色" onClick={() => void deleteRole()}><Trash2 size={17} aria-hidden="true" /></button> : null}
              </div>
            </div>

            <div className="form-grid">
              <label className="field span-2"><span>角色名称</span><input name="role-name" autoComplete="off" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：商务英语精读…" /></label>
              <label className="field span-2"><span>一句话说明</span><input name="role-description" autoComplete="off" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="例如：帮助理解正式商务材料…" /></label>
              <label className="field"><span>当前水平</span><input name="current-level" autoComplete="off" value={draft.currentLevel} onChange={(e) => setDraft({ ...draft, currentLevel: e.target.value })} /></label>
              <label className="field"><span>回答语言</span><select name="answer-language" value={draft.answerLanguage} onChange={(e) => setDraft({ ...draft, answerLanguage: e.target.value as LearningRole["answerLanguage"] })}><option value="bilingual">中英双语</option><option value="zh-CN">以中文为主</option><option value="en">全英文</option></select></label>
              <label className="field span-2"><span>学习目标</span><textarea name="learning-goal" autoComplete="off" rows={3} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></label>
              <label className="field span-2"><span>关注方向（用逗号分隔）</span><input name="focus-areas" autoComplete="off" value={draft.focusAreas.join("，")} onChange={(e) => setDraft({ ...draft, focusAreas: e.target.value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) })} /></label>
              <label className="field"><span>讲解深度</span><select name="explanation-depth" value={draft.explanationDepth} onChange={(e) => setDraft({ ...draft, explanationDepth: e.target.value as LearningRole["explanationDepth"] })}><option value="brief">简短</option><option value="standard">标准</option><option value="detailed">详细</option></select></label>
              <label className="field"><span>讲解语气</span><select name="explanation-tone" value={draft.tone} onChange={(e) => setDraft({ ...draft, tone: e.target.value as LearningRole["tone"] })}><option value="teacher">教师式</option><option value="direct">直接</option><option value="concise">极简</option></select></label>
              <fieldset className="field span-2 feature-field">
                <legend>回答中可以包含</legend>
                <p className="feature-helper">选择 Margin 可以主动补充的讲解维度。</p>
                <div className="check-grid">
                  {ROLE_FEATURES.map(({ key, label, description, icon: FeatureIcon }) => {
                    const checked = Boolean(draft.featureFlags[key]);
                    return (
                      <label className={`feature-option ${checked ? "is-selected" : ""}`} key={key}>
                        <input
                          name={key}
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => setDraft({
                            ...draft,
                            featureFlags: { ...draft.featureFlags, [key]: event.target.checked },
                          })}
                        />
                        <span className="feature-option-icon" aria-hidden="true"><FeatureIcon size={16} /></span>
                        <span className="feature-option-copy"><strong>{label}</strong><small>{description}</small></span>
                        <span className="feature-option-check" aria-hidden="true"><Check size={11} /></span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <label className="field span-2"><span>自定义要求</span><textarea name="custom-instructions" autoComplete="off" rows={4} value={draft.customInstructions} onChange={(e) => setDraft({ ...draft, customInstructions: e.target.value })} placeholder="例如：先给简短答案，只有长难句才展开语法…" /></label>
              <label className="toggle-field span-2"><span><strong>设为默认角色</strong><small>新导入的书会优先使用这个角色。</small></span><input name="is-default-role" type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} /></label>
            </div>

            {notice ? <p className="form-notice role-notice" role="status"><BookOpenText size={15} aria-hidden="true" />{notice}</p> : null}
            <button className="button primary save-role" disabled={saving} onClick={() => void saveRole()}><Save size={17} aria-hidden="true" /> {saving ? "正在保存…" : "保存角色"}</button>

            <details className="prompt-preview">
              <summary><span><Sparkles size={15} aria-hidden="true" /> 查看生成的角色 Prompt</span><small>服务端会在请求时重新生成</small></summary>
              <pre>{preview}</pre>
            </details>
          </section>
        ) : <section className="role-editor empty">正在加载学习角色…</section>}
      </div>
    </div>
  );
}
