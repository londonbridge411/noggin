# Noggin

A multiplayer guess-what's-on-your-forehead party game. Everyone plays on their own phone in a browser. It's fully static and runs on GitHub Pages.

**Play:** https://londonbridge411.github.io/noggin/

## How it works

Whoever taps **Create a new room** is the host. The game runs in the host's browser tab, and other players connect straight to it peer-to-peer over WebRTC. [PeerJS](https://peerjs.com/) and its free public server only introduce the phones to each other. There is no game server, so:

- The host needs to keep the tab open and the screen on. Use a PC or tablet as host if you can.
- Players can join from anywhere with internet, not just the same Wi-Fi.
- If the host refreshes, the room comes back, because it's saved in their browser. Guests reconnect on their own.
- Some strict networks (certain cellular carriers, corporate Wi-Fi) can block peer-to-peer connections. Switching that phone to Wi-Fi usually fixes it.

## Modes

**Hot Seat.** Players take turns as the guesser. The guesser's phone hides the card; everyone else sees it and gives clues. Anyone can tap **Got it** or **Pass**. Every correct card scores 1 point for the guesser.

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

Images load straight from their URL on each phone. Sites that block hotlinking won't display; the card then shows the URL.

## Running locally

It's plain static files, so any static server works:

```
python -m http.server 8000
```

Then open http://localhost:8000. You still need internet access for PeerJS.

## Files

- `index.html`, `style.css`: page and styling.
- `app.js`: screens, plus the host/guest networking.
- `game.js`: game rules (rooms, turns, scoring). Runs on the host only.
- `decks.js`: built-in decks. Add your own as `{ text }` or `{ text, img }` cards.
- `vendor/peerjs.min.js`: PeerJS 1.5.5.
