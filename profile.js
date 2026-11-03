/*
 * Player profiles, stored in the Supabase `profiles` table
 * (see supabase/migrations/*_create_profiles.sql).
 * auth.js calls Profile.load() after sign-in and Profile.clear() on sign-out.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    tabs: document.querySelectorAll('.tab'),
    tabProfile: $('tab-profile'),
    tabDot: $('tab-profile-dot'),
    viewTable: $('view-table'),
    viewProfile: $('view-profile'),
    loading: $('profile-loading'),
    error: $('profile-error'),
    card: $('profile-card'),
    pcAvatar: $('pc-avatar'), pcName: $('pc-name'), pcUsername: $('pc-username'),
    pcMeta: $('pc-meta'), pcBio: $('pc-bio'), pcStyle: $('pc-style'),
    pcBank: $('pc-bank'), pcSince: $('pc-since'),
    editBtn: $('btn-edit-profile'), toTable: $('btn-to-table'),
    form: $('profile-form'),
    pfTitle: $('pf-title'), pfIntro: $('pf-intro'), pfAvatar: $('pf-avatar'),
    pfDisplay: $('pf-display'), pfUsername: $('pf-username'), pfLocation: $('pf-location'),
    pfBio: $('pf-bio'), pfBioCount: $('pf-bio-count'), pfError: $('pf-error'),
    pfCancel: $('pf-cancel'), pfSave: $('pf-save'),
  };

  const STYLE_LABELS = { cautious: 'Cautious', balanced: 'Balanced', high_roller: 'High roller' };
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  let client = null;
  let user = null;
  let google = { name: '', avatar: '' };
  let profile = null;
  let listeners = [];

  // ---------- Tabs ----------
  function showView(name) {
    const profileView = name === 'profile';
    el.viewTable.hidden = profileView;
    el.viewProfile.hidden = !profileView;
    el.tabs.forEach((t) => {
      if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    if (profileView) {
      document.getElementById('greeting').hidden = true;
      if (profile) renderCard();
      window.scrollTo(0, 0);
    }
  }

  el.tabs.forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  el.toTable.addEventListener('click', () => showView('table'));

  // ---------- Panels ----------
  function only(panel) {
    [el.loading, el.error, el.card, el.form].forEach((p) => { p.hidden = p !== panel; });
  }

  function setAvatar(box, url, name) {
    const initials = (name || '?').split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const showInitials = () => {
      box.replaceChildren(document.createTextNode(initials));
      box.classList.add('avatar-fallback');
    };
    box.classList.remove('avatar-fallback');
    if (!url) { showInitials(); return; }
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = showInitials;
    img.src = url;
    box.replaceChildren(img);
  }

  function money(n) {
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function renderCard() {
    const p = profile;
    setAvatar(el.pcAvatar, p.avatar_url || google.avatar, p.display_name);
    el.pcName.textContent = p.display_name;
    el.pcUsername.textContent = '@' + p.username;
    el.pcMeta.textContent = p.location || '';
    el.pcMeta.hidden = !p.location;
    el.pcBio.textContent = p.bio || 'No bio yet.';
    el.pcBio.classList.toggle('muted', !p.bio);
    el.pcStyle.textContent = STYLE_LABELS[p.play_style] || '—';
    el.pcBank.textContent = window.Blackjack && window.Blackjack.getBank ? money(window.Blackjack.getBank()) : '—';
    el.pcSince.textContent = new Date(p.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    el.tabDot.hidden = true;
    only(el.card);
  }

  function suggestUsername(name, email) {
    const base = (name || (email || '').split('@')[0] || 'player')
      .toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16);
    return base.length >= 3 ? base : `player_${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function openForm() {
    const editing = Boolean(profile);
    el.pfTitle.textContent = editing ? 'Edit your profile' : 'Create your profile';
    el.pfIntro.hidden = editing;
    el.pfSave.textContent = editing ? 'Save changes' : 'Create profile';
    el.pfCancel.hidden = !editing;
    setAvatar(el.pfAvatar, (profile && profile.avatar_url) || google.avatar, google.name);

    el.pfDisplay.value = editing ? profile.display_name : google.name;
    el.pfUsername.value = editing ? profile.username : suggestUsername(google.name, user.email);
    el.pfLocation.value = (editing && profile.location) || '';
    el.pfBio.value = (editing && profile.bio) || '';
    const style = (editing && profile.play_style) || '';
    el.form.querySelectorAll('input[name="play_style"]').forEach((r) => { r.checked = r.value === style; });
    el.pfBioCount.textContent = el.pfBio.value.length;
    showFormError('');
    only(el.form);
  }

  function showFormError(text) {
    el.pfError.textContent = text;
    el.pfError.hidden = !text;
  }

  function showLoadError(error) {
    console.error(error);
    const missingTable = error && (error.code === 'PGRST205' || error.code === '42P01'
      || /could not find the table|does not exist/i.test(error.message || ''));
    el.error.textContent = missingTable
      ? 'Profiles aren’t set up on the server yet. Please check back soon.'
      : 'We couldn’t load your profile. Check your connection and try again.';
    only(el.error);
  }

  el.editBtn.addEventListener('click', openForm);
  el.pfCancel.addEventListener('click', () => (profile ? renderCard() : showView('table')));
  el.pfBio.addEventListener('input', () => { el.pfBioCount.textContent = el.pfBio.value.length; });
  el.pfUsername.addEventListener('input', () => {
    const cleaned = el.pfUsername.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleaned !== el.pfUsername.value) el.pfUsername.value = cleaned;
  });

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = el.pfDisplay.value.trim();
    const username = el.pfUsername.value.trim();
    const location = el.pfLocation.value.trim();
    const bio = el.pfBio.value.trim();
    const checked = el.form.querySelector('input[name="play_style"]:checked');

    if (!displayName) { showFormError('Please enter a display name.'); el.pfDisplay.focus(); return; }
    if (!USERNAME_RE.test(username)) {
      showFormError('Usernames are 3–20 characters: lowercase letters, numbers and underscores.');
      el.pfUsername.focus();
      return;
    }

    const row = {
      id: user.id,
      display_name: displayName,
      username,
      location: location || null,
      bio: bio || null,
      play_style: checked ? checked.value : null,
      avatar_url: (profile && profile.avatar_url) || (/^https:\/\//.test(google.avatar) ? google.avatar : null),
    };

    showFormError('');
    el.pfSave.disabled = true;
    const creating = !profile;
    const query = creating
      ? client.from('profiles').insert(row)
      : client.from('profiles').update(row).eq('id', user.id);
    const { data, error } = await query.select().single();
    el.pfSave.disabled = false;

    if (error) {
      console.error(error);
      if (error.code === '23505') showFormError('That username is taken — try another.');
      else if (error.code === '23514') showFormError('Some details aren’t allowed. Check the username and lengths.');
      else showFormError('Couldn’t save your profile. Please try again.');
      return;
    }
    profile = data;
    renderCard();
    listeners.forEach((fn) => fn(profile, { created: creating }));
  });

  // ---------- Public API ----------
  async function load(supabaseClient, signedInUser, googleInfo) {
    client = supabaseClient;
    user = signedInUser;
    google = googleInfo;
    profile = null;
    only(el.loading);

    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (user !== signedInUser) return null; // signed out/switched while loading
    if (error) { showLoadError(error); return undefined; } // undefined = couldn't tell

    profile = data;
    el.tabDot.hidden = Boolean(profile);
    if (profile) renderCard(); else openForm();
    return profile;
  }

  function clear() {
    client = null;
    user = null;
    profile = null;
    el.tabDot.hidden = true;
    showView('table');
    only(el.loading);
  }

  window.Profile = {
    load,
    clear,
    show: () => showView('profile'),
    onSave: (fn) => { listeners.push(fn); },
  };
})();
