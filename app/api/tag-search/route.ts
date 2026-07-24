import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { readLeafLabels, type SharedLabelItem } from "@/lib/shared-labels";
import { filterByCriteria } from "@/scripts/lib/filter.mjs";
import synonymGroups from "@/config/tag-synonyms.json";

type SearchCriteria = {
  scene?: "屋内" | "屋外";
  hasPerson?: "人物あり" | "人物なし";
  shot?: "寄り" | "引き";
  place?: string[];
  subjects?: string[];
  freeTags?: string[];
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  let body: { leafIds?: string[]; criteria?: SearchCriteria };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }
  const { leafIds, criteria } = body;
  if (!leafIds || !Array.isArray(leafIds) || leafIds.length === 0) {
    return NextResponse.json({ error: "leafIds が必要です" }, { status: 400 });
  }

  const items = await readLeafLabels(leafIds);
  const matched: SharedLabelItem[] = filterByCriteria(items, criteria ?? {}, synonymGroups);

  return NextResponse.json({ fileIds: matched.map((x) => x.fileId) });
}
