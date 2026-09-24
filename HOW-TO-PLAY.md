# How to play Port Solmar on your PC

## The easy way (Windows)

1. Install **Node.js**: go to https://nodejs.org, click the big **LTS** button, run the installer (Next, Next, Finish).
2. Double-click **`Start Game.bat`** in this folder.
   - The first time, it installs the game's libraries (1–2 minutes).
   - Your browser opens the game at http://localhost:5173.
3. Keep the black window open while you play. Close it to stop the game.

On macOS or Linux, run `./start-game.sh` in a terminal instead.

## The manual way

Open a terminal in this folder (in File Explorer, click the address bar, type `cmd`, press Enter) and run:

```
npm install
npm run dev
```

Then open http://localhost:5173 in Chrome or Edge.

## Controls

| Key | Action |
|---|---|
| Click | Look around with the mouse |
| W A S D | Fly |
| E / Q | Up / down |
| Shift | Faster |
| Mouse wheel | Change flying speed |
| 1 – 9 | Jump to photo spots |
| [ and ] | Earlier / later time of day (hold T to fast-forward) |
| M | Full map |
| O | Change graphics quality |
| F3 | Performance stats |
| F2 | Save a screenshot |

## If something goes wrong

- **"npm is not recognized"**: Node.js isn't installed, or the window was opened before installing it. Close the window and try again, or restart your PC.
- **"running scripts is disabled"**: you're in PowerShell. Use `cmd` or `Start Game.bat` instead.
- **Black or blank page**: use Chrome or Edge and update your graphics driver. The first load takes about 10 seconds while the city is generated.
- **Slow**: press O to lower the quality.
