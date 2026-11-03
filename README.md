# Blackjack

A browser Blackjack game that deals real cards from the free [Deck of Cards API](https://deckofcardsapi.com/).
Plain HTML, CSS and JavaScript — no build step. Google sign-in uses Supabase Auth (`@supabase/supabase-js` from the jsDelivr CDN).

## How it uses the API

| Action | Endpoint |
| --- | --- |
| Open a shuffled 6-deck shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit / double / split | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle at the cut card (75% penetration) | `GET /api/deck/<deck_id>/shuffle/` |
| Card images | `card.images.png`, face-down card `static/img/back.png` |

If a saved deck has expired (the API discards decks idle for two weeks), the game opens a new shoe automatically.

## Google sign-in (Supabase)

Players sign in with Google through Supabase Auth before they reach the table. Once signed in, they're greeted by first name with their Google profile photo, and each account keeps its own bankroll.

Setup checklist:

1. **`config.js`**: paste your project's publishable key (`sb_publishable_...`) or legacy anon key into `SUPABASE_ANON_KEY` (Supabase → Project Settings → API Keys). This key is meant to be public.
2. **Supabase → Authentication → Sign In / Providers → Google**: enabled, with your Google OAuth client ID and secret.
3. **Google Cloud Console → OAuth client → Authorized redirect URIs**: `https://xpohmzyqtwqkwdmxgakg.supabase.co/auth/v1/callback`
4. **Supabase → Authentication → URL Configuration**: set **Site URL** to your Netlify URL (e.g. `https://your-site.netlify.app`) and add it under **Redirect URLs**. Add `http://localhost:8000/` too if you test locally.

## Player profiles

Signed-in players get a **Profile** tab where they create a profile (display name, unique `@username`, location, play style, bio; photo from Google) and can edit it later. New players see a red dot on the tab and a "Create your profile" link in the greeting.

Profiles live in the `public.profiles` table. To create it, run
[`supabase/migrations/20261103000000_create_profiles.sql`](supabase/migrations/20261103000000_create_profiles.sql)
once in Supabase → SQL Editor. Row-level security lets any signed-in player view profiles but only create or edit their own.

## Rules

- 6 decks, reshuffled when fewer than 78 cards remain
- Dealer stands on all 17s
- Blackjack pays 3:2, insurance pays 2:1 (offered when the dealer shows an Ace)
- Double down on any first two cards
- Split matching ranks up to 4 hands; split Aces get one card each
- Starting bank $1,000 (saved in your browser); rebuy when you run out

Keyboard: **Enter** deal · **H** hit · **S** stand · **D** double · **P** split

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploy to Netlify

Connect this repo in Netlify (or drag the folder into Netlify Drop). `netlify.toml` sets the publish directory to the repo root with no build command.
