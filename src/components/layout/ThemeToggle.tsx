"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "night";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "night" ? "night" : "light";
    // Sync with the script that runs before the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "night" ? "light" : "night";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("reader-theme", next); } catch { /* local storage can be unavailable */ }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={theme === "night" ? "切换到浅色主题" : "切换到夜间主题"}
      title={theme === "night" ? "浅色主题" : "夜间主题"}
      onClick={toggle}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <i>{theme === "night" ? <Moon size={13} /> : <Sun size={13} />}</i>
      </span>
    </button>
  );
}
