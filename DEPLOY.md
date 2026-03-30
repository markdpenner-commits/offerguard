# OfferGuard Deployment Guide
## What You Need Before Starting
1. An email address
2. A credit card (Vercel Pro is $20/month — required for the 120-second function timeout your PDF analysis needs)
3. An Anthropic API key (you'll create this below)

Total time: ~20 minutes

---

## STEP 1: Get Your Anthropic API Key

1. Go to https://console.anthropic.com
2. Create an account or sign in
3. Click "Settings" in the left sidebar, then "API Keys"
4. Click "Create Key"
5. Name it "OfferGuard"
6. Copy the key — it starts with `sk-ant-...`
7. Save it somewhere safe (you'll need it in Step 4)
8. Add credit to your account under "Billing" — $20 is plenty to start. Each offer analysis costs roughly $0.05-0.10

---

## STEP 2: Create a GitHub Account and Repository

1. Go to https://github.com and create an account (free)
2. Click the green "New" button (top left) to create a new repository
3. Name it `offerguard`
4. Set it to **Private**
5. Check "Add a README file"
6. Click "Create repository"

---

## STEP 3: Upload the Project Files to GitHub

1. In your new repository, click "Add file" then "Upload files"
2. Drag ALL of these files/folders from the deployment folder into the upload area:
   - `package.json`
   - `next.config.js`
   - `.env.local.example`
3. Click "Commit changes"

4. Now you need to create the folder structure. Click "Add file" then "Create new file"
5. In the filename box, type: `app/layout.js`
   - This creates the `app` folder automatically
   - Paste the contents of `app/layout.js` from the deployment folder
   - Click "Commit changes"

6. Repeat for each file:
   - `app/page.js`
   - `app/globals.css`
   - `app/api/extract/route.js` (typing the path creates nested folders)
   - `components/OfferGuard.jsx`

**Tip:** The most important file is `components/OfferGuard.jsx` — it's the entire app. Open it in a text editor (right-click > Open With > Notepad on Windows, TextEdit on Mac), select all, copy, and paste into GitHub's editor.

---

## STEP 4: Deploy on Vercel

1. Go to https://vercel.com and click "Sign Up"
2. Choose "Continue with GitHub" and authorize Vercel
3. You'll see your repositories — click "Import" next to `offerguard`
4. On the configuration page:
   - Framework Preset: should auto-detect "Next.js" — if not, select it
   - Leave everything else as default
5. **Before clicking Deploy**, expand "Environment Variables" and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: paste your `sk-ant-...` key from Step 1
   - Click "Add"
6. Click "Deploy"
7. Wait 1-2 minutes. Vercel will build and deploy your app
8. You'll get a URL like `offerguard-abc123.vercel.app`

---

## STEP 5: Upgrade to Vercel Pro

The free tier limits API calls to 10 seconds — your PDF analysis needs 30-60 seconds.

1. In Vercel, go to Settings > Billing
2. Upgrade to Pro ($20/month)
3. That's it — the 120-second timeout in the code will now work

---

## STEP 6: Test It

1. Open your Vercel URL in a browser
2. Enter your name, select form type and context
3. Upload a test PDF
4. The analysis should complete in 20-40 seconds — reliably, every time

---

## How to Update OfferGuard Later

When we make changes to the code:

1. I give you an updated `OfferGuard.jsx` file
2. Go to your GitHub repository
3. Navigate to `components/OfferGuard.jsx`
4. Click the pencil icon (edit)
5. Select all, delete, paste the new content
6. Click "Commit changes"
7. Vercel automatically rebuilds and deploys — takes about 60 seconds

---

## Custom Domain (Optional)

If you want `offerguard.royallepageprime.com` instead of the Vercel URL:

1. In Vercel, go to your project > Settings > Domains
2. Add your domain
3. Vercel will give you DNS records to add at your domain registrar
4. Follow the instructions — usually just adding a CNAME record

---

## Costs

- **Vercel Pro:** $20/month
- **Anthropic API:** ~$0.05-0.10 per offer analysis (~$5-10/month for 100 offers)
- **Total:** ~$25-30/month for unlimited agents

---

## Troubleshooting

**"ANTHROPIC_API_KEY not configured"** — Go to Vercel project > Settings > Environment Variables and make sure the key is added.

**Analysis times out** — Make sure you're on Vercel Pro. The free tier caps at 10 seconds.

**Build fails** — Check the build log in Vercel. Screenshot it and send it to me.

**PDF too large** — If a PDF is over 4MB, the analysis might fail. Most Manitoba OTP forms are 1-3MB.
