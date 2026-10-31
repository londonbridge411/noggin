# Noggin

A multiplayer guess-what's-on-your-forehead party game. Everyone plays on their own phone in a browser.

## Running it

1. Double-click `start.bat`, or run `node server.js` (Node 18+; no `npm install` needed).
2. The first time, Windows Firewall asks about Node.js. Allow it on **private networks** or phones won't be able to connect.
3. Create a room on the PC. The lobby shows the link (e.g. `http://192.168.0.3:3000/?room=ABCD`) for phones on the same Wi-Fi.

To use a different port, run `set PORT=4000 && node server.js`.

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

Image URLs load straight from their source on each phone, so every phone needs internet access for picture cards. Hosts that block hotlinking won't display; the card then shows the URL.

## Files

- `server.js`: game server (rooms, turns, scoring). State lives in memory, so restarting ends all rooms.
- `decks.js`: built-in decks. Add your own here as `{ text }` or `{ text, img }` cards.
- `public/`: the phone UI.
