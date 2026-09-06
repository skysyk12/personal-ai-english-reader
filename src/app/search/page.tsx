import { Suspense } from "react";

import { SearchClient } from "@/components/search/SearchClient";

export default function SearchPage() {
  return <Suspense fallback={<div className="page-shell"><div className="learning-skeleton"><span /><span /><span /></div></div>}><SearchClient /></Suspense>;
}
