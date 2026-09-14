# Personal Website

A static portfolio site — plain HTML, CSS and JavaScript. No build step, no
dependencies, no framework. Edit a file, refresh the browser, done.

---

## Run it locally

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

You can also just double-click `index.html`, but the local server is closer to
how it'll behave once deployed.

---

## Files

```
index.html        Home page — hero, work, about, experience, contact
project.html      Case-study template (copy it once per project)
css/style.css     All shared styling. Design tokens live at the top.
css/project.css   Extra styling used only by case-study pages
js/main.js        Theme toggle, mobile nav, scroll reveal, tag filter
img/              Placeholder graphics — replace with real screenshots
```

---

## Filling in your content

Every spot that needs your input is marked `TODO` in the HTML, and placeholder
copy is wrapped in `[square brackets]` or `<em>` tags. Search the project for
`TODO` to find them all.

Work through these in order:

1. **`index.html` `<head>`** — title, description, and the social preview tags.
2. **Hero** — your name, one-line pitch, and status.
3. **Links** — replace every `yourusername` with your real handles.
4. **Projects** — see below.
5. **About / Experience** — bio, skills, roles.
6. **`img/portrait.svg`** — swap in a real photo and update the `src`.

### Adding a project

In `index.html`, copy one `<article class="card">` block and edit it. Two things
matter:

- `data-tags="web tooling"` — space-separated. Each word must match a
  `data-filter` value on one of the filter pills above the grid.
- The `href` should point at that project's case-study page.

To add a new filter category, add a pill in the `#filters` block and use the
same word in a card's `data-tags`. The JavaScript picks it up automatically.

### Adding a case study

Copy `project.html` to something like `project-acme.html`, fill it in, then
update the matching card's `href` in `index.html`.

---

## Restyling

Nearly everything is driven by the custom properties at the top of
`css/style.css`. To change the whole site's color, edit these three:

```css
--accent-1: #7c5cff;
--accent-2: #c04bff;
--accent-3: #ff4d7d;
```

Type sizes use `clamp()` and scale with the viewport, so there are no separate
mobile font sizes to maintain. Fonts are set via `--font-display` and
`--font-body`; if you change them, update the Google Fonts `<link>` in each
HTML file's `<head>` too.

Light and dark themes are both defined. The site follows the visitor's OS
setting by default, and the toggle in the nav overrides it and remembers the
choice in `localStorage`.

---

## Before you go live

- [ ] Replace all `TODO` markers and `[bracketed]` placeholder text
- [ ] Swap the placeholder images for real screenshots
- [ ] Add `resume.pdf` to the project root, or delete the Résumé nav link
- [ ] **Export `img/og-image.svg` as a PNG** and point the `og:image` meta tag
      at it — most social platforms won't render an SVG preview
- [ ] Check it on a phone, and tab through it with the keyboard
- [ ] Run it through [PageSpeed Insights](https://pagespeed.web.dev/)

---

## Deploying

All three options below are free and serve static files directly.

### GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOURUSERNAME/YOURREPO.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` /
(root)**. It'll be live at `https://YOURUSERNAME.github.io/YOURREPO/` in a
minute or two.

Naming the repo `YOURUSERNAME.github.io` serves it from the root domain instead.

### Netlify or Cloudflare Pages

Connect the repo and deploy. Leave the build command empty and set the publish
directory to `/`. Both give you a free subdomain and handle HTTPS.

### Custom domain

Buy a domain, point it at your host per their DNS instructions, and enable
HTTPS. On GitHub Pages you also add a `CNAME` file containing your domain.

---

## Browser support

Targets current versions of Chrome, Firefox, Safari and Edge. Uses
`color-mix()`, `clamp()`, container-free fluid type, and `IntersectionObserver`.
The scroll animations degrade to plain visible content if `IntersectionObserver`
is missing, and are disabled entirely for visitors who set
`prefers-reduced-motion`.
