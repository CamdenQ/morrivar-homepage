# Morrivar.com

Blazing-fast static landing page for Morrivar’s social links, contact info, and theme toggle. The site is built with plain HTML/CSS/JS so it can deploy directly to GitHub Pages.

## Project Structure

- `index.html` — one-page layout (hero intro, social embeds, contact cards, and footer).
- `styles.css` — theme tokens, responsive layout, and button styling. Dark and light palettes mirror the red/charcoal logo.
- `script.js` — theme persistence, system-theme sync, newsletter form handling, and live Twitter/Tumblr embed updates.
- `assets/` — PNG brand marks used in the header and for palette reference.

## Local Development

```bash
# clone the repo
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>

# start a simple static server (choose any you prefer)
python3 -m http.server 8080
```

Open `http://localhost:8080` and the page will load. No build steps or dependencies required.

## Deployment

1. Create a GitHub repo (public if you’re on the free plan).
2. Push the project to `main`.
3. In **Settings → Pages**, enable Pages from the `main` branch, `/ (root)` folder.
4. Wait for the deploy—your site will publish at `https://<username>.github.io/<repo-name>/`.

## Customization Notes

- Update the contact copy or email addresses in `index.html` as needed.
- Brand colors are driven by CSS variables at the top of `styles.css`; adjust those to change the palette.
- To use a different logo asset, swap the `<img>` in the header and ensure it’s present under `assets/`.

## License

All rights reserved unless explicit permission is granted.
