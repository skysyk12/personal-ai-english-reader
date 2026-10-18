import { NextResponse } from "next/server";

import { getLocalOcrConfig } from "@/lib/ocr/local-tesseract";
import { getPaddleOcrConfig } from "@/lib/ocr/paddle-ocr-vl";

export const runtime = "nodejs";

export async function GET() {
  const config = getPaddleOcrConfig();
  return NextResponse.json({
    provider: config.provider,
    model: config.model,
    language: config.language,
    configured: config.configured,
    local: getLocalOcrConfig(),
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
