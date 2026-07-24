import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { readLeafLabels } from "@/lib/shared-labels";
import { collectVocab } from "@/scripts/lib/vocab.mjs";
import synonymGroups from "@/config/tag-synonyms.json";

type Group = { canonical: string; synonyms?: string[] };

function mergeSynonymCounts(counts: Map<string, number>, groups: Group[]) {
  const merged = new Map<string, number>();
  for (const [value, count] of counts) {
    const group = groups.find((g) => [g.canonical, ...(g.synonyms ?? [])].includes(value));
    const key = group ? group.canonical : value;
    merged.set(key, (merged.get(key) ?? 0) + count);
  }
  return merged;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leafIdsParam = searchParams.get("leafIds");
  if (!leafIdsParam) {
    return NextResponse.json({ error: "leafIds が必要です" }, { status: 400 });
  }
  const leafIds = leafIdsParam.split(",").filter(Boolean);

  const items = await readLeafLabels(leafIds);

  const toSorted = (field: "place" | "subjects" | "freeTags") => {
    const counts = mergeSynonymCounts(collectVocab(items, field), synonymGroups);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  return NextResponse.json({
    place: toSorted("place"),
    subjects: toSorted("subjects"),
    freeTags: toSorted("freeTags"),
    synonymGroups,
  });
}
