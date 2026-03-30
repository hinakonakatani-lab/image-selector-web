"use client";

import { useEffect, useState, useCallback } from "react";
import type { ImageLabel } from "@/app/api/labels/route";
import type { ThemeMap } from "@/app/api/themes/route";
import type { DriveFolder } from "@/app/api/drive/route";

type Props = {
  folderId: string;
  folders: DriveFolder[];
};

const BATCH_SIZE = 5;

export default function ThemeAnalysis({ folderId, folders }: Props) {
  const [labels, setLabels] = useState<Record<string, ImageLabel>>({});
  const [themes, setThemes] = useState<ThemeMap>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [openBigThemes, setOpenBigThemes] = useState<Record<string, boolean>>({});
  const [openSpecificThemes, setOpenSpecificThemes] = useState<Record<string, boolean>>({});
  const [editingThemes, setEditingThemes] = useState(false);
  const [draftThemes, setDraftThemes] = useState<ThemeMap>({});

  // 全画像IDを取得
  const allImages = folders.flatMap((f) => f.images);
  const allImageIds = allImages.map((img) => img.id);

  // ラベル・テーマをロード
  const loadData = useCallback(async () => {
    if (!folderId) return;
    const [labelsRes, themesRes] = await Promise.all([
      fetch(`/api/labels?folderId=${folderId}`),
      fetch(`/api/themes?folderId=${folderId}`),
    ]);
    const labelsData = await labelsRes.json();
    const themesData = await themesRes.json();
    setLabels(labelsData.labels || {});
    setThemes(themesData.themes || {});
  }, [folderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ラベルからテーママップを生成
  const buildThemeMap = (labelMap: Record<string, ImageLabel>): ThemeMap => {
    const map: ThemeMap = {};
    for (const [imageId, label] of Object.entries(labelMap)) {
      if (!map[label.bigTheme]) map[label.bigTheme] = {};
      if (!map[label.bigTheme][label.specificTheme]) map[label.bigTheme][label.specificTheme] = [];
      map[label.bigTheme][label.specificTheme].push(imageId);
    }
    return map;
  };

  // 分析実行
  const runAnalysis = async () => {
    const unanalyzed = allImageIds.filter((id) => !labels[id]);
    if (unanalyzed.length === 0) return;

    setIsAnalyzing(true);
    setProgress({ done: 0, total: unanalyzed.length });

    let currentLabels = { ...labels };
    for (let i = 0; i < unanalyzed.length; i += BATCH_SIZE) {
      const batch = unanalyzed.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: batch, folderId }),
        });
        const data = await res.json();
        if (data.results) {
          // Redisに保存
          await fetch("/api/labels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId, newLabels: data.results }),
          });
          currentLabels = { ...currentLabels, ...data.results };
          setLabels({ ...currentLabels });
        }
      } catch {
        // バッチ失敗は無視して続行
      }
      setProgress((p) => ({ ...p, done: Math.min(i + BATCH_SIZE, unanalyzed.length) }));
    }

    // テーママップを生成して保存
    const newThemes = buildThemeMap(currentLabels);
    await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, themes: newThemes }),
    });
    setThemes(newThemes);
    setIsAnalyzing(false);
  };

  // テーマ名編集
  const startEditing = () => {
    setDraftThemes(JSON.parse(JSON.stringify(themes)));
    setEditingThemes(true);
  };

  const saveThemes = async () => {
    await fetch("/api/themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId, themes: draftThemes }),
    });
    setThemes(draftThemes);
    setEditingThemes(false);
  };

  const renameBigTheme = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const updated: ThemeMap = {};
    for (const [k, v] of Object.entries(draftThemes)) {
      updated[k === oldName ? newName : k] = v;
    }
    setDraftThemes(updated);
  };

  const renameSpecificTheme = (bigTheme: string, oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    const updated = { ...draftThemes };
    const inner: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(updated[bigTheme])) {
      inner[k === oldName ? newName : k] = v;
    }
    updated[bigTheme] = inner;
    setDraftThemes(updated);
  };

  const analyzedCount = Object.keys(labels).length;
  const unanalyzedCount = allImageIds.filter((id) => !labels[id]).length;
  const currentThemes = editingThemes ? draftThemes : themes;

  const toggleBig = (name: string) =>
    setOpenBigThemes((p) => ({ ...p, [name]: !p[name] }));
  const toggleSpecific = (key: string) =>
    setOpenSpecificThemes((p) => ({ ...p, [key]: !p[key] }));

  // 画像IDからサムネイルURLを引く
  const imageMap: Record<string, { thumbnailUrl: string; name: string }> = {};
  for (const img of allImages) {
    imageMap[img.id] = { thumbnailUrl: img.thumbnailUrl, name: img.name };
  }

  if (!folderId) {
    return (
      <div className="text-center text-gray-400 py-20">
        <p className="text-4xl mb-4">🔍</p>
        <p>フォルダを読み込んでからテーマ分析を使用してください</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 分析ステータス */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-600">
            <span className="font-medium text-green-600">分析済み: {analyzedCount}枚</span>
            {unanalyzedCount > 0 && (
              <span className="ml-3 text-orange-500">未分析: {unanalyzedCount}枚</span>
            )}
            <span className="ml-3 text-gray-400">合計: {allImageIds.length}枚</span>
          </div>
          <button
            onClick={runAnalysis}
            disabled={isAnalyzing || unanalyzedCount === 0}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isAnalyzing
              ? `分析中... (${progress.done}/${progress.total})`
              : unanalyzedCount === 0
              ? "✅ 全て分析済み"
              : `▶ ${unanalyzedCount}枚を分析する`}
          </button>
        </div>

        {/* プログレスバー */}
        {isAnalyzing && (
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-purple-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        )}
      </div>

      {/* テーマ一覧 */}
      {Object.keys(currentThemes).length > 0 && (
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-700">🗂 テーマ一覧</h2>
            <div className="flex gap-2">
              {editingThemes ? (
                <>
                  <button
                    onClick={saveThemes}
                    className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg"
                  >
                    保存して確定
                  </button>
                  <button
                    onClick={() => setEditingThemes(false)}
                    className="px-3 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-lg"
                  >
                    キャンセル
                  </button>
                </>
              ) : (
                <button
                  onClick={startEditing}
                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm rounded-lg"
                >
                  ✏️ テーマ名を編集
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {Object.entries(currentThemes).map(([bigTheme, specifics]) => {
              const totalCount = Object.values(specifics).reduce((s, ids) => s + ids.length, 0);
              const isOpen = openBigThemes[bigTheme];
              return (
                <div key={bigTheme} className="border rounded-lg overflow-hidden">
                  {/* 大テーマ行 */}
                  <div
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleBig(bigTheme)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">{isOpen ? "▼" : "▶"}</span>
                      {editingThemes ? (
                        <input
                          className="border rounded px-2 py-0.5 text-sm font-medium"
                          defaultValue={bigTheme}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => renameBigTheme(bigTheme, e.target.value)}
                        />
                      ) : (
                        <span className="font-medium text-gray-800">{bigTheme}</span>
                      )}
                    </div>
                    <span className="text-sm text-gray-400">{totalCount}枚</span>
                  </div>

                  {/* 具体テーマ一覧 */}
                  {isOpen && (
                    <div className="divide-y">
                      {Object.entries(specifics).map(([specificTheme, imageIds]) => {
                        const specKey = `${bigTheme}__${specificTheme}`;
                        const isSpecOpen = openSpecificThemes[specKey];
                        return (
                          <div key={specificTheme}>
                            {/* 具体テーマ行 */}
                            <div
                              className="flex items-center justify-between px-6 py-2 cursor-pointer hover:bg-gray-50 select-none"
                              onClick={() => toggleSpecific(specKey)}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-gray-300 text-sm">{isSpecOpen ? "▼" : "▶"}</span>
                                {editingThemes ? (
                                  <input
                                    className="border rounded px-2 py-0.5 text-sm"
                                    defaultValue={specificTheme}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) =>
                                      renameSpecificTheme(bigTheme, specificTheme, e.target.value)
                                    }
                                  />
                                ) : (
                                  <span className="text-sm text-gray-700">{specificTheme}</span>
                                )}
                              </div>
                              <span className="text-xs text-gray-400">{imageIds.length}枚</span>
                            </div>

                            {/* 画像グリッド */}
                            {isSpecOpen && (
                              <div className="px-6 pb-4 pt-2 bg-gray-50">
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                  {imageIds.map((id) => {
                                    const img = imageMap[id];
                                    if (!img) return null;
                                    return (
                                      <a
                                        key={id}
                                        href={`https://drive.google.com/file/d/${id}/view`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="aspect-square overflow-hidden rounded border hover:opacity-80 transition-opacity"
                                        title={img.name}
                                      >
                                        {img.thumbnailUrl ? (
                                          <img
                                            src={img.thumbnailUrl}
                                            alt={img.name}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full bg-gray-200 flex items-center justify-center text-xs text-gray-400">
                                            No image
                                          </div>
                                        )}
                                      </a>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 未分析・テーマなし */}
      {Object.keys(currentThemes).length === 0 && !isAnalyzing && (
        <div className="text-center text-gray-400 py-16">
          <p className="text-4xl mb-4">🏷️</p>
          <p>「分析する」ボタンを押すと、画像をテーマ別に自動分類します</p>
          <p className="text-sm mt-2">初回のみ時間がかかります（5000枚で約30〜60分）</p>
        </div>
      )}
    </div>
  );
}
