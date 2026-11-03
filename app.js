/*
 * Blackjack powered by the Deck of Cards API (https://deckofcardsapi.com/)
 *
 * Rules: 6-deck shoe, dealer stands on all 17s, blackjack pays 3:2,
 * insurance pays 2:1, double on any first two cards, split up to 4 hands,
 * split aces receive one card each.
 */
(() => {
  'use strict';

  // ---------- Config ----------
  const API = 'https://deckofcardsapi.com/api/deck';
  const CARD_BACK = 'https://deckofcardsapi.com/static/img/back.png';
  const DECK_COUNT = 6;
  const RESHUFFLE_AT = Math.floor(52 * DECK_COUNT * 0.25); // cut card at 75% penetration
  const STARTING_BANK = 1000;
  const MIN_BET = 5;
  const MAX_HANDS = 4;
  const STORAGE_KEY = 'blackjack.v1';
  let storageKey = STORAGE_KEY;
  const DEAL_DELAY = 320;

  // ---------- State ----------
  const state = {
    bank: STARTING_BANK,
    deckId: null,
    remaining: null,
    bet: 0,          // pending bet while in the betting phase
    lastBet: 0,
    phase: 'betting', // betting | dealing | insurance | player | dealer
    hands: [],
    active: 0,
    dealer: { cards: [], hidden: true },
    insurance: 0,
    busy: false,
    message: '',
    messageType: '',
  };

  const seenCards = new Set(); // card uids already animated in
  let revealAnimated = false;
  let uid = 0;

  // ---------- Persistence ----------
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved) {
        if (typeof saved.bank === 'number' && saved.bank >= 0) state.bank = saved.bank;
        if (typeof saved.deckId === 'string') state.deckId = saved.deckId;
        if (typeof saved.remaining === 'number') state.remaining = saved.remaining;
        if (typeof saved.lastBet === 'number') state.lastBet = saved.lastBet;
      }
    } catch (_) { /* storage unavailable — play without persistence */ }
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        bank: state.bank,
        deckId: state.deckId,
        remaining: state.remaining,
        lastBet: state.lastBet,
      }));
    } catch (_) { /* ignore */ }
  }

  // ---------- Deck of Cards API ----------
  async function api(path) {
    const res = await fetch(`${API}/${path}`);
    if (!res.ok) throw new Error(`Deck API returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Deck API request failed');
    return data;
  }

  async function newShoe() {
    const data = await api(`new/shuffle/?deck_count=${DECK_COUNT}`);
    state.deckId = data.deck_id;
    state.remaining = data.remaining;
    save();
  }

  async function reshuffleShoe() {
    const data = await api(`${state.deckId}/shuffle/`);
    state.remaining = data.remaining;
    save();
  }

  // Called between rounds: make sure there is a shoe and that it's above the cut card.
  async function ensureShoe() {
    if (!state.deckId) {
      setMessage('Shuffling a fresh 6-deck shoe…');
      render();
      await newShoe();
      return;
    }
    if (state.remaining == null || state.remaining < RESHUFFLE_AT) {
      setMessage('Cut card reached — reshuffling the shoe…');
      render();
      try { await reshuffleShoe(); } catch (_) { await newShoe(); }
      await sleep(500);
    }
  }

  async function draw(count) {
    let data;
    try {
      data = await api(`${state.deckId}/draw/?count=${count}`);
      if (!data.cards || data.cards.length < count) throw new Error('Not enough cards');
    } catch (err) {
      // Deck expired (API discards decks after 2 weeks idle) or ran dry: open a new shoe and retry once.
      await newShoe();
      data = await api(`${state.deckId}/draw/?count=${count}`);
    }
    state.remaining = data.remaining;
    save();
    return data.cards.map(toCard);
  }

  function toCard(c) {
    const image = (c.images && c.images.png) || c.image;
    preload(image);
    return { uid: ++uid, code: c.code, value: c.value, suit: c.suit, image };
  }

  function preload(src) { const img = new Image(); img.src = src; }

  // ---------- Blackjack math ----------
  function cardPoints(value) {
    if (value === 'ACE') return 11;
    if (value === 'KING' || value === 'QUEEN' || value === 'JACK') return 10;
    return parseInt(value, 10);
  }

  function score(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      total += cardPoints(c.value);
      if (c.value === 'ACE') aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }

  function isBlackjack(cards) {
    return cards.length === 2 && score(cards).total === 21;
  }

  function totalLabel(cards) {
    const { total, soft } = score(cards);
    if (soft && total < 21) return `${total - 10} / ${total}`;
    return String(total);
  }

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cur = () => state.hands[state.active];

  function money(n) {
    const hasCents = Math.round(n * 100) % 100 !== 0;
    return '$' + n.toLocaleString('en-US', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: 2,
    });
  }

  function setMessage(text, type = '') {
    state.message = text;
    state.messageType = type;
  }

  function newHand(cards, bet) {
    return { cards, bet, done: false, result: null, doubled: false, splitAces: false, fromSplit: false };
  }

  // Wraps every user action: one at a time, with error recovery.
  function action(fn) {
    return async (...args) => {
      if (state.busy) return;
      state.busy = true;
      render();
      try {
        await fn(...args);
      } catch (err) {
        console.error(err);
        recoverFromError();
      } finally {
        state.busy = false;
        render();
      }
    };
  }

  function recoverFromError() {
    // Refund anything at stake in an unfinished round.
    if (state.phase !== 'betting') {
      const refund = state.hands.reduce((s, h) => s + h.bet, 0) + state.insurance;
      state.bank += refund;
      state.hands = [];
      state.dealer = { cards: [], hidden: true };
      state.insurance = 0;
      state.phase = 'betting';
      state.bet = Math.min(state.lastBet, state.bank);
      save();
    }
    setMessage("Couldn't reach the dealer (deckofcardsapi.com). Any bet was returned — check your connection and try again.", 'error');
  }

  // ---------- Betting ----------
  function addChip(amount) {
    if (state.phase !== 'betting' || state.busy) return;
    if (state.bet + amount > state.bank) return;
    state.bet += amount;
    if (state.hands.length) { // clear the previous round off the table once a new bet starts
      clearTable();
    }
    render();
  }

  function clearBet() {
    if (state.phase !== 'betting' || state.busy) return;
    state.bet = 0;
    render();
  }

  function rebuy() {
    if (state.phase !== 'betting') return;
    state.bank += STARTING_BANK;
    state.bet = 0;
    clearTable();
    setMessage(`Rebought for ${money(STARTING_BANK)}. Good luck!`);
    save();
    render();
  }

  function clearTable() {
    state.hands = [];
    state.dealer = { cards: [], hidden: true };
    seenCards.clear();
    revealAnimated = false;
    setMessage('');
  }

  // ---------- Round flow ----------
  const deal = action(async () => {
    if (state.phase !== 'betting') return;
    if (state.bet < MIN_BET || state.bet > state.bank) {
      setMessage(`Place a bet of at least ${money(MIN_BET)} to deal.`);
      return;
    }

    clearTable();
    await ensureShoe();

    const wager = state.bet;
    state.bank -= wager;
    state.lastBet = wager;
    state.hands = [newHand([], wager)];
    state.active = 0;
    state.dealer = { cards: [], hidden: true };
    state.insurance = 0;
    state.phase = 'dealing';
    setMessage('');
    save();
    render();

    const cards = await draw(4);
    const hand = state.hands[0];
    // Player, dealer, player, dealer (hole card)
    hand.cards.push(cards[0]); render(); await sleep(DEAL_DELAY);
    state.dealer.cards.push(cards[1]); render(); await sleep(DEAL_DELAY);
    hand.cards.push(cards[2]); render(); await sleep(DEAL_DELAY);
    state.dealer.cards.push(cards[3]); render(); await sleep(DEAL_DELAY);

    if (state.dealer.cards[0].value === 'ACE' && state.bank >= wager / 2) {
      state.phase = 'insurance';
      setMessage(isBlackjack(hand.cards) ? 'Blackjack! Dealer shows an Ace…' : 'Dealer shows an Ace.');
      return;
    }
    await peekAndContinue();
  });

  const answerInsurance = action(async (take) => {
    if (state.phase !== 'insurance') return;
    if (take) {
      const cost = state.hands[0].bet / 2;
      state.bank -= cost;
      state.insurance = cost;
      save();
    }
    await peekAndContinue();
  });

  // Dealer checks for blackjack when showing an Ace or ten, then play continues.
  async function peekAndContinue() {
    const hand = state.hands[0];
    const dealerBJ = isBlackjack(state.dealer.cards);
    const playerBJ = isBlackjack(hand.cards);

    if (dealerBJ) {
      await revealHole();
      hand.result = playerBJ ? 'push' : 'lose';
      hand.done = true;
      settle('Dealer has Blackjack.');
      return;
    }

    let note = '';
    if (state.insurance > 0) note = 'No dealer Blackjack — insurance lost. ';

    if (playerBJ) {
      hand.result = 'blackjack';
      hand.done = true;
      await revealHole();
      settle(note);
      return;
    }

    state.phase = 'player';
    setMessage(note.trim());
    render();
  }

  const hit = action(async () => {
    if (state.phase !== 'player') return;
    const hand = cur();
    hand.cards.push(...(await draw(1)));
    render();
    const { total } = score(hand.cards);
    if (total > 21) {
      hand.result = 'bust';
      hand.done = true;
      await sleep(450);
      await nextHand();
    } else if (total === 21) {
      hand.done = true;
      await sleep(350);
      await nextHand();
    }
  });

  const stand = action(async () => {
    if (state.phase !== 'player') return;
    cur().done = true;
    await nextHand();
  });

  function canDouble() {
    if (state.phase !== 'player') return false;
    const hand = cur();
    return hand.cards.length === 2 && !hand.splitAces && state.bank >= hand.bet;
  }

  const doubleDown = action(async () => {
    if (!canDouble()) return;
    const hand = cur();
    state.bank -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    save();
    hand.cards.push(...(await draw(1)));
    render();
    if (score(hand.cards).total > 21) hand.result = 'bust';
    hand.done = true;
    await sleep(450);
    await nextHand();
  });

  function canSplit() {
    if (state.phase !== 'player') return false;
    const hand = cur();
    return hand.cards.length === 2
      && cardPoints(hand.cards[0].value) === cardPoints(hand.cards[1].value)
      && state.hands.length < MAX_HANDS
      && !hand.splitAces
      && state.bank >= hand.bet;
  }

  const split = action(async () => {
    if (!canSplit()) return;
    const hand = cur();
    const [first, second] = hand.cards;
    const aces = first.value === 'ACE';

    state.bank -= hand.bet;
    save();

    hand.cards = [first];
    hand.fromSplit = true;
    hand.splitAces = aces;
    const sibling = newHand([second], hand.bet);
    sibling.fromSplit = true;
    sibling.splitAces = aces;
    state.hands.splice(state.active + 1, 0, sibling);
    render();
    await sleep(250);

    hand.cards.push(...(await draw(1)));
    render();
    await sleep(DEAL_DELAY);

    if (aces || score(hand.cards).total === 21) {
      hand.done = true;
      await nextHand();
    }
  });

  // Advance to the next unfinished hand, or to the dealer.
  async function nextHand() {
    for (;;) {
      state.active++;
      if (state.active >= state.hands.length) {
        await dealerTurn();
        return;
      }
      const hand = cur();
      if (hand.cards.length < 2) {
        render();
        await sleep(200);
        hand.cards.push(...(await draw(1)));
        render();
        await sleep(DEAL_DELAY);
      }
      if (hand.splitAces || score(hand.cards).total === 21) {
        hand.done = true;
        continue;
      }
      render();
      return;
    }
  }

  async function revealHole() {
    state.phase = 'dealer';
    state.dealer.hidden = false;
    render();
    await sleep(550);
  }

  async function dealerTurn() {
    await revealHole();
    const anyLive = state.hands.some((h) => h.result !== 'bust');
    if (anyLive) {
      while (score(state.dealer.cards).total < 17) {
        state.dealer.cards.push(...(await draw(1)));
        render();
        await sleep(500);
      }
    }
    settle();
  }

  function settle(prefix = '') {
    const dealerScore = score(state.dealer.cards).total;
    const dealerBust = dealerScore > 21;
    let staked = state.insurance;
    let returned = 0;

    // Insurance pays 2:1 when the dealer has blackjack.
    if (state.insurance > 0 && isBlackjack(state.dealer.cards)) returned += state.insurance * 3;

    for (const hand of state.hands) {
      staked += hand.bet;
      if (!hand.result) {
        const p = score(hand.cards).total;
        if (dealerBust || p > dealerScore) hand.result = 'win';
        else if (p === dealerScore) hand.result = 'push';
        else hand.result = 'lose';
      }
      if (hand.result === 'blackjack') returned += hand.bet * 2.5;
      else if (hand.result === 'win') returned += hand.bet * 2;
      else if (hand.result === 'push') returned += hand.bet;
    }

    state.bank += returned;
    const net = returned - staked;

    let text;
    let type;
    const single = state.hands.length === 1 ? state.hands[0].result : null;
    if (single === 'blackjack') { text = `Blackjack! You win ${money(net)}`; type = 'win'; }
    else if (net > 0) { text = `${dealerBust ? 'Dealer busts! ' : ''}You win ${money(net)}`; type = 'win'; }
    else if (net < 0) { text = single === 'bust' ? `Bust — you lose ${money(-net)}` : `Dealer wins — you lose ${money(-net)}`; type = 'lose'; }
    else { text = 'Push — your bet is returned'; type = 'push'; }

    setMessage(`${prefix} ${text}`.trim(), type);
    state.phase = 'betting';
    state.insurance = 0;
    state.bet = state.lastBet <= state.bank ? state.lastBet : 0;
    if (state.bank < MIN_BET && state.bet === 0) {
      setMessage(`${state.message} · You're out of chips — rebuy to keep playing.`, type);
    }
    save();
    render();
  }

  // ---------- Rendering ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    bank: $('bank'), shoe: $('shoe'), bet: $('bet'), message: $('message'),
    dealerCards: $('dealer-cards'), dealerTotal: $('dealer-total'), hands: $('hands'),
    panelBet: $('panel-bet'), panelIns: $('panel-insurance'), panelPlay: $('panel-play'),
    insCost: $('ins-cost'),
    deal: $('btn-deal'), clear: $('btn-clear'), rebuy: $('btn-rebuy'),
    hit: $('btn-hit'), stand: $('btn-stand'), double: $('btn-double'), split: $('btn-split'),
    insYes: $('btn-ins-yes'), insNo: $('btn-ins-no'),
    chips: document.querySelectorAll('[data-chip]'),
  };

  function cardEl(card, faceDown = false) {
    const img = document.createElement('img');
    img.className = 'card';
    img.src = faceDown ? CARD_BACK : card.image;
    img.alt = faceDown ? 'Face-down card' : `${titleCase(card.value)} of ${titleCase(card.suit)}`;
    img.draggable = false;
    if (!seenCards.has(card.uid)) {
      seenCards.add(card.uid);
      img.classList.add('deal');
    }
    return img;
  }

  function titleCase(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }

  function renderDealer() {
    const { cards, hidden } = state.dealer;
    el.dealerCards.replaceChildren();
    cards.forEach((card, i) => {
      const faceDown = hidden && i === 1;
      const img = cardEl(card, faceDown);
      if (i === 1 && !hidden && !revealAnimated) {
        revealAnimated = true;
        img.classList.remove('deal');
        img.classList.add('flip');
      }
      el.dealerCards.appendChild(img);
    });
    if (cards.length) {
      el.dealerTotal.hidden = false;
      el.dealerTotal.textContent = hidden ? totalLabel([cards[0]]) : totalLabel(cards);
    } else {
      el.dealerTotal.hidden = true;
    }
  }

  const RESULT_TEXT = { blackjack: 'Blackjack', win: 'Win', lose: 'Lose', bust: 'Bust', push: 'Push' };

  function renderHands() {
    el.hands.replaceChildren();
    el.hands.classList.toggle('multi', state.hands.length > 1);
    state.hands.forEach((hand, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'hand';
      if (state.phase === 'player' && i === state.active) wrap.classList.add('active');
      if (hand.result && state.phase === 'betting') wrap.classList.add('settled');

      const cards = document.createElement('div');
      cards.className = 'cards';
      hand.cards.forEach((c) => cards.appendChild(cardEl(c)));

      const meta = document.createElement('div');
      meta.className = 'hand-meta';
      if (hand.cards.length) {
        const total = document.createElement('span');
        total.className = 'total';
        total.textContent = totalLabel(hand.cards);
        meta.appendChild(total);
      }
      const bet = document.createElement('span');
      bet.className = 'bet-chip';
      bet.textContent = money(hand.bet) + (hand.doubled ? ' ×2' : '');
      meta.appendChild(bet);
      if (hand.result && (state.phase === 'betting' || hand.result === 'bust')) {
        const badge = document.createElement('span');
        badge.className = `badge ${hand.result}`;
        badge.textContent = RESULT_TEXT[hand.result];
        meta.appendChild(badge);
      }

      wrap.append(cards, meta);
      el.hands.appendChild(wrap);
    });
  }

  function render() {
    el.bank.textContent = money(state.bank);
    el.shoe.textContent = state.remaining == null ? '—' : `${state.remaining} cards`;
    el.bet.textContent = money(state.bet);
    el.message.textContent = state.message;
    el.message.className = `message ${state.messageType}`;

    renderDealer();
    renderHands();

    const betting = state.phase === 'betting';
    el.panelBet.hidden = !betting;
    el.panelIns.hidden = state.phase !== 'insurance';
    el.panelPlay.hidden = betting || state.phase === 'insurance';

    const broke = betting && state.bank < MIN_BET && state.bet === 0;
    el.rebuy.hidden = !broke;
    el.deal.hidden = broke;
    el.deal.disabled = state.busy || state.bet < MIN_BET || state.bet > state.bank;
    el.clear.disabled = state.busy || state.bet === 0;
    el.chips.forEach((chip) => {
      chip.disabled = state.busy || state.bet + Number(chip.dataset.chip) > state.bank;
    });

    if (state.phase === 'insurance') el.insCost.textContent = money(state.hands[0].bet / 2);
    el.insYes.disabled = el.insNo.disabled = state.busy;

    const playing = state.phase === 'player' && !state.busy;
    el.hit.disabled = !playing;
    el.stand.disabled = !playing;
    el.double.disabled = !playing || !canDouble();
    el.split.disabled = !playing || !canSplit();
  }

  // ---------- Wiring ----------
  el.chips.forEach((chip) => chip.addEventListener('click', () => addChip(Number(chip.dataset.chip))));
  el.clear.addEventListener('click', clearBet);
  el.deal.addEventListener('click', () => deal());
  el.rebuy.addEventListener('click', rebuy);
  el.hit.addEventListener('click', () => hit());
  el.stand.addEventListener('click', () => stand());
  el.double.addEventListener('click', () => doubleDown());
  el.split.addEventListener('click', () => split());
  el.insYes.addEventListener('click', () => answerInsurance(true));
  el.insNo.addEventListener('click', () => answerInsurance(false));

  document.addEventListener('keydown', (e) => {
    if (!started || document.getElementById('view-table').hidden) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const key = e.key.toLowerCase();
    if (state.phase === 'betting' && (key === 'enter' || key === ' ')) { e.preventDefault(); deal(); }
    else if (state.phase === 'player') {
      if (key === 'h') hit();
      else if (key === 's') stand();
      else if (key === 'd') doubleDown();
      else if (key === 'p') split();
    }
  });

  // ---------- Boot ----------
  // auth.js calls start() once a player signs in; each Google account keeps its own bank.
  let started = false;

  function start(userId) {
    storageKey = `${STORAGE_KEY}.${userId}`;
    Object.assign(state, {
      bank: STARTING_BANK, deckId: null, remaining: null, bet: 0, lastBet: 0,
      phase: 'betting', hands: [], active: 0, dealer: { cards: [], hidden: true },
      insurance: 0, busy: false,
    });
    clearTable();
    load();
    preload(CARD_BACK);
    state.bet = state.lastBet && state.lastBet <= state.bank ? state.lastBet : 0;
    setMessage('Place your bet and press Deal.');
    started = true;
    render();
  }

  function stop() { started = false; }

  window.Blackjack = { start, stop, getBank: () => state.bank };
})();
