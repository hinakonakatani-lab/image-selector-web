import { NextResponse } from "next/server";

// このエンドポイントは無効化されています。
// 従来は ANTHROPIC_API_KEY（従量課金の Anthropic API）でサーバーサイド画像認識を行っていましたが、
// 意図しない課金を防ぐため閉鎖しました。画像タグ付けは Claude Code のサブスク内 vision で行う
// 新方式（tag-images スキル）へ移行します。
// 詳細: GitHub issue #3 / #2。復活が必要な場合も、課金方針を確認したうえで行うこと。

export async function POST() {
  return NextResponse.json(
    { error: "この機能は無効化されています（/api/analyze は閉鎖済み）。" },
    { status: 410 }
  );
}
