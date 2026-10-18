import { formatWeeklyReportMarkdown, getLearningInsights } from "@/lib/learning/insights";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("week") || 0);
  const weekOffset = Number.isFinite(value) ? value : 0;
  const insights = getLearningInsights(weekOffset);
  const markdown = formatWeeklyReportMarkdown(insights);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="margin-weekly-${insights.range.start}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
