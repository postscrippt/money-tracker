'use strict';

/* Cloud sync through Supabase.
   The whole data set is stored as one row per user. Every sync pulls the cloud copy, merges it with
   this device's copy (mergeStates in app.js), and writes the result back. The `version` column stops
   two devices from overwriting each other: a write only succeeds if nobody else wrote in between,
   otherwise we pull and merge again. */
const Sync = (() => {
  const cfg = window.MONEY_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const client = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const TABLE = 'money_data';
  const DIRTY = 'money-tracker-unsynced';

  let user = null;
  let version = null;     // version of the cloud row we last saw
  let status = configured ? 'signed-out' : 'off';
  let lastSynced = null;
  let busy = false, again = false;
  let timer = null, retryTimer = null, channel = null;
  let mode = 'signin';     // or 'signup'
  let recovering = false;  // arrived from a password-reset email

  const setDirty = on => { try { on ? localStorage.setItem(DIRTY, '1') : localStorage.removeItem(DIRTY); } catch (e) { /* ignore */ } };
  const isDirty = () => { try { return localStorage.getItem(DIRTY) === '1'; } catch (e) { return false; } };

  function setStatus(s) { status = s; renderUI(); }

  async function pull() {
    const { data, error } = await client.from(TABLE).select('doc, version').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function sync() {
    if (!client || !user) return;
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(retryTimer);
    setStatus('syncing');
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await pull();
        const remoteDoc = remote ? normalize(remote.doc) : null;
        const before = JSON.stringify(state);
        let merged;
        if (!remoteDoc) merged = normalize({ ...state, pristine: false });
        else if (state.pristine) merged = remoteDoc; // fresh device: just take the cloud copy
        else merged = mergeStates(state, remoteDoc);
        merged.pristine = false;

        state = merged;
        persistLocal();
        if (JSON.stringify(state) !== before) render();

        if (remoteDoc && JSON.stringify(remoteDoc) === JSON.stringify(merged)) {
          version = remote.version; // cloud already has everything
          break;
        }
        const res = remote
          ? await client.from(TABLE)
              .update({ doc: merged, version: remote.version + 1, updated_at: new Date().toISOString() })
              .eq('user_id', user.id).eq('version', remote.version).select('version')
          : await client.from(TABLE).insert({ user_id: user.id, doc: merged, version: 1 }).select('version');
        if (res.error) {
          if (res.error.code === '23505') continue; // another device created the row first
          throw res.error;
        }
        if (res.data && res.data.length) { version = res.data[0].version; break; }
        // Another device wrote in between: loop to pull and merge again.
      }
      setDirty(false);
      lastSynced = new Date();
      setStatus('synced');
    } catch (err) {
      console.error('Sync failed', err);
      setStatus(navigator.onLine ? 'error' : 'offline');
      retryTimer = setTimeout(sync, 30000);
    } finally {
      busy = false;
      if (again) { again = false; sync(); }
    }
  }

  // Called by save() in app.js after every change.
  function changed() {
    if (!configured) return;
    setDirty(true);
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(sync, 1200);
  }

  function startRealtime() {
    stopRealtime();
    channel = client.channel('money-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, payload => {
        if (payload.new && payload.new.version === version) return; // our own write
        sync();
      })
      .subscribe();
  }

  function stopRealtime() {
    if (channel) { client.removeChannel(channel); channel = null; }
  }

  /* ---------- sign in / out ---------- */
  const siteUrl = () => (location.protocol.startsWith('http') ? location.origin + location.pathname : undefined);

  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: siteUrl() } });
    if (error) throw error;
    // No session means Supabase still requires email confirmation for new accounts.
    if (!data.session) throw new Error('Account created, but Supabase wants it confirmed by email first. Turn off "Confirm email" in Supabase (see SYNC-SETUP.md), then sign in.');
  }

  async function forgotPassword(email) {
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
    if (error) throw error;
  }

  async function setNewPassword(password) {
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
    recovering = false;
  }

  async function signOut() {
    if (isDirty()) await sync();
    if (isDirty()) {
      toast("Can't sign out yet: some changes haven't synced. Check your connection.");
      return;
    }
    await client.auth.signOut();
    // The data is safe in the cloud; clear it from this device.
    state = defaultState();
    persistLocal();
    resetForm();
    render();
    toast('Signed out. Your data is safe in the cloud.');
  }

  /* ---------- UI ---------- */
  function statusText() {
    switch (status) {
      case 'syncing': return 'Syncing…';
      case 'synced': return `Synced ${lastSynced ? 'at ' + lastSynced.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}`;
      case 'offline': return "Offline. Changes will sync when you're back online.";
      case 'error': return "Couldn't sync. Retrying shortly.";
      default: return '';
    }
  }

  function renderUI() {
    const dot = $('#syncDot');
    dot.hidden = !user;
    dot.className = 'sync-dot ' + status;
    dot.title = statusText();
    if (!$('#settings').open) return;
    $('#syncOff').hidden = configured && !!client;
    if (configured && !client) $('#syncOff').textContent = "Can't reach the sync service right now. Your data is saved on this device and will sync later.";
    $('#syncSignIn').hidden = !client || !!user;
    $('#syncReset').hidden = !user || !recovering;
    $('#syncOn').hidden = !user || recovering;
    const signup = mode === 'signup';
    $('#syncGo').textContent = signup ? 'Create account' : 'Sign in';
    $('#syncPass').autocomplete = signup ? 'new-password' : 'current-password';
    $('#syncMode').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create an account';
    $('#syncForgot').hidden = signup;
    if (user) {
      $('#syncDot2').className = 'sync-dot ' + status;
      $('#syncText').textContent = `${user.email} · ${statusText()}`;
    }
    $('#dataNote').textContent = user
      ? 'Your data is saved on this device and synced to your account. You can still download a backup or a spreadsheet anytime.'
      : 'Everything is saved in this browser only. Download a backup now and then, or to move to another device.';
  }

  function busyButton(btn, label, work) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
    return work().finally(() => { btn.disabled = false; btn.textContent = old; });
  }

  const friendly = err => {
    const m = (err && err.message) || '';
    if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/already registered/i.test(m)) return 'That email already has an account. Sign in instead.';
    if (/email not confirmed/i.test(m)) return 'This account still needs email confirmation. Turn off "Confirm email" in Supabase (see SYNC-SETUP.md).';
    return m || 'Something went wrong. Try again.';
  };

  $('#syncSignIn').onsubmit = e => {
    e.preventDefault();
    const email = $('#syncEmail').value.trim();
    const password = $('#syncPass').value;
    const signup = mode === 'signup';
    busyButton($('#syncGo'), signup ? 'Creating…' : 'Signing in…', () => (signup ? signUp : signIn)(email, password)
      .then(() => { $('#syncPass').value = ''; })
      .catch(err => toast(friendly(err))));
  };
  $('#syncMode').onclick = () => { mode = mode === 'signup' ? 'signin' : 'signup'; renderUI(); };
  $('#syncForgot').onclick = () => {
    const email = $('#syncEmail').value.trim();
    if (!email) { toast('Type your email first'); $('#syncEmail').focus(); return; }
    busyButton($('#syncForgot'), 'Sending…', () => forgotPassword(email)
      .then(() => toast('Check your email for a reset link'))
      .catch(err => toast(friendly(err))));
  };
  $('#syncReset').onsubmit = e => {
    e.preventDefault();
    busyButton($('#syncSetPass'), 'Saving…', () => setNewPassword($('#syncNewPass').value)
      .then(() => { $('#syncNewPass').value = ''; renderUI(); toast('Password updated'); })
      .catch(err => toast(friendly(err))));
  };
  $('#syncNow').onclick = () => sync();
  $('#syncOut').onclick = () => busyButton($('#syncOut'), 'Signing out…', signOut);

  /* ---------- start ---------- */
  if (client) {
    client.auth.onAuthStateChange((event, session) => {
      const u = session ? session.user : null;
      // Supabase asks that no other Supabase calls run inside this callback, so defer them.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          recovering = true;
          if (!$('#settings').open) openSettings();
        }
        if (u && (!user || user.id !== u.id)) {
          user = u;
          startRealtime();
          sync();
        } else if (!u && user) {
          user = null;
          version = null;
          stopRealtime();
          setStatus('signed-out');
        }
        renderUI();
      }, 0);
    });
    window.addEventListener('online', () => sync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  }
  renderUI();

  return { changed, render: renderUI, sync };
})();
