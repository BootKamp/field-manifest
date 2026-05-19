# The Field Manifest — Deployment Guide

Editorial 4WD trip planner for BootKamp. Packing list, payload tracker, journal, and live fuel route planning, packaged as a deployable Next.js app that installs to phones as a PWA.

---

## What's in this package

```
field-manifest/
├── components/
│   └── FieldManifest.jsx    ← the whole app (~3,900 lines)
├── pages/
│   ├── _app.js              ← shims window.storage onto localStorage
│   ├── _document.js         ← PWA meta tags
│   ├── index.js             ← renders the app (client-side)
│   └── api/
│       └── plan-route.js    ← Anthropic API proxy (server-side, holds your key)
├── public/
│   ├── manifest.webmanifest ← PWA manifest
│   └── icons/               ← placeholder icons (swap for real BootKamp brand)
├── styles/
│   └── globals.css          ← fonts + base styles
├── package.json
├── next.config.mjs          ← PWA + Next config
├── tailwind.config.js
├── postcss.config.mjs
├── vercel.json              ← extends serverless function timeout to 60s
├── .env.local.example       ← template for your API key
└── README.md                ← this file
```

---

## Deployment: from zero to a working app at app.bootkamp.co

Plan to spend about 45 minutes the first time. Once it's live, you push code changes and they're deployed in 60 seconds.

### Prerequisites

1. **A GitHub account** — for hosting the source code. Free.
2. **A Vercel account** — for deploying the app. Free tier is plenty.
3. **An Anthropic API key** — get one at https://console.anthropic.com/settings/keys. Bill is roughly $0.01-0.02 per fuel search.
4. **(Optional) Node.js 18+ installed locally** if you want to test before deploying. Download from nodejs.org.

### Step 1: Get the code into a GitHub repo

You have two paths.

**Path A — drag and drop into github.com (no terminal needed):**

1. Sign in to github.com, click the **+** top right, choose **New repository**.
2. Name it `field-manifest` (or whatever you like). Set it private if you want.
3. On the next page, click **uploading an existing file**.
4. Drag every file and folder from this package into the upload area. Commit.

