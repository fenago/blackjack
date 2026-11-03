# Blackjack

A browser Blackjack game that deals real cards from the free [Deck of Cards API](https://deckofcardsapi.com/).
Plain HTML, CSS and JavaScript — no build step, no dependencies.

## How it uses the API

| Action | Endpoint |
| --- | --- |
| Open a shuffled 6-deck shoe | `GET /api/deck/new/shuffle/?deck_count=6` |
| Deal / hit / double / split | `GET /api/deck/<deck_id>/draw/?count=N` |
| Reshuffle at the cut card (75% penetration) | `GET /api/deck/<deck_id>/shuffle/` |
| Card images | `card.images.png`, face-down card `static/img/back.png` |

If a saved deck has expired (the API discards decks idle for two weeks), the game opens a new shoe automatically.

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
