# Scripts: Image Tagging & Collection Workflow

This directory contains the core library modules, command-line utilities, and integrations for the image tagging, vocabulary normalization, and collection workflow.

## Environment Variables

The scripts require credentials for Google Drive and Upstash Redis. Set these in your `.env` or shell:

### Redis / Vercel KV (Required)
- **`KV_REST_API_URL`**: REST endpoint for your Upstash Redis instance
- **`KV_REST_API_TOKEN`**: Bearer token for Upstash Redis

**How to obtain:**
- Run `vercel env pull` in the project root (requires Vercel CLI and project link)
- Or: Log in to [Upstash Console](https://console.upstash.com), select your Redis database, and copy the REST API URL and token from the "REST API" section

### Google Drive OAuth (Required for Path 2; optional for Path 1)
- **`GOOGLE_CLIENT_ID`**: OAuth 2.0 client ID
- **`GOOGLE_CLIENT_SECRET`**: OAuth 2.0 client secret
- **`GOOGLE_REFRESH_TOKEN`**: Refresh token for persistent authentication

**How to obtain:**
- Create a service account or OAuth 2.0 credential in [Google Cloud Console](https://console.cloud.google.com)
- For refresh tokens: Use [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) with the Google Drive API (`https://www.googleapis.com/auth/drive.readonly`)
- Select "Exchange authorization code for tokens" to generate a refresh token

## Skills

### `tag-images` (Task 10)
**Purpose:** Vision-tag Google Drive images with schema labels (scene, place, subject, etc.) and write results to Redis under `labels:shared:<folderId>`.

- Recursively traverses Drive folder tree
- Fetches each image via MCP (Path 1) or OAuth thumbnailLink (Path 2 — live verification deferred)
- Downscales to 1024px long edge via macOS `sips`
- Invokes Claude vision API for multi-field tagging
- Uses disposable subagents for concurrent processing
- Writes labels incrementally to Redis (idempotent: no re-tagging on rerun)

### `normalize-vocab` (Task 12)
**Purpose:** Canonicalize tag vocabulary (place names, subject categories) with human approval workflow.

- Collects all place/subject/freeTag values from existing Redis labels
- Identifies duplicates, typos, and synonyms
- Builds merge map with human decision approval
- Applies merges across all labeled images atomically
- Ensures vocabulary consistency before collection

### `collect-by-theme` (Task 13)
**Purpose:** Build structured image collections by theme using keyword search + semantic refinement.

- Two-stage filtering: keyword match (place, subject, scene criteria) then semantic validation
- Generates gallery HTML with theme title, image count, and tagged grid
- Outputs optimized metadata for app integration (Path 3: future — Phase C)
- Supports both MCP-downloaded images (Path 1) and OAuth thumbnailLink URLs (Path 2)

## Library Modules

All modules in `scripts/lib/` are env-free and fully tested:

- **`keys.mjs`**: Redis key naming conventions (labels:shared:*, vocab:*, scan patterns)
- **`tag-schema.mjs`**: Label structure validation (fixed axes: hasPerson, scene, shot; arrays: subjects, freeTags, tags)
- **`drive-tree.mjs`**: Google Drive tree traversal (folder/image detection, grouping by parent)
- **`filter.mjs`**: Apply criteria filters to labeled items (scene, hasPerson, shot, place, subject partial matches)
- **`vocab.mjs`**: Collect vocabulary frequencies and apply merge maps atomically
- **`gallery.mjs`**: Render filtered images as HTML grid with escaped tags and lazy loading
- **`image.mjs`**: Downscale images to long-edge 1024px via `sips` (macOS native)
- **`redis.mjs`**: Upstash Redis client; read all labels (SCAN), write per-folder (atomic merge)

## Command-Line Tools

All CLIs output JSON for pipeline composition:

- **`node scripts/list-images.mjs <rootFolderId>`**  
  Walk Google Drive tree from rootFolderId; output `{ byLeaf: { parentId: [{ id, title }, ...] }, thumbById: { id: thumbnailLink } }`

- **`node scripts/read-labels.mjs`**  
  Read all labels:shared:* from Redis; output `[{ folderId, fileId, label }, ...]`

- **`node scripts/write-labels.mjs <folderId>`**  
  Write labels to Redis for a folder (stdin: `{ fileId: label, ... }`); merge with existing (no overwrites)

- **`node scripts/vocab-report.mjs [place|subjects|freeTags]`**  
  Collect vocabulary from all labels; output `[[value, frequency], ...]` sorted by frequency desc

- **`node scripts/build-gallery.mjs <theme> <outHtmlPath>`**  
  Render gallery HTML from stdin tiles (stdin: `[{ title, viewUrl, thumbPath, label }, ...]`)

## Image Access Paths

Images are accessed and standardized to long-edge 1024px:

- **Path 1 (Proven Fallback):** MCP `read_file_content` downloads → local downscale via `sips`  
  Status: ✅ Tested; works offline; no live credentials required
  
- **Path 2 (Intended Primary):** OAuth `thumbnailLink` with `=s1024` suffix  
  Status: ⚠️ Deferred verification pending Google OAuth credentials in prod  
  Will replace Path 1 once live OAuth is configured
  
Vision images (Claude API input) are standardized to 1024px long edge in all paths.

## Security

Drive integration is **read-only**:
- `.claude/settings.json` explicitly denies `mcp__claude_ai_Google_Drive__create_file` and `mcp__claude_ai_Google_Drive__copy_file`
- Only `read_file_content` and folder traversal are permitted
- Redis keys are namespaced (`labels:shared:*`, `vocab:*`) and scanned atomically

## Phase C: App Integration (Out of Scope)

Future work (planned separately):
- Shared-key labels UI component (fetch labels from Redis at runtime)
- Collection view (display gallery + theme metadata in app)
- Currently deferred; Phase A (schema + tagging) and Phase B (normalization + collection) are complete.

## Testing

Run all unit tests (env-free):

```bash
node --test scripts/lib/*.test.mjs
```

Expected output: 20 passing tests across 8 modules.

Each module exports public functions and includes a corresponding `.test.mjs` file with comprehensive coverage:
- **keys.test.mjs**: Redis key naming
- **tag-schema.test.mjs**: Label validation and fixed-axis candidates
- **drive-tree.test.mjs**: Tree traversal and leaf grouping
- **filter.test.mjs**: Criteria matching (scene, place, subject)
- **vocab.test.mjs**: Frequency collection and merge application
- **gallery.test.mjs**: HTML rendering with escaping
- **image.test.mjs**: Image downscaling to 1024px
- **redis.test.mjs**: Label merging

---

**Branch:** `feature/image-tagging-theme-collection`  
**Tasks:** 1–14 (Phase A schema, Phase B tagging + normalization + collection)
