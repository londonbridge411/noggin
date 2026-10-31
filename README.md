# Noggin

A multiplayer guess-what's-on-your-forehead party game. Everyone plays on their own phone in a browser. It's hosted on Vercel.

**Play:** https://noggin-omega.vercel.app/

## How it works

Whoever taps **Create a new room** is the host: they pick the settings and start games. The game itself runs on the server, so:

- Nobody has to keep a tab open. If the host leaves, the next player becomes host.
- Anyone can refresh or lock their phone and pick up where they left off.
- Players can join from anywhere with internet, not just the same Wi-Fi.
- Rooms are deleted after 6 hours without activity, or when everyone leaves.

Phones check in with the server about once a second, so other players see a change within about a second.

## Modes

**Hot Seat.** Players take turns as the guesser. The guesser's phone hides the card; everyone else sees it and gives clues. The guesser taps **Got it** or **Pass** on their own phone. Every correct card scores 1 point for the guesser.

**Mystery Guest.** Everyone gets a secret card and can see everyone's card but their own. Take turns asking yes/no questions. When someone says their answer, another player taps **They got it** on that player's card. Solving first scores the most points (number of players, then one fewer, and so on, minimum 1).

## Cards: names or images

- **Built-in name decks:** Animals, Food & Drink, Famous People, Characters, Fantasy & D&D, Everyday Objects, Act It Out.
- **Built-in picture decks:** World Landmarks and Famous Paintings (Wikimedia Commons), Emoji Pictures (Twemoji).
- **Custom cards:** the host pastes one card per line in the lobby:

```
Gandalf                                   <- a name
https://example.com/owlbear.png           <- an image (clue-givers see only the picture)
Strahd | https://example.com/strahd.jpg   <- an image with its answer shown underneath
# lines starting with # are ignored
```

Tap **Preview decks** (on the home screen or in the lobby) to browse every card in a deck, pictures included. A picture that fails to load is flagged there, which makes broken links easy to spot.

Images load straight from their URL on each phone. Sites that block hotlinking won't display; the card then shows the URL.

## Deploying

Vercel serves the static files and runs `api/room.js` as a function. Rooms are stored in Upstash Redis:

1. In the Vercel project, open **Storage**, add **Upstash Redis** (the free plan is fine), and connect it to the project. Vercel adds its URL and token as environment variables.
2. Redeploy.

Each deploy runs `npm run build` (`scripts/stamp.js`). It stamps the commit ID onto `app.js`, `decks.js` and `style.css` in `index.html` so phones can't keep old cached copies, and gives the server the same ID. A phone still running an older version reloads itself on the home screen, in the lobby, or at final scores, never mid-game. Locally the ID is just `dev`.

The function reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the `KV_REST_API_URL` and `KV_REST_API_TOKEN` names some Vercel integrations use. A night of play with eight phones uses roughly 50,000 Redis commands, which fits within Upstash's free monthly allowance a few times over.

## Files

- `index.html`, `style.css`: page and styling.
- `app.js`: screens, plus talking to the server.
- `api/room.js`: the server endpoint. Creates and joins rooms, applies actions, answers polls.
- `lib/game.js`: game rules (rooms, turns, scoring). Runs on the server only.
- `decks.js`: built-in decks, used by both the server and the lobby screen. Add your own as `{ text }` or `{ text, img }` cards.
