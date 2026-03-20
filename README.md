# Photography Portfolio Website

This workspace contains a custom, static-first photography portfolio with:

- A cinematic home page
- Services and contact pages
- An admin dashboard for uploading media and editing content
- A browsable lightbox with next and previous controls for image sets
- A client delivery portal for sharing finished shoots
- Local draft storage plus a GitHub Pages publish flow
- A Cloudflare Pages Functions backend for private client delivery with R2 + D1
- A local save endpoint so the admin panel can write `content/site-data.json` and uploaded files directly into the repo when served through `serve.ps1`
- A local folder link workflow so the admin panel can write directly to your project files from the browser

## How it works

- Draft edits live in `localStorage`
- Uploaded images and videos live in `IndexedDB`
- The admin panel is grouped into four main areas: `Hero`, `Portfolio`, `Services`, and `Settings`
- The `Hero` section handles the header logo, the daytime/night hero pair, and the featured frame copy
- The `Portfolio` section handles uploads and the media library
- The `Settings` section includes a contact notification endpoint field if you want submissions forwarded to a backend
- The `Settings` section also includes `Local files`, which lets the admin write directly to your project folder on disk
- The admin panel includes a top-level `Save changes` button that persists the current text and media state
- For the hero effect, use `hero` for the daytime background image and `reveal` for the night reveal image
- The `Client delivery` section lets you create a realtor portal, upload finished files into it, and copy a shareable link
- The public site uses your local browser draft and uploads first when they exist, then falls back to `content/site-data.json`
- The admin can also publish the current public site state to GitHub by writing `content/site-data.json` and uploaded portfolio media into the repo
- Client delivery portals now live outside the repo once the Cloudflare backend is configured

## Contact submissions

If you want form submissions saved and emailed automatically, use the Cloudflare Worker in [`contact-backend/`](./contact-backend).

That backend:

- Stores each submission as a JSON file in R2
- Sends a notification email to your inbox
- Works with the contact notification endpoint field in the admin panel

## Important note

This is a strong frontend prototype, but the editing flow is still intentionally lightweight. That means:

- Content persists on the same browser profile
- It does not need a multi-device CMS
- Publishing live requires a GitHub token with repository contents write access
- Public portfolio videos larger than Cloudflare Pages' asset limits should still be hosted somewhere better than the repo
- Client delivery is now designed for private R2 storage instead of publishing originals into GitHub

## Publish flow

1. Create a fine-grained GitHub personal access token with contents write access for this repository only.
2. Open `admin.html` from the deployed site or your local copy.
3. Fill in the repository owner, repository name, branch, and token in the advanced publish area inside `Settings`.
4. Edit content and uploads locally.
5. Link the project folder in `Settings > Local files` if you want the admin to write the actual local files on disk.
6. Click `Save changes` to write the JSON content file and uploaded media into that folder.
7. Use `Publish live` if you also want to commit the same changes through GitHub.

## Client delivery workflow

1. Open `admin.html`.
2. Go to `Client delivery`.
3. Create a portal for the property or realtor.
4. Click `Save portal` so the portal record is written to Cloudflare D1.
5. Upload the finished images and videos. They go straight into private R2 storage instead of GitHub.
6. Copy either the portal URL plus access code, or the one-click private link, and send it to the client.
7. The client opens `client-access.html`, previews the files, and downloads the originals.

## Cloudflare client delivery setup

Create and bind the private storage pieces before using the live client portal:

1. Create an R2 bucket, keep it private, and note its bucket name.
2. Create a D1 database and run [`cloudflare/d1/schema.sql`](/C:/Users/Zac/Desktop/photography%20portfolio%20website/cloudflare/d1/schema.sql) against it.
3. In Cloudflare Pages, add these bindings for your project:
   - `DB` -> your D1 database
   - `MEDIA_BUCKET` -> your private R2 bucket
4. Add these Pages environment variables / secrets:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `R2_BUCKET_NAME`
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
5. Set R2 CORS so your Pages origin can `PUT` uploads from the admin browser.
6. Redeploy the Pages project so the new `/functions/api/*` routes come online.

For local development, copy [`.dev.vars.example`](/C:/Users/Zac/Desktop/photography%20portfolio%20website/.dev.vars.example) to `.dev.vars` and fill in the real values.

## Local preview

Do not open `index.html` or `admin.html` by double-clicking them. This site uses modules and browser storage, so it should be served over `http://localhost`.

From PowerShell in this folder, run:

```powershell
./serve.ps1
```

Then open:

- `http://localhost:8080/index.html`
- `http://localhost:8080/admin.html`

## Next step

If you want, the next phase can be:

1. Connect this to a real database and image storage
2. Add custom domain deployment
3. Expand the home page into a more interactive immersive experience
