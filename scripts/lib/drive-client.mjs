import { google } from "googleapis";
import { getGoogleCreds } from "./api-config.mjs";

// Google OAuth（drive.readonly）認証情報はキーチェーンから取得（環境変数に平文で置かない）
export function driveClient() {
  const { clientId, clientSecret, refreshToken } = getGoogleCreds();
  const o = new google.auth.OAuth2(clientId, clientSecret);
  o.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth: o });
}