**Path B — git from the terminal (if you're comfortable):**

```bash
cd field-manifest
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR-USERNAME/field-manifest.git
git push -u origin main
```

### Step 2: Connect Vercel

1. Sign in to vercel.com using your GitHub account.
2. Click **Add New → Project**.
3. Find your `field-manifest` repo and click **Import**.
4. **Crucial:** before clicking Deploy, expand **Environment Variables**. Add one:
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your real key (starts with `sk-ant-...`)
5. Click **Deploy**.

Vercel builds and deploys in about a minute. When it finishes you'll see a URL like `field-manifest-abc123.vercel.app`. That URL already works — the app is live.

### Step 3: Point your custom domain at it

1. In Vercel, go to your project → **Settings → Domains**.
2. Add `app.bootkamp.co` (or `manifest.bootkamp.co`, or whatever subdomain you prefer).
3. Vercel shows you the DNS records to add. They'll typically be one CNAME pointing to `cname.vercel-dns.com`.
4. Go to your domain registrar (wherever bootkamp.co's DNS is managed — likely Cloudflare, GoDaddy, or similar) and add that CNAME.
5. Wait 5–30 minutes for DNS to propagate. Vercel detects when it's ready and auto-issues a TLS certificate.

The app is now live at `app.bootkamp.co`.

### Step 4: Install it as an app on your phone

**On iPhone:**

1. Open Safari (must be Safari, not Chrome) and go to `app.bootkamp.co`.
2. Tap the share button (square with arrow), scroll down, tap **Add to Home Screen**.
3. Name it "Field Manifest" or just accept the default. Tap **Add**.

The icon now sits on your home screen. Tapping it opens the app in full-screen mode with no Safari chrome — looks and feels like a native app. Works offline for everything except the fuel planner.

**On Android:**

1. Open Chrome and go to `app.bootkamp.co`.
2. Chrome will show an "Install Field Manifest" banner near the address bar after a moment. Tap it.
3. Or: menu → Install app → Install.

---

## Embedding into the main bootkamp.co site

If you'd rather have it appear within your existing site (e.g. at `bootkamp.co/manifest`), the cleanest pattern is an iframe:

```html
<iframe
  src="https://app.bootkamp.co"
  style="width:100%; height:100vh; border:none;"
  allow="geolocation; clipboard-write"
></iframe>
```

PWA install prompts don't fire inside iframes, so for the best phone experience you'll still want to direct people to the bare subdomain. A common pattern: the iframe on desktop, a "install on phone" CTA on mobile pointing to the subdomain.

---

## Local development (optional, for tweaking)

If you want to make changes before deploying:

```bash
cd field-manifest
npm install
cp .env.local.example .env.local
# Edit .env.local and paste your real API key
npm run dev
```

Open http://localhost:3000 in your browser. Edits to any file hot-reload.

When you push changes to GitHub, Vercel automatically rebuilds and redeploys the live app within a minute. No manual deploy step.

---

## Customising

### Swap the brand colours

Open `components/FieldManifest.jsx`. Near the top there's a `C` object:

```js
const C = {
  bg: '#EFE3C2',      // cream background
  paper: '#FBF5E2',   // card backgrounds
  rust: '#A8471A',    // primary accent
  forest: '#26402F',  // secondary accent
  ochre: '#C58A2A',   // highlight
  ink: '#1C1813',     // text and dark surfaces
  ...
};
```

Change these to your real brand colours. Also update `theme_color` in `public/manifest.webmanifest` and `pages/_document.js` so the iOS status bar and Android task switcher match.

### Replace the app icon

Drop replacements into `public/icons/`:
- `icon-192.png` (192×192) — Android
- `icon-512.png` (512×512) — Android / PWA install
- `apple-touch-icon.png` (180×180) — iOS home screen
- `icon-32.png` and `icon-16.png` — favicons
- `icon.svg` — scalable fallback
- `og-image.png` (1200×630) — social share preview

The placeholders use the "FM" monogram on cream. Replace with your real brand mark — keep the cream background for cohesion or use your darker brand colour for a contrast variant.

### Wire the email capture to a real list

The email capture in the masthead currently just logs to console. To make it real, edit `components/FieldManifest.jsx`, search for `EmailCapture`, and replace the inner handler with a `fetch` call to your mail service (Klaviyo, ConvertKit, Mailchimp, etc.).

### Tune the fuel planner's prompt

The prompt that asks Claude for fuel stops is in `components/FieldManifest.jsx`, search for `buildPrompt`. Edit the wording, the schema, the rules — Claude will follow whatever you tell it. Want to bias toward independent stations over major chains? Add a rule. Want to surface roadhouse food quality alongside fuel price? Extend the schema and surface it in `StopCard`.

### Adjust the deep-link to your GVM calculator

Search for `bootkamp.co/gvm-calculator` in `components/FieldManifest.jsx`. Change if the URL moves.

---

## Costs

- **Vercel hosting:** $0/month on the Hobby tier. Sufficient unless you get serious traffic (>100 GB/month). Pro is $20/month if you need more, and is worth it for the higher serverless timeout (60s) which gives the fuel planner more headroom.
- **Anthropic API:** ~$0.01–0.02 per fuel route search (Claude Sonnet 4 with one web_search call). 1,000 searches/month ≈ $10–$20. Set spend limits in the Anthropic console if you want a hard cap.
- **Domain:** existing bootkamp.co covers it.

---

## What works offline (PWA caching)

Once a user has loaded the app once, the entire packing list, payload tracker, trip blueprints, journal, and saved fuel plans work fully offline. The service worker (auto-generated by `next-pwa`) caches the app shell + last-fetched assets.

The fuel planner needs network to fetch live prices — when offline it'll show the network error. Their saved fuel plans (from previous searches) remain readable offline.

---

## Troubleshooting

**"Couldn't plan that route. API: configuration_error"**
You forgot to add `ANTHROPIC_API_KEY` to Vercel's environment variables. Go to Vercel → project → Settings → Environment Variables, add it, then redeploy from the Deployments tab.

**Fuel search times out after 10 seconds**
You're on Vercel's free tier which caps function duration at 10s. The fuel search with web_search often needs 15-25s. Either upgrade to Pro ($20/mo, 60s cap) or switch the planner to streaming (more code change). Pro is the simpler path.

**PWA install prompt doesn't appear on Android**
Chrome requires the site to be served over HTTPS (Vercel does this automatically) and the manifest + service worker to be valid. If it doesn't appear, open Chrome DevTools on a laptop while viewing the site → Application tab → Manifest. Errors will be listed there.

**iOS shows the icon as a generic letter**
Your `apple-touch-icon.png` is missing or the wrong size. Must be exactly 180×180 PNG, no transparency.

**localStorage is cleared and saved data is lost**
This happens if the user clears Safari/Chrome site data. Consider adding a cloud-sync layer (Supabase free tier is the simplest fit) if you want data to persist across devices and reinstalls.

---

## Architecture notes

The component file is structured as one big functional React component (`FieldManifest`) that owns all state, plus dozens of presentational sub-components. State persists via the `window.storage` shim in `pages/_app.js`, which proxies to `localStorage`.

The fuel planner makes a single fetch to `/api/plan-route`, which on the server side authenticates with Anthropic and forwards the prompt + web search tool. The response (a JSON object with stops, coordinates, prices, advice) is rendered into the SVG route map plus the stop list.

The SVG map is intentionally hand-built rather than using Leaflet/Mapbox — no external tile servers, no API keys, no CDN dependencies, and it renders identically in any browser including the most locked-down PWA installs.

When you outgrow this single-file architecture, the natural split is:
1. Move trip blueprints into a CMS (Sanity, Contentful) so non-engineers can edit them.
2. Move the journal into Supabase or similar so it syncs across devices.
3. Split `FieldManifest.jsx` into `Pack`, `Payload`, `Blueprints`, `Journal`, `FuelPlanner` files with shared state in a Zustand store.

But that's all later — the current single-file form is fine until you're north of 10k users.

---

## Support

The code is yours. Edit it freely. The bits worth understanding before you change anything heavily:

- **Weights and quantities** in the packing list come from real touring research; tampering with them changes the payload calculator's accuracy.
- **The SVG topographic background pattern** is the visual signature — appears in the masthead, the payload card, the route map, and the journal. Removing it weakens the brand.
- **The "Fraunces italic" accents** carry the editorial feel. Keep the font pairing if you can — swap if you must, but pair a serif with character against a clean sans.

That's it. Ship it.
