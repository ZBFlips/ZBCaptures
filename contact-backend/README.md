# Contact Backend

This folder contains the Cloudflare Worker that receives contact form submissions from the portfolio site.

What it does:

- Accepts the contact form POST
- Saves each submission as a JSON file in R2
- Sends you an email notification

## Required setup

1. Create an R2 bucket named `zb-captures-contact-submissions` or update `wrangler.jsonc` to match your bucket name.
2. Replace `NOTIFICATION_TO` in `wrangler.jsonc` with your inbox.
3. Replace `NOTIFICATION_FROM` with a verified sender address on your domain.
4. Deploy the Worker with Wrangler.

## Local development

```powershell
npm install
npm run dev
```

## Deploy

```powershell
npm run deploy
```

## After deploy

Copy the Worker URL into the contact notification endpoint field in the admin panel on the main site.

When someone submits the contact form:

- The submission is saved in R2 as a JSON file
- The Worker sends you an email notification
- The form falls back to the site email draft flow if the endpoint is unavailable
