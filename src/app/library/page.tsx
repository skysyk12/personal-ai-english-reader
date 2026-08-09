import { Suspense } from "react";

import { LibraryClient } from "@/components/library/LibraryClient";

export default function LibraryPage() {
  return <Suspense fallback={<div className="page-shell"><div className="library-skeleton" aria-label="正在加载书库"><span /><span /><span /></div></div>}><LibraryClient /></Suspense>;
}
