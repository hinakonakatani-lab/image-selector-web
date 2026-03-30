import { auth } from "@/auth";
import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import type { ImageLabel } from "@/app/api/labels/route";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const BIG_THEMES = [
  "食・グルメ",
  "旅行・おでかけ",
  "自然・風景",
  "ファッション・おしゃれ",
  "日常・ライフスタイル",
  "人物・ポートレート",
  "インテリア・空間",
  "アート・クリエイティブ",
  "その他",
];

async function downloadImageAsBase64(
  drive: ReturnType<typeof google.drive>,
  fileId: string
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(res.data as ArrayBuffer);
    // MIMEタイプをヘッダーから取得（なければjpegと仮定）
    const mimeType = (res.headers?.["content-type"] as string) || "image/jpeg";
    const safeMime = mimeType.split(";")[0].trim();
    return { base64: buffer.toString("base64"), mimeType: safeMime };
  } catch {
    return null;
  }
}

async function analyzeImage(base64: string, mimeType: string): Promise<ImageLabel> {
  const prompt = `この画像はInstagramの投稿候補です。以下のJSONのみを返してください（説明文不要）：
{
  "bigTheme": "大テーマ（${BIG_THEMES.join("／")}のどれか1つ）",
  "specificTheme": "具体的なテーマ（例：カフェ・スイーツ、夜景・都市、海・ビーチなど日本語で）",
  "tags": ["タグ1", "タグ2", "タグ3"]
}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("JSONが取得できませんでした");
  return JSON.parse(jsonMatch[0]) as ImageLabel;
}

// POST: { imageIds: string[], folderId: string }
// バッチ単位（10枚程度）で呼び出す想定
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email || !session.accessToken) {
    return NextResponse.json({ error: "未ログイン" }, { status: 401 });
  }

  const { imageIds, folderId } = await request.json() as { imageIds: string[]; folderId: string };
  if (!imageIds?.length || !folderId) {
    return NextResponse.json({ error: "imageIds・folderIdが必要です" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  const results: Record<string, ImageLabel> = {};
  const errors: string[] = [];

  for (const imageId of imageIds) {
    try {
      const imageData = await downloadImageAsBase64(drive, imageId);
      if (!imageData) {
        errors.push(imageId);
        continue;
      }
      const label = await analyzeImage(imageData.base64, imageData.mimeType);
      results[imageId] = label;
    } catch {
      errors.push(imageId);
    }
  }

  return NextResponse.json({ results, errors });
}
