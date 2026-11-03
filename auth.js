/*
 * Google sign-in through Supabase Auth.
 * Shows the login screen until there is a session, then greets the player
 * by name with their Google profile picture and starts the game.
 */
(() => {
  'use strict';

  const cfg = window.BLACKJACK_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const el = {
    login: $('login-screen'),
    loginBtn: $('btn-google'),
    loginError: $('login-error'),
    app: $('app'),
    user: $('user'),
    avatar: $('user-avatar'),
    userName: $('user-name'),
    signOut: $('btn-signout'),
    greeting: $('greeting'),
    greetingAvatar: $('greeting-avatar'),
    greetingText: $('greeting-text'),
    greetingClose: $('greeting-close'),
  };

  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/PASTE_YOUR/.test(cfg.SUPABASE_ANON_KEY);

  function showLoginError(text) {
    el.loginError.textContent = text;
    el.loginError.hidden = !text;
  }

  if (!window.supabase || !configured) {
    el.login.hidden = false;
    showLoginError(!configured
      ? 'Sign-in isn’t set up yet: add your Supabase publishable key to config.js.'
      : 'Couldn’t load the sign-in library. Check your connection and reload.');
    el.loginBtn.disabled = true;
    return;
  }

  const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });

  // Surface errors Supabase/Google send back on the redirect (e.g. user cancelled).
  const params = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1));
  const redirectError = params.get('error_description');
  if (redirectError) showLoginError(`Sign-in failed: ${redirectError}`);

  el.loginBtn.addEventListener('click', async () => {
    showLoginError('');
    el.loginBtn.disabled = true;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      el.loginBtn.disabled = false;
      showLoginError(`Sign-in failed: ${error.message}`);
    }
  });

  el.signOut.addEventListener('click', async () => {
    el.signOut.disabled = true;
    await client.auth.signOut();
    el.signOut.disabled = false;
  });

  el.greetingClose.addEventListener('click', () => { el.greeting.hidden = true; });

  function profile(user) {
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Player');
    const firstName = meta.given_name || name.split(' ')[0];
    const avatar = meta.avatar_url || meta.picture || '';
    return { name, firstName, avatar };
  }

  // Fills an avatar box with the Google photo, falling back to initials.
  function setAvatar(box, url, name) {
    const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
    const showInitials = () => {
      box.replaceChildren(document.createTextNode(initials));
      box.classList.add('avatar-fallback');
    };
    box.classList.remove('avatar-fallback');
    if (!url) { showInitials(); return; }
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer'; // Google profile photos can refuse requests that carry a referrer
    img.onerror = showInitials;
    img.src = url;
    box.replaceChildren(img);
  }

  let currentUserId = null;

  function showSignedIn(user) {
    if (currentUserId === user.id) return;
    const isNewArrival = currentUserId === null;
    currentUserId = user.id;
    const { name, firstName, avatar } = profile(user);

    el.userName.textContent = name;
    setAvatar(el.avatar, avatar, name);
    setAvatar(el.greetingAvatar, avatar, name);

    const hour = new Date().getHours();
    const partOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    el.greetingText.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = `${partOfDay}, ${firstName}!`;
    el.greetingText.append(strong, document.createTextNode(' Welcome to the table — place your bet to begin.'));

    el.login.hidden = true;
    el.app.hidden = false;
    el.user.hidden = false;
    el.greeting.hidden = !isNewArrival;

    window.Blackjack.start(user.id);
  }

  function showSignedOut() {
    currentUserId = null;
    el.app.hidden = true;
    el.user.hidden = true;
    el.greeting.hidden = true;
    el.login.hidden = false;
    el.loginBtn.disabled = false;
    window.Blackjack.stop();
  }

  client.auth.onAuthStateChange((_event, session) => {
    // Defer so Supabase finishes its own bookkeeping before we touch the UI.
    setTimeout(() => {
      if (session && session.user) {
        showSignedIn(session.user);
        // Tidy the OAuth code/error out of the address bar.
        if (window.location.search || window.location.hash) {
          history.replaceState(null, '', window.location.pathname);
        }
      } else {
        showSignedOut();
      }
    }, 0);
  });
})();
