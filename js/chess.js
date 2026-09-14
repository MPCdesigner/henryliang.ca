/* ═══════════════════════════════════════════════════════════════════════
   Playable extinction chess board.

   The server is authoritative: it ships the legal move list with every
   state message, so this file contains NO chess rules. It renders the
   board, collects clicks, and forwards them.

   Protocol (see web_play.py):
     ->  {type:"new_game", human_color, base, increment, sim_ceiling}
     ->  {type:"move", from, to, promotion}
     ->  {type:"resign"}
     <-  {type:"state", board, to_move, legal, counts, clocks, game_over}
     <-  {type:"engine_move", from, to, promotion, analysis}
     <-  {type:"thinking", sims, ceiling}
     <-  {type:"error", message}
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Persistent endpoint from `modal deploy web_play.py`. Do NOT point this
  // at a `modal serve` URL — those end in -dev.modal.run and die with the
  // local process, which surfaces here as "connection failed".
  // Redeploy with: modal deploy web_play.py   (URL stays the same)
  var ENDPOINT = 'wss://henryliang416525--extinction-chess-web-web.modal.run/play';

  var boardEl = document.getElementById('pl-board');
  if (!boardEl) return;   // not on this page

  var newBtn = document.getElementById('pl-new');
  var resignBtn = document.getElementById('pl-resign');
  var levelSel = document.getElementById('pl-level');
  var colorSel = document.getElementById('pl-color');
  var statusEl = document.getElementById('pl-status');
  var trackerEl = document.getElementById('pl-tracker');
  var clockTop = document.getElementById('pl-clock-top');
  var clockBot = document.getElementById('pl-clock-bot');
  var promoEl = document.getElementById('pl-promo');
  var promoOpts = document.getElementById('pl-promo-opts');
  var analysisBody = document.getElementById('pl-analysis-body');

  // Solid glyphs for both colours; CSS supplies the colour (see chess.css).
  var GLYPH = { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' };
  var ORDER = ['P', 'N', 'B', 'R', 'Q', 'K'];

  // Each tier needs a clock big enough that its sim ceiling is actually
  // reachable. The server's per-move budget is roughly remaining/30 +
  // increment, so a ceiling that costs more seconds than that will be cut
  // short by the deadline and never land. Measured ~480 sims/sec end-to-end:
  //   800 -> ~1.7s,  2000 -> ~4.2s,  8000 -> ~17s
  var TIERS = {
    800:  { base: 180, inc: 2 },   // budget ~8s   at start, ample for 1.7s
    2000: { base: 300, inc: 3 },   // budget ~13s  at start, ample for 4.2s
    8000: { base: 600, inc: 10 }   // budget ~30s; +10s/move offsets the ~17s
  };                                // spend so the ceiling still lands late on

  var endangEl = document.getElementById('pl-endang');
  var endangKeyEl = document.getElementById('pl-endang-key');
  var reviewEl = document.getElementById('pl-review');
  var movelistEl = document.getElementById('pl-movelist');
  var prevBtn = document.getElementById('pl-prev');
  var nextBtn = document.getElementById('pl-next');
  var liveBtn = document.getElementById('pl-live');

  // Post-game review. history[0] is the starting position; history[k] is the
  // position after ply k, carrying the move that produced it and the engine's
  // analysis of the position it was played from.
  var history = [];
  var pending = null;       // {side, move, analysis} awaiting its state message
  var reviewIdx = null;     // null = live board
  var reviewMax = 0;        // last index that actually has a move

  var ws = null;
  var state = null;         // last server state
  var humanColor = 'white';
  var selected = null;      // from-square while picking a destination
  var lastMove = null;      // {from,to} for highlighting
  var pendingPromo = null;  // {from,to,options[]}
  var clockTimer = null;
  var clockBase = null;     // {white,black,at} for smooth local ticking

  // ── Board construction (built once, then updated in place) ───────────
  var squares = {};
  function buildBoard() {
    boardEl.innerHTML = '';
    squares = {};
    var flip = humanColor === 'black';
    for (var i = 0; i < 64; i++) {
      // rank 7..0 top-to-bottom for white; reversed for black
      var row = flip ? Math.floor(i / 8) : 7 - Math.floor(i / 8);
      var col = flip ? 7 - (i % 8) : i % 8;
      var name = 'abcdefgh'[col] + (row + 1);

      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'sq' + ((row + col) % 2 === 0 ? ' sq--dark' : '');
      el.dataset.sq = name;
      el.setAttribute('aria-label', name);
      el.addEventListener('click', onSquare);
      boardEl.appendChild(el);
      squares[name] = el;
    }
  }

  function legalFrom(sq) {
    if (!state || !state.legal) return [];
    return state.legal.filter(function (m) { return m.from === sq; });
  }

  function viewState() {
    return reviewIdx === null ? state : (history[reviewIdx] || {}).state;
  }

  function isMyTurn() {
    return reviewIdx === null && state && !state.game_over
           && state.to_move === humanColor;
  }

  // ── Rendering ────────────────────────────────────────────────────────
  function render() {
    var s = viewState();
    if (!s) return;
    var occupied = {};

    // When reviewing, highlight the move that PRODUCED this position.
    var hl = reviewIdx === null ? lastMove
           : (history[reviewIdx] || {}).move || null;

    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var name = 'abcdefgh'[f] + (r + 1);
        var el = squares[name];
        if (!el) continue;
        var p = s.board[r][f];
        occupied[name] = p;
        el.innerHTML = p
          ? '<span class="pc pc--' + p[0] + '">' + GLYPH[p[1]] + '</span>'
          : '';
        // Rebuild from the base class rather than stripping known modifiers.
        // Stripping meant every new modifier had to be added to a regex, and
        // forgetting one left it stuck on the square forever — which is what
        // happened to the endangered rings. Resetting can't drift.
        el.className = 'sq' + ((r + f) % 2 === 0 ? ' sq--dark' : '');
      }
    }

    if (hl) {
      [hl.from, hl.to].forEach(function (sq2) {
        if (squares[sq2]) squares[sq2].className += ' sq--last';
      });
    }

    if (endangEl.checked) {
      var marks = endangeredSquares(s);
      Object.keys(marks).forEach(function (sq2) {
        if (squares[sq2]) {
          squares[sq2].className += ' sq--endang sq--endang-' + marks[sq2];
        }
      });
    }

    if (isMyTurn()) {
      // squares the player can pick up
      var froms = {};
      s.legal.forEach(function (m) { froms[m.from] = true; });
      Object.keys(froms).forEach(function (s) {
        if (squares[s]) squares[s].className += ' sq--playable';
      });

      if (selected && squares[selected]) {
        squares[selected].className += ' sq--sel';
        legalFrom(selected).forEach(function (m) {
          var t = squares[m.to];
          if (!t) return;
          if (t.className.indexOf('sq--to') === -1) {
            t.className += ' sq--to' + (occupied[m.to] ? ' sq--cap' : '');
          }
        });
      }
    }

    renderTracker();
    renderClocks();
  }

  // "Endangered" == exactly one left, matching the engine's own definition
  // (ExtinctionChess.get_endangered_pieces), which is also what feeds input
  // plane 109. Keeps the board, the tracker and the network in agreement.
  function endangeredSquares(s) {
    var out = {};
    if (!s || !s.counts) return out;
    ['white', 'black'].forEach(function (side) {
      var types = ORDER.filter(function (t) { return s.counts[side][t] === 1; });
      if (!types.length) return;
      var pfx = side === 'white' ? 'w' : 'b';
      var tag = side === humanColor ? 'mine' : 'foe';
      for (var r = 0; r < 8; r++) {
        for (var f = 0; f < 8; f++) {
          var p = s.board[r][f];
          if (p && p[0] === pfx && types.indexOf(p[1]) !== -1) {
            out['abcdefgh'[f] + (r + 1)] = tag;
          }
        }
      }
    });
    return out;
  }

  function renderTracker() {
    var state = viewState();          // shadow: tracker follows the review
    if (!state || !state.counts) return;
    var html = '<span class="tracker__lbl"></span>';
    ORDER.forEach(function (t) {
      html += '<span class="tracker__hd">' + GLYPH[t] + '</span>';
    });
    ['white', 'black'].forEach(function (side) {
      var label = side === humanColor ? 'You' : 'Engine';
      html += '<span class="tracker__lbl">' + label + '</span>';
      ORDER.forEach(function (t) {
        var n = state.counts[side][t];
        var cls = n === 0 ? ' tracker__c--gone' : (n === 1 ? ' tracker__c--danger' : '');
        html += '<span class="tracker__c' + cls + '">' + n + '</span>';
      });
    });
    trackerEl.innerHTML = html;
  }

  function fmt(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function renderClocks() {
    if (!clockBase) return;
    var elapsed = (Date.now() - clockBase.at) / 1000;
    var running = state && !state.game_over ? state.to_move : null;
    var w = clockBase.white - (running === 'white' ? elapsed : 0);
    var b = clockBase.black - (running === 'black' ? elapsed : 0);

    var mine = humanColor === 'white' ? w : b;
    var theirs = humanColor === 'white' ? b : w;

    clockBot.querySelector('.clock__t').textContent = fmt(mine);
    clockTop.querySelector('.clock__t').textContent = fmt(theirs);
    clockBot.className = 'clock' + (running === humanColor ? ' clock--active' : '') + (mine < 30 ? ' clock--low' : '');
    clockTop.className = 'clock' + (running && running !== humanColor ? ' clock--active' : '') + (theirs < 30 ? ' clock--low' : '');
  }

  function setStatus(msg, cls) {
    statusEl.className = 'status' + (cls ? ' status--' + cls : '');
    statusEl.innerHTML = msg;
  }

  // ── Interaction ──────────────────────────────────────────────────────
  function onSquare(e) {
    if (!isMyTurn() || pendingPromo) return;
    var sq = e.currentTarget.dataset.sq;

    if (selected) {
      var moves = legalFrom(selected).filter(function (m) { return m.to === sq; });
      if (moves.length === 1 && !moves[0].promotion) {
        send({ type: 'move', from: selected, to: sq, promotion: null });
        selected = null;
        render();
        return;
      }
      if (moves.length >= 1) {
        // Promotion — extinction chess allows promoting to KING, so the
        // options come from the server rather than a hardcoded list.
        askPromotion(selected, sq, moves);
        return;
      }
    }
    selected = legalFrom(sq).length ? sq : null;
    render();
  }

  function askPromotion(from, to, moves) {
    pendingPromo = { from: from, to: to };
    promoOpts.innerHTML = '';
    moves.forEach(function (m) {
      if (!m.promotion) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = GLYPH[m.promotion];
      b.title = m.promotion;
      b.addEventListener('click', function () {
        send({ type: 'move', from: from, to: to, promotion: m.promotion });
        pendingPromo = null;
        promoEl.hidden = true;
        selected = null;
        render();
      });
      promoOpts.appendChild(b);
    });
    promoEl.hidden = false;
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ── Connection ───────────────────────────────────────────────────────
  function newGame() {
    humanColor = colorSel.value;
    buildBoard();
    state = null;
    selected = null;
    lastMove = null;
    clockBase = null;
    history = [];
    pending = null;
    reviewIdx = null;
    reviewEl.hidden = true;
    movelistEl.innerHTML = '';
    analysisBody.innerHTML = '<p class="analysis__empty">No move yet.</p>';

    newBtn.disabled = true;
    levelSel.disabled = true;
    colorSel.disabled = true;
    setStatus('Waking the engine… first game of the day takes ~15s while a GPU spins up.');

    if (ws) { try { ws.close(); } catch (e) {} }
    ws = new WebSocket(ENDPOINT);

    ws.onopen = function () {
      setStatus('Connected. Starting game…');
      var ceiling = parseInt(levelSel.value, 10);
      var tier = TIERS[ceiling] || { base: 300, inc: 3 };
      send({
        type: 'new_game',
        human_color: humanColor,
        base: tier.base,
        increment: tier.inc,
        sim_ceiling: ceiling
      });
      resignBtn.disabled = false;
    };

    ws.onmessage = function (ev) { onMessage(JSON.parse(ev.data)); };

    ws.onerror = function () {
      // Distinguish "backend is gone" from "backend is busy" — a WebSocket
      // error event carries no detail, so probe the HTTP health route.
      fetch(ENDPOINT.replace(/^wss:/, 'https:').replace(/\/play$/, '/health'))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function () {
          setStatus('Engine is reachable but the game socket was refused — it may be at ' +
                    'capacity (' + 'max concurrent games' + '). Try again shortly.', 'lose');
        })
        .catch(function () {
          setStatus('Cannot reach the engine. It is probably not deployed — run ' +
                    '<code>modal deploy web_play.py</code> and check the endpoint in ' +
                    'js/chess.js.', 'lose');
        });
    };

    ws.onclose = function () {
      newBtn.disabled = false;
      levelSel.disabled = false;
      colorSel.disabled = false;
      resignBtn.disabled = true;
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      if (state && !state.game_over) {
        setStatus('Disconnected. Press <strong>New game</strong> to start again.');
      }
    };
  }

  // ── Review ───────────────────────────────────────────────────────────
  function fmtEval(v) {
    if (typeof v !== 'number') return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  function buildMovelist() {
    var html = '';
    for (var i = 1; i < history.length; i++) {
      var h = history[i];
      if (!h.move) continue;
      var mv = h.move.from + '→' + h.move.to + (h.move.promotion ? '=' + h.move.promotion : '');
      var a = h.analysis;
      // Flag your moves the engine wouldn't have played.
      var diff = a && a.engine_would_play &&
                 (a.engine_would_play.from !== h.move.from ||
                  a.engine_would_play.to !== h.move.to);
      html += '<li data-i="' + i + '" class="' + (h.side === 'you' ? 'is-you' : '') + '">' +
              '<span class="movelist__n">' + i + '</span>' +
              '<span class="movelist__mv">' + (h.side === 'you' ? '' : '· ') + mv +
              (diff ? ' <span class="movelist__flag" title="engine preferred ' +
                      a.engine_would_play.from + '→' + a.engine_would_play.to + '">≠</span>' : '') +
              '</span>' +
              '<span class="movelist__ev">' + (a ? fmtEval(a.value) : '—') + '</span></li>';
    }
    movelistEl.innerHTML = html || '<li><span></span><span>No moves.</span><span></span></li>';
  }

  function showReviewAt(i) {
    reviewIdx = Math.max(0, Math.min(reviewMax, i));
    selected = null;
    var rows = movelistEl.querySelectorAll('li[data-i]');
    for (var k = 0; k < rows.length; k++) {
      var on = parseInt(rows[k].dataset.i, 10) === reviewIdx;
      rows[k].className = rows[k].className.replace(/ ?is-sel/, '') + (on ? ' is-sel' : '');
      if (on && rows[k].scrollIntoView) rows[k].scrollIntoView({ block: 'nearest' });
    }
    prevBtn.disabled = reviewIdx <= 0;
    nextBtn.disabled = reviewIdx >= reviewMax;

    var h = history[reviewIdx] || {};
    if (h.analysis) {
      renderAnalysis(h.analysis, h.move, h.side);
    } else if (h.move) {
      // A move can legitimately have no analysis: if you move before the
      // engine has built a ponder tree on your position (very fast replies,
      // or your first move), there is nothing for it to report.
      analysisBody.innerHTML =
        '<div class="analysis__row"><span>' +
        (h.side === 'you' ? 'You played' : 'Engine played') + '</span><span>' +
        h.move.from + '→' + h.move.to + '</span></div>' +
        '<p class="analysis__empty">No evaluation — the engine had not begun ' +
        'searching this position when the move was played.</p>';
    } else {
      analysisBody.innerHTML = '<p class="analysis__empty">Starting position.</p>';
    }
    render();
  }

  function enterReview() {
    // Resignation and timeout append a final state with NO move, so the last
    // history index isn't in the move list. Anchor on the last real ply.
    reviewMax = history.length - 1;
    while (reviewMax > 0 && !history[reviewMax].move) reviewMax--;
    if (reviewMax < 1) return;          // nothing to review
    buildMovelist();
    reviewEl.hidden = false;
    showReviewAt(reviewMax);
  }

  function onMessage(msg) {
    if (msg.type === 'state') {
      // Record every position so the game can be replayed afterwards. The
      // analysis that arrived just before this state belongs to the move
      // that produced it.
      history.push({
        state: msg,
        move: pending && pending.move,
        analysis: pending && pending.analysis,
        side: pending && pending.side
      });
      pending = null;
      state = msg;
      clockBase = { white: msg.clocks.white, black: msg.clocks.black, at: Date.now() };
      if (!clockTimer) clockTimer = setInterval(renderClocks, 250);

      if (msg.game_over) {
        var over = msg.game_over;
        var youWon = over.winner === humanColor;
        var txt = over.winner
          ? (youWon ? 'You win' : 'Engine wins') + ' — ' + over.reason
          : 'Draw — ' + over.reason;
        setStatus('<strong>' + txt + '</strong>', youWon ? 'win' : 'lose');
        resignBtn.disabled = true;
        newBtn.disabled = false;
        levelSel.disabled = false;
        colorSel.disabled = false;
        if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
        // Release the GPU. The socket is the container's lifetime, so leaving
        // a finished game connected bills for a container nobody is using.
        // New game opens a fresh socket anyway.
        try { if (ws) ws.close(); } catch (e) {}
        enterReview();
        return;   // enterReview() renders
      } else if (msg.to_move === humanColor) {
        setStatus('Your move.');
      } else {
        setStatus('Engine is thinking…');
      }
      render();

    } else if (msg.type === 'thinking') {
      var pct = Math.min(100, Math.round(msg.sims / msg.ceiling * 100));
      setStatus('Engine is thinking… ' + msg.sims + ' / ' + msg.ceiling + ' simulations (' + pct + '%)');

    } else if (msg.type === 'engine_move') {
      lastMove = { from: msg.from, to: msg.to };
      pending = {
        side: 'engine',
        move: { from: msg.from, to: msg.to, promotion: msg.promotion },
        analysis: msg.analysis
      };
      renderAnalysis(msg.analysis, pending.move, 'engine');

    } else if (msg.type === 'your_move') {
      // Engine's read of the position you just moved from — including the
      // move it would have chosen. Only surfaced after the game ends.
      pending = {
        side: 'you',
        move: { from: msg.from, to: msg.to, promotion: msg.promotion },
        analysis: msg.analysis
      };

    } else if (msg.type === 'error') {
      setStatus('Error: ' + msg.message, 'lose');
    }
  }

  function renderAnalysis(a, move, side) {
    a = a || {};
    // value is always white-perspective, so the label reads the same whether
    // the move was yours or the engine's.
    var v = typeof a.value === 'number' ? a.value : 0;
    var pct = Math.round((v + 1) / 2 * 100);
    var who = v > 0.15 ? 'White is better' : (v < -0.15 ? 'Black is better' : 'Roughly level');
    var mv = move ? move.from + '→' + move.to + (move.promotion ? '=' + move.promotion : '') : '—';

    var html =
      '<div class="evalbar"><div class="evalbar__fill" style="width:' + pct + '%"></div></div>' +
      '<div class="analysis__row"><span>' + who + '</span><span>' + v.toFixed(3) + '</span></div>' +
      '<div class="analysis__row"><span>' + (side === 'you' ? 'You played' : 'Engine played') +
        '</span><span>' + mv + '</span></div>' +
      '<div class="analysis__row"><span>Simulations</span><span>' + (a.sims || 0) + '</span></div>' +
      '<div class="analysis__row"><span>Time</span><span>' + (a.seconds || 0) + 's</span></div>';

    var pref = a.engine_would_play;
    if (pref && move && (pref.from !== move.from || pref.to !== move.to)) {
      html += '<div class="analysis__row analysis__pref"><span>Engine preferred</span><span>' +
              pref.from + '→' + pref.to + '</span></div>';
    }
    if (a.top && a.top.length) {
      // Every move MCTS actually visited. Bar width is share of the top
      // move's visits, so the drop-off after the first pick is visible.
      var maxV = a.top[0].visits || 1;
      html += '<div class="analysis__cap"><span>' + a.top.length +
              ' moves searched</span><span>visits</span></div>' +
              '<div class="analysis__top">';
      a.top.forEach(function (t) {
        var played = move && t.from === move.from && t.to === move.to;
        var w = Math.max(2, Math.round(t.visits / maxV * 100));
        html += '<div class="analysis__mv' + (played ? ' analysis__mv--played' : '') + '">' +
                '<span class="analysis__bar" style="width:' + w + '%"></span>' +
                '<span class="analysis__sq">' + t.from + '→' + t.to +
                  (t.promotion ? '=' + t.promotion : '') + '</span>' +
                '<span class="analysis__pct">' + (t.prob * 100).toFixed(1) + '%</span>' +
                '<span class="analysis__v">' + t.visits + '</span></div>';
      });
      html += '</div>';
    }
    analysisBody.innerHTML = html;
  }

  // ── Wire up ──────────────────────────────────────────────────────────
  // Remembered per viewer; harmless if storage is unavailable.
  try {
    if (localStorage.getItem('ec-endangered') === '1') endangEl.checked = true;
  } catch (e) {}
  endangKeyEl.hidden = !endangEl.checked;

  endangEl.addEventListener('change', function () {
    endangKeyEl.hidden = !endangEl.checked;
    try {
      localStorage.setItem('ec-endangered', endangEl.checked ? '1' : '0');
    } catch (e) {}
    render();
  });

  movelistEl.addEventListener('click', function (e) {
    var li = e.target.closest('li[data-i]');
    if (li) showReviewAt(parseInt(li.dataset.i, 10));
  });
  prevBtn.addEventListener('click', function () { showReviewAt(reviewIdx - 1); });
  nextBtn.addEventListener('click', function () { showReviewAt(reviewIdx + 1); });
  liveBtn.addEventListener('click', function () { showReviewAt(reviewMax); });

  document.addEventListener('keydown', function (e) {
    if (reviewIdx === null) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); showReviewAt(reviewIdx - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); showReviewAt(reviewIdx + 1); }
  });

  newBtn.addEventListener('click', newGame);
  resignBtn.addEventListener('click', function () {
    if (confirm('Resign this game?')) send({ type: 'resign' });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (pendingPromo) { pendingPromo = null; promoEl.hidden = true; }
      selected = null;
      render();
    }
  });

  // Draw the starting position before any game exists, so the section doesn't
  // read as an empty grid on first paint. legal is [] so nothing is clickable
  // until a real game begins.
  function idleState() {
    var back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    var board = [];
    for (var r = 0; r < 8; r++) {
      var row = [];
      for (var f = 0; f < 8; f++) {
        if (r === 0) row.push('w' + back[f]);
        else if (r === 1) row.push('wP');
        else if (r === 6) row.push('bP');
        else if (r === 7) row.push('b' + back[f]);
        else row.push(null);
      }
      board.push(row);
    }
    var full = { P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1 };
    return {
      board: board, to_move: 'white', legal: [],
      counts: { white: full, black: full },
      clocks: { white: 300, black: 300 }, game_over: null
    };
  }

  buildBoard();
  state = idleState();
  render();
})();
