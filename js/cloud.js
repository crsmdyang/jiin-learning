/* ============================================================
   cloud.js — Firebase Auth + Firestore 진도 동기화 공용 모듈
   compat SDK (CDN) 사용. 설정이 없으면 게스트 모드로 폴백.
   ============================================================ */
(function(){
  const cfg = window.FIREBASE_CONFIG || {};
  const enabled = cfg.apiKey && !String(cfg.apiKey).startsWith('PASTE_');
  let app = null, auth = null, db = null;

  if (enabled && window.firebase) {
    app = firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }).catch(()=>{}); } catch(e){}
  }

  const Cloud = {
    enabled: !!(enabled && app),
    user: null,

    /* ---------- auth ---------- */
    onAuth(cb){
      if (!this.enabled){ cb(null); return; }
      auth.onAuthStateChanged(u => { this.user = u; cb(u); });
    },
    async signup(email, pw){ return auth.createUserWithEmailAndPassword(email, pw); },
    async login(email, pw){ return auth.signInWithEmailAndPassword(email, pw); },
    async resetPw(email){ return auth.sendPasswordResetEmail(email); },
    async logout(){ return auth.signOut(); },

    errMsg(e){
      const m = {
        'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인해 주세요.',
        'auth/invalid-email': '이메일 형식이 올바르지 않아요.',
        'auth/weak-password': '비밀번호는 6자 이상으로 해주세요.',
        'auth/user-not-found': '가입되지 않은 이메일이에요.',
        'auth/wrong-password': '비밀번호가 맞지 않아요.',
        'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
        'auth/too-many-requests': '시도가 너무 많았어요. 잠시 후 다시 해주세요.',
        'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
      };
      return m[e && e.code] || ('오류: ' + (e && e.message || e));
    },

    /* ---------- profiles ---------- */
    async listProfiles(){
      if (!this.enabled || !this.user) return null;
      const snap = await db.collection('users').doc(this.user.uid).collection('profiles')
        .orderBy('created').get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async addProfile(name, avatar){
      const ref = await db.collection('users').doc(this.user.uid).collection('profiles')
        .add({ name, avatar, created: Date.now() });
      return ref.id;
    },
    async updateProfile(pid, data){
      return db.collection('users').doc(this.user.uid).collection('profiles').doc(pid).update(data);
    },
    async deleteProfile(pid){
      return db.collection('users').doc(this.user.uid).collection('profiles').doc(pid).delete();
    },

    /* ---------- progress ---------- */
    _progRef(pid, program){
      return db.collection('users').doc(this.user.uid)
        .collection('profiles').doc(pid)
        .collection('programs').doc(program);
    },
    async loadProgress(pid, program){
      if (!this.enabled || !this.user) return null;
      try {
        const doc = await this._progRef(pid, program).get();
        if (!doc.exists) return null;
        const d = doc.data();
        return { state: JSON.parse(d.stateJson), updatedAt: d.updatedAt || 0 };
      } catch(e){ console.warn('loadProgress', e); return null; }
    },
    _saveTimer: null,
    saveProgress(pid, program, stateObj){   // debounced 3s
      if (!this.enabled || !this.user) return;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveProgressNow(pid, program, stateObj), 3000);
    },
    async saveProgressNow(pid, program, stateObj){
      if (!this.enabled || !this.user) return;
      clearTimeout(this._saveTimer);
      try {
        await this._progRef(pid, program).set({
          stateJson: JSON.stringify(stateObj), updatedAt: Date.now()
        });
      } catch(e){ console.warn('saveProgress', e); }
    },
  };

  /* ---------- active profile (sessionStorage 공유) ---------- */
  Cloud.setActiveProfile = function(p){ try { localStorage.setItem('wp_active_profile', JSON.stringify(p)); } catch(e){} };
  Cloud.getActiveProfile = function(){
    try { return JSON.parse(localStorage.getItem('wp_active_profile')); } catch(e){ return null; }
  };

  window.Cloud = Cloud;
})();
