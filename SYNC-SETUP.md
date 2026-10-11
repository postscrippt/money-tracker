# Setting up sync

Sync stores your data in your own free Supabase database. You sign in with the same email and password on each device and see the same data everywhere. No email setup is needed.

Steps 1–4 are a one-time setup in Supabase, about 10 minutes.

## 1. Create a Supabase project

1. Sign up at https://supabase.com. A free account is enough.
2. Click **New project**. Give it any name (e.g. `money`), create a database password (you won't need it again), and pick the region **Southeast Asia (Singapore)**, the closest one to Thailand.
3. Wait a minute or two while it sets up.

## 2. Create the table

Open **SQL Editor** in the left sidebar, paste in everything below, and click **Run**:

```sql
create table public.money_data (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  doc        jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Only you can see or change your own row.
alter table public.money_data enable row level security;
create policy "read own"   on public.money_data for select using ((select auth.uid()) = user_id);
create policy "insert own" on public.money_data for insert with check ((select auth.uid()) = user_id);
create policy "update own" on public.money_data for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own" on public.money_data for delete using ((select auth.uid()) = user_id);

-- Lets your other devices update right away when something changes.
alter publication supabase_realtime add table public.money_data;
```

You should see "Success. No rows returned".

## 3. Connect the app

1. In Supabase, open **Project Settings → API** (in newer dashboards: **Project Settings → Data API** and **API Keys**).
2. Copy the **Project URL** and the **anon / public** key. **Don't** use the `service_role` key: it gives full access to the database.
3. Paste them into `config.js` in this folder:

```js
window.MONEY_CONFIG = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

The anon key is meant to be public. The rules from step 2 make sure each signed-in person can only reach their own data.

## 4. Turn off email confirmation

By default, Supabase emails a confirmation link to every new account. Turn that off so no email is needed:

1. Open **Authentication → Sign In / Providers** (in some versions **Providers → Email**).
2. Turn off **Confirm email**, then click **Save**.

## 5. Create your account

1. Open the app (double-click `index.html`).
2. Go to **Settings → Sync across devices → New here? Create an account**.
3. Enter your email and a password (8+ characters), then click **Create account**.

Once it works, your email appears in Settings with "Synced at …", and the **Settings** button has a green dot.

## 6. Test it on your computer

Use two different browsers (e.g. Edge and Chrome) to act as two devices:

1. In the first browser, add a few expenses. In Supabase, **Table Editor → money_data** should now show one row.
2. Open `index.html` in the second browser (drag the file into it), go to **Settings → Sign in** and use the same email and password. Your entries appear within a few seconds.
3. With both open, add an expense in one: it appears in the other. Delete it in the other: it disappears from the first.

## 7. Use it on your other devices

Put the site online and sign in on each device. See **Put it online** in [README.md](README.md). Then, in Supabase, go to **Authentication → URL Configuration**, set **Site URL** to your site's address and add it under **Redirect URLs**. This makes "Forgot password?" work.

## 8. Lock it down

Once you've signed in on all your devices, go to **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**. Your site is public, so this stops strangers from creating accounts in your project. They couldn't see your data, but they could use up your free plan.

## How syncing behaves

- The first device you sign in on uploads the data it already has.
- A device that hasn't been used yet just downloads your data.
- If two devices both already had entries, they're combined.
- The dot on the **Settings** button shows the status: green means synced, orange means syncing, red means offline or a problem.
- **Offline:** the app keeps working without internet. Changes are saved on the device and sync when you're back online.
- **Signing out** removes the data from that device only. It stays in your account, and signing back in brings it back.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Account created, but Supabase wants it confirmed by email first" | **Confirm email** is still on (step 4). Turn it off, then use **Sign in**; don't create the account again. |
| "Wrong email or password" | Check for typos. If you've forgotten it, use **Forgot password?** (needs step 7 first). |
| "Sync isn't set up yet" in Settings | `config.js` is empty or has a typo (step 3). |
| Red dot / "Couldn't sync" | Check your internet. If it continues, your Supabase project may be paused (see below). |

## Good to know

- **Free projects pause after about a week with no use.** Your data is kept. If it happens, open the Supabase dashboard and click **Restore project**. Using the app regularly keeps it awake.
- **Password resets** use Supabase's built-in email, which sends only a few emails per hour. That's plenty for occasional resets.
