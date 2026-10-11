# Money

A minimal, visual expense tracker in Thai Baht. Track daily spending, fixed costs and income with a daily/weekly graph, a calendar, a category pie chart and a monthly budget. Sign in to sync your data across your phone and computers.

Plain HTML, CSS and JavaScript, with no build step. The only outside code is the Supabase library, which handles sign-in and sync and loads from a CDN.

## Try it on your computer

Double-click `index.html`. It opens in your browser and works right away.

## Put it online

To use the app on your phone or other computers, host this folder as a website. All the options below are free and add **no logos or banners** to your page.

| Host | How you upload | Your address |
|---|---|---|
| **Cloudflare Pages** (recommended) | Drag and drop the folder | `your-name.pages.dev` |
| **Netlify** | Drag and drop the folder | `your-name.netlify.app` |
| **GitHub Pages** | Upload the files to a GitHub repository | `username.github.io/money-tracker` |

**Cloudflare Pages:**

1. Sign up at https://dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Pages → Upload assets**.
3. Enter a project name. It becomes your address, e.g. `pt-notes` gives `pt-notes.pages.dev`.
4. Drag in the **money-tracker** folder and click **Deploy**.

**Netlify:** sign up at https://app.netlify.com/signup, then drag the folder onto https://app.netlify.com/drop. You can rename the site under **Site configuration → Change site name**.

**GitHub Pages:** create a repository, upload these files, then go to **Settings → Pages → Deploy from branch → `main` / root**. On the free plan the repository, and so your code, is public. Your data stays private either way.

### Do I need to log in to open it?

No. You only log into the host once, to upload. After that, anyone with the address can open the site like any other website, including you on any device. You sign into the **app** once per device, and it remembers you after that.

### After publishing

1. In Supabase, go to **Authentication → URL Configuration**. Set **Site URL** to your site's address, and add the same address under **Redirect URLs**. This makes "Forgot password?" work.
2. Open the address on each device and sign in (**Settings → Sync across devices**).
3. On your phone, add it to your home screen so it opens like an app:
   - **iPhone (Safari):** Share → **Add to Home Screen**. Sign in again after opening it from the home screen; that copy doesn't share Safari's login.
   - **Android (Chrome):** ⋮ → **Add to Home screen** or **Install app**.

### Updating the site

Upload the folder again. On Cloudflare: open your project → **Create deployment** → drag in the folder. On Netlify: open your site → **Deploys** → drag in the folder. Your data isn't affected, because it lives in Supabase and not in the site files.

### Keeping it discreet

- **Pick a neutral address**, like `pt-notes`, so it doesn't reveal what the site is.
- **Hide it from search engines** by adding this line inside `<head>` in `index.html`, so only people with the address can find it:
  ```html
  <meta name="robots" content="noindex">
  ```
- **Visitors can't see your data.** Anyone who opens the site sees an empty app and a sign-in form; your entries need your password.

## Where your data lives

- **Signed in:** your data is saved on each device *and* in your Supabase account, and kept in sync automatically. Setup steps are in [SYNC-SETUP.md](SYNC-SETUP.md).
- **Not signed in:** data stays only in that browser. It survives closing the browser, but not clearing browsing data or using a private window. **Settings → Download backup** and **Restore backup** let you move it by hand.

You can export everything as a spreadsheet at any time with **Settings → Export CSV**.

## Files

- `index.html`: page structure
- `styles.css`: look and layout
- `app.js`: data, charts, calendar, settings, and merging data between devices
- `sync.js`: sign-in and syncing with Supabase
- `config.js`: your Supabase address and public key (leave empty to turn sync off)
- `manifest.webmanifest`, `icon.svg`: name and icon for "Add to Home Screen"
- `SYNC-SETUP.md`: how to set up Supabase
