# henryliang.ca

Source for my personal site. Static HTML, CSS and JavaScript — no build step,
no framework, no dependencies.

Currently the site publishes a single page: a case study on an **extinction
chess engine** I trained from scratch, with the engine playable in the browser.
The wider portfolio home page is still being written and isn't published yet.

## Run locally

```bash
python -m http.server 8791
```

Then open <http://localhost:8791/>. Port 8791 matters only because the backend
allowlists it for local development.

## Structure

```
index.html        The extinction chess case study (currently the site root)
css/style.css     Design tokens + shared styling. Change the three --accent
                  values at the top to reskin everything.
css/project.css   Case-study layout
css/chess.css     The playable board
js/main.js        Theme toggle, nav, scroll reveal, project filtering
js/chess.js       Board rendering, WebSocket client, post-game review
```

Light and dark themes are both defined; the site follows the visitor's OS
setting and the nav toggle overrides it.

## The playable engine

The board contains **no chess logic**. The server is authoritative and sends the
legal move list with every position, so this client only renders and forwards
clicks. That matters because the variant's rules are unusual — there's no
checkmate, you win by capturing every piece of any one type, and promoting a
pawn to a *king* is legal.

Moves go over a WebSocket to an AlphaZero-style network (20 residual blocks,
~24.5M parameters) running on a GPU that's allocated for the duration of a
game. The engine searches while you think, so its replies come off an already
deep tree.

The backend and training pipeline live in a separate repository.

## Deploying

Cloudflare Pages, connected to this repo. **No build command**, output
directory `/`.

Note: `css/chess.css` and `js/chess.js` are referenced with a `?v=N` query
string. Bump it when either changes, or browsers serve the cached copy.
