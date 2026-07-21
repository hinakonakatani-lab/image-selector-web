import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pExecFile = promisify(execFile);

export async function downscale(srcPath, outPath, longEdge = 1024) {
  await pExecFile("sips", ["-Z", String(longEdge), srcPath, "--out", outPath]);
  return outPath;
}
