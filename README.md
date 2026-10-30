# PlayLens

**See the whole play. Know your job.**

PlayLens is a football playbook web app for youth and middle school teams. Coaches import a playbook or snap photos of play sheets. Players pick a play, tap their position, and watch all 22 players move, with their own player highlighted and a "Your job" card that explains what to do.

It runs entirely in the browser and is hosted free on GitHub Pages. There is no build step: the files in this folder are the website.

---

## Put it on GitHub (about 10 minutes)

1. **Create a repository.** On github.com, click **New repository**. Name it `playlens`, make it **Public**, and click **Create repository**.
2. **Upload the files.** On the new repo page, click **uploading an existing file**. Drag in everything from this folder, including the `.github` folder, then click **Commit changes**.
   - On a Mac, the `.github` folder is hidden in Finder. Press `Cmd + Shift + .` to show hidden files before dragging.
   - If `.github` won't upload, create it by hand: **Add file → Create new file**, type `.github/workflows/deploy.yml` as the name, and paste in the contents of that file.
3. **Turn on GitHub Pages.** Go to **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. **Wait for the deploy.** Open the **Actions** tab. When the "Deploy to GitHub Pages" run shows a green check (1–2 minutes), your app is live at:

   `https://YOUR-USERNAME.github.io/playlens/`

Every time you change a file and commit to `main`, the site updates on its own.

### Run it on your own computer first (optional)

The app uses JavaScript modules, which don't work if you just double-click `index.html`. Start a tiny local server instead:

```bash
cd playlens
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

---

## How to use it

**Players**

1. Open the site and tap a play on the wristband list.
2. Tap your position (on the field or in the list of buttons).
3. Read the goal and your job card, then press play. Use **0.25×** to slow it down and the step buttons to stop at key moments (snap, handoff, throw, catch).
4. Switch the defensive front to see how the play looks against different defenses.
5. Press **Test yourself** for a two-question quiz.

On phones the field starts in **Close up**, centered on your player. Tap **Whole play** to see everyone.

**Coaches**

1. Click **Coach tools** at the top to show import and editing tools.
2. **Import a playbook:** PDF, PowerPoint (.pptx), Word (.docx), photos, or a PlayLens `.json` file. Each page or picture becomes a draft play.
3. **Snap a play sheet:** opens the camera on a phone or tablet.
4. Every draft opens in the **editor** next to the original sheet:
   - **Draw route:** pick a player, then tap the field to add route points.
   - **Move players:** drag a player to where he lines up.
   - **Ball:** choose handoff, pitch, or pass, who gets it, and when.
   - **Your job** boxes are optional. Leave them blank and PlayLens writes kid-friendly text for you.
5. Click **Save play**. Saved plays show up for players.
6. To share with the team, go to **Settings → Download playbook file**. Players import that file on their own device from the Import screen.

**Automatic play reading.** In Settings, paste an Anthropic API key. From then on, every sheet you upload or photograph is read automatically. PlayLens places all 11 offensive players, follows every drawn route (including curved and pulling paths), sets up the toss, handoff, or pass at the right moment, and uses the defenders drawn on the sheet as the starting defense. You check the result in the editor and press **Save play**. The key is stored only in that browser, so use it on the coach's device only, never on players' devices.

---

## What's in the folder

| File | What it does |
| --- | --- |
| `index.html` | The page shell: top bar and the spot where screens are drawn |
| `css/styles.css` | All the styling. Colors are at the top as variables |
| `js/main.js` | Starts the app, picks the screen from the address bar, and draws the playbook, play viewer, quiz, import, and settings screens |
| `js/data.js` | Formations, position names, the sample playbook, and the code that writes "Your job" text |
| `js/sim.js` | The math: where each player and the ball are at any moment, and the defense generator |
| `js/field.js` | Draws the field, players, routes, and ball as SVG |
| `js/editor.js` | The coach's play editor |
| `js/importer.js` | Turns PDFs, slides, Word files, and photos into draft plays |
| `js/ai.js` | Sends a play sheet picture to Claude and gets back the players and routes |
| `js/reader.js` | Turns that reading into a playable play: route timing, ball timing, sheet defense |
| `js/store.js` | Saves plays and progress in the browser (IndexedDB) so it works offline |
| `js/util.js` | Small helpers |
| `sw.js` | Service worker: caches the app for offline use |
| `manifest.webmanifest` | Lets people "Add to Home Screen" like an app |
| `.github/workflows/deploy.yml` | Publishes the site to GitHub Pages on every commit |

**Good first changes to try**

- Add a play by copying one of the `buildPlay({...})` blocks at the bottom of `js/data.js`.
- Add a defense to `FRONTS` in `js/sim.js` (it needs 11 players total: linemen + linebackers + 2 corners + safeties).
- Change the team colors in the `:root` block at the top of `css/styles.css`.

After you change files, bump `CACHE = 'playlens-v1'` to `v2` in `sw.js` so phones pick up the new version.

**How plays are stored.** Positions are in yards. `x` is left (−) or right (+) of the ball; `y` is distance from the line of scrimmage (downfield is +). Each route point is `[x, y, t]`, where `t` goes from 0 (snap) to 1 (end of play).

---

## Requirements coverage

This build covers the MVP ("Must") items from the PlayLens requirements doc, with a few gaps that need a backend.

| Area | Status |
| --- | --- |
| Import PDF, PowerPoint, Word, images; split into one play per page | Done |
| Photo capture with contrast boost | Done (auto-crop and straightening not yet) |
| Recognize players and routes from a photo | Automatic on upload with the coach's API key; otherwise the coach places players in the editor |
| Review editor beside the original sheet | Done |
| Animate all 22 players, play/pause/step, speed, ball path | Done |
| Auto-generated defense from 5 youth fronts, marked as an example | Done |
| Pick your position, highlight, "Your job" card, play goal | Done |
| Quiz | Done (Phase 2 item, included early) |
| Offline and Add to Home Screen | Done |
| Team join codes, coach accounts, progress visible to the coach | **Not yet.** Needs the hosted backend from the doc (e.g., Supabase). For now, share plays with the playbook file |

### Next steps

1. Add a Supabase project for coach logins, team join codes, and shared playbooks.
2. Move the AI call into a Supabase Edge Function so no one needs their own key.
3. Pilot with one or two local teams and tune the photo reading on real play sheets.
