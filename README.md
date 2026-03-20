# Photography Portfolio Website

This workspace contains a custom, static-first photography portfolio with:

- A cinematic home page
- Services and contact pages
- An admin dashboard for uploading media and editing content
- Local draft storage plus a GitHub Pages publish flow

## How it works

- Draft edits live in `localStorage`
- Uploaded images and videos live in `IndexedDB`
- The admin panel lets you assign uploads to placements like `hero`, `gallery`, `services`, `contact`, and `video`
- For the hero effect, use `hero` for the daytime background image and `reveal` for the night reveal image
- The public site reads from `content/site-data.json` when it exists
- The admin can publish the current state to GitHub by writing `content/site-data.json` and uploaded files into the repo

## Important note

This is a strong frontend prototype, but the editing flow is still intentionally lightweight. That means:

- Content persists on the same browser profile
- It does not need a multi-device CMS
- Publishing live requires a GitHub token with repository contents write access
- For very large video files, a real file host will eventually be better than storing media in the repo

## Publish flow

1. Create a fine-grained GitHub personal access token with contents write access for this repository only.
2. Open `admin.html` from the deployed site or your local copy.
3. Fill in the repository owner, repository name, branch, and token in the publish section.
4. Edit content and uploads locally.
5. Click `Publish live` to commit the JSON content file and uploaded media into the repo.

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
