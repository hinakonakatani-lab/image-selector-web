"use client";

import { useState, useEffect, useMemo } from "react";
import ImageGrid from "@/app/components/ImageGrid";
import type { DriveFolder } from "@/app/api/drive/route";

type MemoEntry = { text: string; authorName: string; updatedAt: string };

type VocabEntry = { value: string; count: number };
type VocabResponse = { place: VocabEntry[]; subjects: VocabEntry[]; freeTags: VocabEntry[] };

type Criteria = {
  scene?: "屋内" | "屋外";
  hasPerson?: "人物あり" | "人物なし";
  shot?: "寄り" | "引き";
  place: string[];
  subjects: string[];
  freeTags: string[];
};

type Props = {
  folders: DriveFolder[];
  folderId: string;
  initialColors: Record<string, string>;
  initialMonths: Record<string, string>;
  initialMemos: Record<string, MemoEntry>;
  initialFolderTagCount: number;
  initialFolderTags: Record<string, number>;
  initialRenameMap: Record<string, string>;
  userName: string;
  canUseColor?: boolean;
  canEditMemo?: boolean;
  canUseFolderTag?: boolean;
};

const EMPTY_CRITERIA: Criteria = { place: [], subjects: [], freeTags: [] };

type SearchState = { key: string; fileIds: string[] | null; error: string | null };
const EMPTY_SEARCH_STATE: SearchState = { key: "", fileIds: null, error: null };

function TagAutocomplete({
  label,
  options,
  selected,
  onAdd,
  onRemove,
}: {
  label: string;
  options: VocabEntry[];
  selected: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const suggestions = query
    ? options.filter((o) => o.value.includes(query) && !selected.includes(o.value)).slice(0, 8)
    : [];
  const quickTags = options.filter((o) => !selected.includes(o.value)).slice(0, 6);

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((v) => (
          <span key={v} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm flex items-center gap-1">
            {v}
            <button onClick={() => onRemove(v)} aria-label={`${v}を削除`}>×</button>
          </span>
        ))}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`${label}を検索`}
        className="border rounded px-2 py-1 text-sm w-full"
      />
      {suggestions.length > 0 && (
        <ul className="border rounded mt-1 bg-white shadow-sm">
          {suggestions.map((s) => (
            <li key={s.value}>
              <button
                onClick={() => { onAdd(s.value); setQuery(""); }}
                className="w-full text-left px-2 py-1 hover:bg-gray-100 text-sm"
              >
                {s.value} ({s.count})
              </button>
            </li>
          ))}
        </ul>
      )}
      {!query && quickTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {quickTags.map((t) => (
            <button
              key={t.value}
              onClick={() => onAdd(t.value)}
              className="px-2 py-0.5 border rounded text-xs text-gray-600"
            >
              {t.value} ({t.count})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TagSearchPanel({ folders, folderId, ...gridProps }: Props) {
  const leafIds = useMemo(() => folders.map((f) => f.id), [folders]);
  const [vocab, setVocab] = useState<VocabResponse | null>(null);
  const [criteria, setCriteria] = useState<Criteria>(EMPTY_CRITERIA);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE);

  // Identifies the (leafIds, criteria) pair a search request was made for. Comparing
  // this against searchState.key lets loading/error be *derived* during render instead
  // of requiring a setState call at the top of the search effect (see
  // react-hooks/set-state-in-effect).
  const requestKey = useMemo(() => JSON.stringify({ leafIds, criteria }), [leafIds, criteria]);
  const fileIds = searchState.fileIds;
  const loading = leafIds.length > 0 && searchState.key !== requestKey;
  const searchError = searchState.key === requestKey ? searchState.error : null;
  const error = vocabError ?? searchError;

  useEffect(() => {
    if (leafIds.length === 0) return;
    fetch(`/api/tag-vocab?leafIds=${leafIds.join(",")}`)
      .then((res) => {
        if (!res.ok) throw new Error("request failed");
        return res.json();
      })
      .then((data: VocabResponse) => setVocab(data))
      .catch(() => setVocabError("語彙の取得に失敗しました"));
  }, [leafIds]);

  useEffect(() => {
    if (leafIds.length === 0) return;
    const controller = new AbortController();
    fetch("/api/tag-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leafIds, criteria }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("request failed");
        return res.json();
      })
      .then((data: { fileIds: string[] }) => {
        setSearchState({ key: requestKey, fileIds: data.fileIds, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSearchState((prev) => ({ key: requestKey, fileIds: prev.fileIds, error: "検索に失敗しました" }));
      });
    return () => controller.abort();
  }, [leafIds, criteria, requestKey]);

  const filteredFolders: DriveFolder[] = useMemo(() => {
    if (fileIds === null) return folders;
    const matchSet = new Set(fileIds);
    return folders
      .map((f) => ({ ...f, images: f.images.filter((img) => matchSet.has(img.id)) }))
      .filter((f) => f.images.length > 0);
  }, [folders, fileIds]);

  const toggle = (field: "scene" | "hasPerson" | "shot", value: string) => {
    setCriteria((prev) => ({ ...prev, [field]: prev[field] === value ? undefined : value }));
  };

  const addChip = (field: "place" | "subjects" | "freeTags", value: string) => {
    setCriteria((prev) =>
      prev[field].includes(value) ? prev : { ...prev, [field]: [...prev[field], value] }
    );
  };

  const removeChip = (field: "place" | "subjects" | "freeTags", value: string) => {
    setCriteria((prev) => ({ ...prev, [field]: prev[field].filter((v) => v !== value) }));
  };

  if (!folderId) {
    return <p className="text-gray-400 py-10 text-center">フォルダを選択してください</p>;
  }

  if (vocab && vocab.place.length === 0 && vocab.subjects.length === 0 && vocab.freeTags.length === 0) {
    return <p className="text-gray-400 py-10 text-center">このフォルダはまだタグ付けされていません</p>;
  }

  return (
    <div>
      {error && <p className="text-red-500 mb-2">{error}</p>}
      <div className="flex flex-wrap gap-2 mb-2">
        {(["屋内", "屋外"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("scene", v)}
            className={`px-3 py-1 rounded border ${criteria.scene === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
        {(["人物あり", "人物なし"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("hasPerson", v)}
            className={`px-3 py-1 rounded border ${criteria.hasPerson === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
        {(["寄り", "引き"] as const).map((v) => (
          <button
            key={v}
            onClick={() => toggle("shot", v)}
            className={`px-3 py-1 rounded border ${criteria.shot === v ? "bg-blue-500 text-white" : "bg-white"}`}
          >
            {v}
          </button>
        ))}
      </div>

      {(["place", "subjects", "freeTags"] as const).map((field) => (
        <TagAutocomplete
          key={field}
          label={field}
          options={vocab ? vocab[field] : []}
          selected={criteria[field]}
          onAdd={(v) => addChip(field, v)}
          onRemove={(v) => removeChip(field, v)}
        />
      ))}

      <p className="text-sm text-gray-500 my-2">
        {loading ? "検索中..." : `${filteredFolders.reduce((n, f) => n + f.images.length, 0)}件`}
      </p>

      <ImageGrid
        key={folderId}
        folders={filteredFolders}
        folderId={folderId}
        {...gridProps}
      />
    </div>
  );
}
