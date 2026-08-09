import { CheckCircle2, Database, KeyRound, Server, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  return (
    <div className="page-shell settings-page">
      <section className="page-heading compact"><div><p className="eyebrow">Settings · Local configuration</p><h1>设置</h1><p>检查模型连接、本地数据位置和应用的访问范围。</p></div></section>
      <div className="settings-grid">
        <section className="settings-card"><div className="settings-icon"><KeyRound size={20} /></div><div><span>DeepSeek API</span><h2>{hasKey ? "模型连接已配置" : "等待配置 API Key"}</h2><p>{hasKey ? "密钥由服务端环境变量读取，不会进入浏览器或 SQLite。" : "在项目根目录新建 .env.local，填入 DeepSeek API Key 后重启服务。"}</p><dl><div><dt>当前模型</dt><dd>{model}</dd></div><div><dt>浏览器可见</dt><dd>否</dd></div></dl></div>{hasKey ? <CheckCircle2 className="settings-check" size={20} /> : null}</section>
        <section className="settings-card"><div className="settings-icon"><Database size={20} /></div><div><span>本地数据</span><h2>SQLite + 应用托管文件</h2><p>数据库、书籍副本和封面位于项目的 <code>data/</code>，此目录已加入 Git 忽略。</p><dl><div><dt>云同步</dt><dd>未启用</dd></div><div><dt>自动备份</dt><dd>下一阶段</dd></div></dl></div></section>
        <section className="settings-card"><div className="settings-icon"><Server size={20} /></div><div><span>访问范围</span><h2>仅监听 127.0.0.1</h2><p>开发和生产脚本都默认限制为本机访问，不会暴露到局域网。</p></div><ShieldCheck className="settings-check" size={20} /></section>
      </div>
    </div>
  );
}
