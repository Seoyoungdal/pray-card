/**
 * 기도카드 PWA
 * Version 1.0.0
 */

const APP_VERSION = '1.5.2';
const STORAGE_KEY = 'prayer-card-data';
// 원격 버전 확인용 (GitHub Pages에 version.json을 올려두면 동작)
const VERSION_CHECK_URL = './version.json';

// 기본 성경 구절 (저작권 없는 개역한글 일부 + 자주 쓰는 구절)
const DEFAULT_VERSES = [
  { text: '항상 기뻐하라 쉬지 말고 기도하라 범사에 감사하라', ref: '데살로니가전서 5:16-18' },
  { text: '여호와는 나의 목자시니 내가 부족함이 없으리로다', ref: '시편 23:1' },

];

// 기본 카테고리 (개인)
const DEFAULT_CATEGORIES = [
  { id: 'cat_me', name: '나' },
  { id: 'cat_family', name: '가족' },
  { id: 'cat_church', name: '교회' },
  { id: 'cat_mission', name: '선교' },
];

// 기본 공동체 구분
const DEFAULT_COMMUNITY_CATEGORIES = [
  { id: 'cc_church', name: '교회' },
  { id: 'cc_mission', name: '선교' },
  { id: 'cc_sunday', name: '주일학교' },
  { id: 'cc_youth', name: '청년/다음세대' },
  { id: 'cc_nation', name: '나라/사회' },
  { id: 'cc_other', name: '기타' },
];

let state = {
  categories: [],
  communityCategories: [],
  prayers: [],
  communityPrayers: [],
  communityUrl: '',
  churchName: '', // 추가
  darkMode: false, // 추가
  lastDate: '',
  bibleVerses: [],
  verseIndex: 0,
  showVerse: true,
  showCommunity: true,
  appPin: '',
  settings: {}
};

// 현재 열린 상세 카드에 한해서만 인증 유지 (닫으면 다시 요청)
let secretAuthForId = null;

// ---------- Utils ----------
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatKoreanDate(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const days = ['일','월','화','수','목','금','토'];
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${days[d.getDay()]}요일`;
}

function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state = { ...state, ...data };
    }
  } catch (e) {
    console.warn('Load failed', e);
  }

  // 초기화
  if (!state.categories || state.categories.length === 0) {
    state.categories = [...DEFAULT_CATEGORIES];
  }
  if (!state.communityCategories || state.communityCategories.length === 0) {
    state.communityCategories = [...DEFAULT_COMMUNITY_CATEGORIES];
  }
  if (!state.prayers) state.prayers = [];
  if (!state.communityPrayers) state.communityPrayers = [];
  if (!state.bibleVerses || state.bibleVerses.length === 0) {
    state.bibleVerses = [...DEFAULT_VERSES];
  }
  if (typeof state.showVerse !== 'boolean') state.showVerse = true;
  if (typeof state.showCommunity !== 'boolean') state.showCommunity = true;

  // 날짜가 바뀌면 완료 상태 초기화 + 말씀 인덱스 날짜 기준으로 리셋
  const today = todayStr();
  if (state.lastDate !== today) {
    state.prayers.forEach(p => {
      p.completedToday = false;
    });
    // 새 날짜면 말씀도 날짜 기반 시작점으로
    const verses = state.bibleVerses.length ? state.bibleVerses : DEFAULT_VERSES;
    const dayIndex = Math.floor(new Date().setHours(0,0,0,0) / 86400000);
    state.verseIndex = dayIndex % verses.length;
    state.lastDate = today;
    save();
  }
  if (typeof state.verseIndex !== 'number') {
    state.verseIndex = 0;
  }

  if (typeof state.darkMode !== 'boolean') state.darkMode = false;
    applyTheme();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- 일정 관련 ----------
function isPrayerForToday(p) {
  const today = todayStr();
  const type = p.scheduleType || 'daily';

  if (type === 'daily') return true;

  if (type === 'date') {
    return p.scheduleDate === today;
  }

  if (type === 'range') {
    const start = p.scheduleStart || '';
    const end = p.scheduleEnd || '';
    if (!start && !end) return true;
    if (start && today < start) return false;
    if (end && today > end) return false;
    return true;
  }

  if (type === 'weekdays') {
    const days = p.weekdays || [];
    if (days.length === 0) return true;
    const todayDow = new Date().getDay(); // 0=일
    return days.includes(todayDow);
  }

  return true;
}

function scheduleLabel(p) {
  const type = p.scheduleType || 'daily';
  if (type === 'daily') return '매일';
  if (type === 'date') return p.scheduleDate || '날짜 지정';
  if (type === 'range') {
    const s = p.scheduleStart || '?';
    const e = p.scheduleEnd || '?';
    return `${s} ~ ${e}`;
  }
  if (type === 'weekdays') {
    const names = ['일','월','화','수','목','금','토'];
    const days = (p.weekdays || []).map(d => names[d]).join(',');
    return days ? `매주 ${days}` : '요일 지정';
  }
  return '';
}

function isArchived(p) {
  // 수동 보관 또는 기간/날짜 종료 (응답 메모만으로는 보관하지 않음)
  if (p.archived === true) return true;
  const today = todayStr();
  const type = p.scheduleType || 'daily';
  if (type === 'date' && p.scheduleDate && p.scheduleDate < today) return true;
  if (type === 'range' && p.scheduleEnd && p.scheduleEnd < today) return true;
  return false;
}

function getAnswers(p) {
  if (Array.isArray(p.answers) && p.answers.length) return p.answers;
  if (p.answerMemo && p.answerMemo.trim()) {
    return [{ date: p.createdAt || todayStr(), text: p.answerMemo }];
  }
  return [];
}

function getAnswerCount(p) {
  return getAnswers(p).length;
}

function matchesSearch(p, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const answerText = getAnswers(p).map(a => a.text).join(' ');
  return (
    (p.title || '').toLowerCase().includes(q) ||
    (p.content || '').toLowerCase().includes(q) ||
    answerText.toLowerCase().includes(q)
  );
}

function maskTitle(title) {
  if (!title) return '***';
  if (title.length <= 1) return title + '***';
  return title.charAt(0) + '***';
}

function displayTitle(p) {
  if (p.isSecret) return maskTitle(p.title);
  return p.title || '';
}

function prayerListItemHtml(p) {
  const cat = state.categories.find(c => c.id === p.categoryId);
  const catName = cat ? cat.name : '';
  const sched = scheduleLabel(p);
  const ac = getAnswerCount(p);
  const hasAnswer = ac > 0 ? ` · 응답 ${ac}` : '';
  const secret = p.isSecret ? ' · 🔒' : '';
  const archived = isArchived(p) ? ' · 보관' : '';
  return `
    <div class="prayer-item" data-id="${p.id}">
      <div class="prayer-content" style="padding-left:0;">
        <div class="prayer-title">${escapeHtml(displayTitle(p))}</div>
        <div class="prayer-meta">${catName}${sched ? ' · ' + sched : ''}${hasAnswer}${secret}${archived}</div>
      </div>
    </div>
  `;
}

function renderAllPrayers(query = '') {
  const list = document.getElementById('all-prayers');
  const filtered = state.prayers.filter(p => matchesSearch(p, query));
  document.getElementById('all-count').textContent = filtered.length;
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">${query ? '검색 결과가 없습니다.' : '등록된 기도가 없습니다.'}</div>`;
  } else {
    list.innerHTML = filtered.map(prayerListItemHtml).join('');
    list.querySelectorAll('.prayer-item[data-id]').forEach(el => {
      el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
  }
}

function renderArchivePrayers(query = '') {
  const list = document.getElementById('archive-prayers');
  const archived = state.prayers.filter(p => isArchived(p) && matchesSearch(p, query));
  document.getElementById('archive-count').textContent = archived.length;
  if (archived.length === 0) {
    list.innerHTML = `<div class="empty-state">${query ? '검색 결과가 없습니다.' : '보관된 기도가 없습니다.'}</div>`;
  } else {
    list.innerHTML = archived.map(prayerListItemHtml).join('');
    list.querySelectorAll('.prayer-item[data-id]').forEach(el => {
      el.addEventListener('click', () => openDetailModal(el.dataset.id));
    });
  }
}

// ---------- Render ----------
function renderDate() {
  document.getElementById('today-date').textContent = formatKoreanDate();
}

function applySectionVisibility() {
  const verseSection = document.getElementById('section-verse');
  const communitySection = document.getElementById('section-community');
  if (verseSection) verseSection.style.display = state.showVerse ? '' : 'none';
  if (communitySection) communitySection.style.display = state.showCommunity ? '' : 'none';

  // 설정 토글 UI 반영
  const toggleVerse = document.getElementById('toggle-verse');
  const toggleCommunity = document.getElementById('toggle-community');
  if (toggleVerse) toggleVerse.checked = state.showVerse;
  if (toggleCommunity) toggleCommunity.checked = state.showCommunity;
}

function getVerses() {
  return state.bibleVerses.length ? state.bibleVerses : DEFAULT_VERSES;
}

function renderVerse() {
  const verses = getVerses();
  // 처음 로드 시 날짜 기반으로 시작 인덱스 설정 (하루 종일 같은 시작점)
  if (state.verseIndex === undefined || state.verseIndex === null) {
    const dayIndex = Math.floor(new Date().setHours(0,0,0,0) / 86400000);
    state.verseIndex = dayIndex % verses.length;
  }
  // 범위 보정
  if (state.verseIndex < 0 || state.verseIndex >= verses.length) {
    state.verseIndex = 0;
  }
  const verse = verses[state.verseIndex];
  document.getElementById('verse-text').textContent = verse.text || '';
  document.getElementById('verse-ref').textContent = verse.ref || '';
}

function nextVerse() {
  const verses = getVerses();
  state.verseIndex = (state.verseIndex + 1) % verses.length;
  save();
  renderVerse();
}

function renderPrayers() {
  const todayList = document.getElementById('today-prayers');
  const completedList = document.getElementById('completed-prayers');
  const completedSection = document.getElementById('completed-section');

  // 오늘 해당 + 보관되지 않은 기도만
  const todayPrayers = state.prayers.filter(p => isPrayerForToday(p) && !isArchived(p));
  const active = todayPrayers.filter(p => !p.completedToday);
  const done = todayPrayers.filter(p => p.completedToday);

  document.getElementById('today-count').textContent = active.length;
  document.getElementById('completed-count').textContent = done.length;

  if (active.length === 0) {
    todayList.innerHTML = `
      <div class="empty-state">
        오늘 할 기도가 없습니다.<br>
        <button class="btn btn-primary" id="btn-empty-add" style="margin-top:14px; width:auto; padding:10px 20px;">+ 기도 추가하기</button>
      </div>`;
    const emptyBtn = document.getElementById('btn-empty-add');
    if (emptyBtn) emptyBtn.addEventListener('click', () => openPrayerModal());
  } else {
    todayList.innerHTML = active.map(p => prayerItemHtml(p, false)).join('');
  }

  if (done.length === 0) {
    completedSection.classList.add('hidden');
  } else {
    completedSection.classList.remove('hidden');
    completedList.innerHTML = done.map(p => prayerItemHtml(p, true)).join('');
  }

  // 스와이프 완료 + 탭하면 상세
  bindSwipeToComplete(todayList);
  // 완료 목록은 탭만
  completedList.querySelectorAll('.prayer-item[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetailModal(el.dataset.id));
  });
}

function prayerItemHtml(p, isCompleted) {
  const cat = state.categories.find(c => c.id === p.categoryId);
  const catName = cat ? cat.name : '';
  const sched = scheduleLabel(p);
  const ac = getAnswerCount(p);
  const hasAnswer = ac > 0 ? ` · 응답 ${ac}` : '';
  const secret = p.isSecret ? ' · 🔒' : '';
  // 미완료만 스와이프 완료 가능
  const swipeClass = isCompleted ? '' : 'swipeable';
  return `
    <div class="swipe-wrap" data-id="${p.id}">
      ${isCompleted ? '' : '<div class="swipe-action">완료</div>'}
      <div class="prayer-item ${isCompleted ? 'completed' : ''} ${swipeClass}" data-id="${p.id}">
        <div class="prayer-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div class="prayer-content">
          <div class="prayer-title">${escapeHtml(displayTitle(p))}</div>
          <div class="prayer-meta">${catName}${sched ? ' · ' + sched : ''}${hasAnswer}${secret}</div>
        </div>
      </div>
    </div>
  `;
}

function bindSwipeToComplete(container) {
  if (!container) return;
  container.querySelectorAll('.swipe-wrap').forEach(wrap => {
    const item = wrap.querySelector('.prayer-item.swipeable');
    if (!item) return;
    let startX = 0, startY = 0, dx = 0, swiping = false, opened = false;

    const onStart = (e) => {
      const t = e.touches ? e.touches[0] : e;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      swiping = false;
      item.style.transition = 'none';
    };
    const onMove = (e) => {
      const t = e.touches ? e.touches[0] : e;
      const mx = t.clientX - startX;
      const my = t.clientY - startY;
      if (!swiping && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        swiping = true;
      }
      if (!swiping) return;
      if (e.cancelable) e.preventDefault();
      // 왼쪽 스와이프만 (음수)
      dx = Math.min(0, Math.max(mx, -100));
      item.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      item.style.transition = 'transform 0.2s ease';
      if (dx < -60) {
        // 완료 처리
        item.style.transform = 'translateX(-100%)';
        const id = wrap.dataset.id;
        setTimeout(() => {
          const p = state.prayers.find(x => x.id === id);
          if (p) {
            p.completedToday = true;
            save();
            renderPrayers();
            toast('오늘 기도 완료');
          }
        }, 180);
      } else {
        item.style.transform = 'translateX(0)';
      }
      dx = 0;
      swiping = false;
    };

    item.addEventListener('touchstart', onStart, { passive: true });
    item.addEventListener('touchmove', onMove, { passive: false });
    item.addEventListener('touchend', onEnd);
    // 클릭은 상세 열기 (스와이프 아닐 때만)
    item.addEventListener('click', (e) => {
      if (Math.abs(dx) > 10) return;
      openDetailModal(item.dataset.id);
    });
  });
}

function communityCategoryName(id) {
  const c = state.communityCategories.find(x => x.id === id);
  return c ? c.name : '';
}

function isCommunityForToday(p) {
  // 일정 없으면 매일로 취급
  return isPrayerForToday(p);
}

function renderCommunity() {
    const list = document.getElementById('community-prayers');
    const count = document.getElementById('community-count');
    const todayItems = state.communityPrayers.filter(isCommunityForToday);
    count.textContent = todayItems.length;

    // TXT/설정에서 불러온 교회 이름 (예: ShinkwangChurch -> SHINKWANG CHURCH)
    const rawChurch = state.churchName || 'ShinkwangChurch';
    const formattedChurch = rawChurch.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();

    // 상단 커스텀 타이틀 헤더
    let headerHtml = `
    <div class="community-header-title">
      <div class="church-sub-title">${escapeHtml(formattedChurch)}</div>
      <h2 class="church-main-title">신광교회 공동체 기도</h2>
    </div>
  `;

    if (todayItems.length === 0) {
        list.innerHTML = headerHtml + `<div class="empty-state">오늘 해당하는 공동체 기도가 없습니다.<br>「파일로 가져오기」또는 + 로 추가하세요.</div>`;
    } else {
        list.innerHTML = headerHtml + todayItems.map(p => {
            const cat = communityCategoryName(p.categoryId);
            const sched = scheduleLabel(p);
            return `
        <div class="prayer-item" data-cid="${p.id}">
          <div class="prayer-content" style="padding-left:0;">
            <div class="prayer-title">${escapeHtml(p.title)}</div>
            <div class="prayer-meta">${cat}${sched ? ' · ' + sched : ''}</div>
          </div>
        </div>
      `;
        }).join('');

        list.querySelectorAll('.prayer-item[data-cid]').forEach(el => {
            el.addEventListener('click', () => openCommunityDetail(el.dataset.cid));
        });
    }
}

function renderCommunityCategorySelect() {
  const sel = document.getElementById('input-community-category');
  if (!sel) return;
  sel.innerHTML = state.communityCategories.map(c =>
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`
  ).join('');
}

function renderCategoriesSelect() {
  const sel = document.getElementById('input-prayer-category');
  sel.innerHTML = state.categories.map(c => 
    `<option value="${c.id}">${escapeHtml(c.name)}</option>`
  ).join('');
}

function renderCategoryList() {
  const list = document.getElementById('category-list');
  list.innerHTML = state.categories.map(c => `
    <div class="settings-item" style="margin-bottom:6px;">
      <span>${escapeHtml(c.name)}</span>
      <button class="btn-sm" data-del-cat="${c.id}" style="color:#c45;">삭제</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delCat;
      if (state.categories.length <= 1) {
        toast('최소 1개의 카테고리가 필요합니다');
        return;
      }
      state.categories = state.categories.filter(c => c.id !== id);
      // 해당 카테고리 기도는 '나'로 이동하거나 유지
      save();
      renderCategoryList();
      renderCategoriesSelect();
      toast('카테고리가 삭제되었습니다');
    });
  });
}

function applyTheme() {
  if (state.darkMode) {
    document.documentElement.classList.add('dark-mode');
    document.body.classList.add('dark-mode');
  } else {
    document.documentElement.classList.remove('dark-mode');
    document.body.classList.remove('dark-mode');
  }
}

function renderSettings() {
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = APP_VERSION;
  
  // 주소 표시 간략화
  const urlDisplay = document.getElementById('community-url-display');
  if (urlDisplay) {
    urlDisplay.textContent = state.communityUrl ? '주소 설정됨 (터치하여 변경)' : '설정되지 않음';
  }
  
  // 스위치 상태 반영
  const toggleDark = document.getElementById('toggle-darkmode');
  if (toggleDark) {
    toggleDark.checked = !!state.darkMode;
  }

  applySectionVisibility();
  applyTheme();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- Actions ----------
function togglePrayer(id) {
  const p = state.prayers.find(x => x.id === id);
  if (!p) return;
  p.completedToday = !p.completedToday;
  save();
  renderPrayers();
  toast(p.completedToday ? '오늘 기도 완료로 이동했습니다' : '오늘의 기도로 되돌렸습니다');
}

function openPrayerModal(editId = null) {
  if (!state.categories || state.categories.length === 0) {
    state.categories = [...DEFAULT_CATEGORIES];
    save();
  }
  renderCategoriesSelect();
  const modal = document.getElementById('modal-prayer');
  document.getElementById('modal-prayer-title').textContent = editId ? '기도 수정' : '기도 추가';

  document.getElementById('input-prayer-title').value = '';
  document.getElementById('input-prayer-content').value = '';
  document.getElementById('input-schedule-type').value = 'daily';
  document.getElementById('input-schedule-date').value = '';
  document.getElementById('input-schedule-start').value = '';
  document.getElementById('input-schedule-end').value = '';
  document.querySelectorAll('.weekday-check').forEach(c => c.checked = false);
  document.getElementById('input-is-secret').checked = false;
  updateScheduleFields();

  const catSelect = document.getElementById('input-prayer-category');
  if (state.categories.length > 0) catSelect.value = state.categories[0].id;

  if (editId) {
    const p = state.prayers.find(x => x.id === editId);
    if (p) {
      document.getElementById('input-prayer-title').value = p.title || '';
      document.getElementById('input-prayer-content').value = p.content || '';
      if (p.categoryId) catSelect.value = p.categoryId;
      document.getElementById('input-schedule-type').value = p.scheduleType || 'daily';
      document.getElementById('input-schedule-date').value = p.scheduleDate || '';
      document.getElementById('input-schedule-start').value = p.scheduleStart || '';
      document.getElementById('input-schedule-end').value = p.scheduleEnd || '';
      document.getElementById('input-is-secret').checked = !!p.isSecret;
      (p.weekdays || []).forEach(d => {
        const cb = document.querySelector(`.weekday-check[value="${d}"]`);
        if (cb) cb.checked = true;
      });
      updateScheduleFields();
    }
  }

  modal.dataset.editId = editId || '';
  modal.classList.add('open');
  setTimeout(() => document.getElementById('input-prayer-title').focus(), 300);
}

function closePrayerModal() {
  document.getElementById('modal-prayer').classList.remove('open');
}

function updateScheduleFields() {
  const type = document.getElementById('input-schedule-type').value;
  document.getElementById('schedule-date-group').style.display = type === 'date' ? '' : 'none';
  document.getElementById('schedule-range-group').style.display = type === 'range' ? '' : 'none';
  document.getElementById('schedule-weekdays-group').style.display = type === 'weekdays' ? '' : 'none';
}

function getScheduleFromForm() {
  const type = document.getElementById('input-schedule-type').value;
  const result = { scheduleType: type };
  if (type === 'date') {
    result.scheduleDate = document.getElementById('input-schedule-date').value || '';
  } else if (type === 'range') {
    result.scheduleStart = document.getElementById('input-schedule-start').value || '';
    result.scheduleEnd = document.getElementById('input-schedule-end').value || '';
  } else if (type === 'weekdays') {
    result.weekdays = Array.from(document.querySelectorAll('.weekday-check:checked')).map(c => parseInt(c.value, 10));
  }
  return result;
}

async function ensurePinForSecret() {
  if (state.appPin) return true;
  // 비밀번호 설정 모달
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-pin-setup');
    modal.classList.add('open');
    const saveBtn = document.getElementById('btn-pin-setup-save');
    const cancelBtn = document.getElementById('btn-pin-setup-cancel');
    const handler = (ok) => {
      saveBtn.removeEventListener('click', onSave);
      cancelBtn.removeEventListener('click', onCancel);
      modal.classList.remove('open');
      resolve(ok);
    };
    const onSave = () => {
      const pin = document.getElementById('input-pin-setup').value.trim();
      const pin2 = document.getElementById('input-pin-setup2').value.trim();
      if (!pin || pin.length < 4) {
        toast('비밀번호는 4자 이상이어야 합니다');
        return;
      }
      if (pin !== pin2) {
        toast('비밀번호가 일치하지 않습니다');
        return;
      }
      state.appPin = pin;
      save();
      toast('비밀번호가 설정되었습니다');
      // 생체인식 등록 시도
      registerBiometric().then(ok => {
        if (ok) toast('Face ID / 생체인식도 등록되었습니다');
      });
      handler(true);
    };
    const onCancel = () => handler(false);
    saveBtn.addEventListener('click', onSave);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function canUseWebAuthn() {
  return !!(window.PublicKeyCredential && window.isSecureContext && location.protocol === 'https:');
}

async function tryBiometricUnlock() {
  if (!canUseWebAuthn() || !state.webauthnCredentialId) return false;
  try {
    const credId = Uint8Array.from(atob(state.webauthnCredentialId), c => c.charCodeAt(0));
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        rpId: location.hostname,
        userVerification: 'required',
        allowCredentials: [{
          type: 'public-key',
          id: credId,
          transports: ['internal']
        }]
      }
    });
    return !!assertion;
  } catch (e) {
    console.log('biometric failed', e);
    return false;
  }
}

async function registerBiometric() {
  if (!canUseWebAuthn()) {
    toast('생체인식은 HTTPS(깃허브 주소)에서만 사용할 수 있습니다');
    return false;
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      toast('이 기기는 생체인식을 지원하지 않습니다');
      return false;
    }
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: '기도카드', id: location.hostname },
        user: {
          id: userId,
          name: 'prayer-card-secret',
          displayName: '기도카드 비밀기도'
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 90000
      }
    });
    if (cred && cred.rawId) {
      state.webauthnCredentialId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      save();
      return true;
    }
  } catch (e) {
    console.log('biometric register failed', e);
    toast('생체인식 등록이 취소되었거나 실패했습니다');
  }
  return false;
}

// prayerId: 인증 성공 시 이 카드에 한해 상세 모달이 열려 있는 동안만 유지
async function unlockSecret(prayerId) {
  // 같은 카드를 상세에서 다시 그리는 경우만 통과 (응답 추가 등)
  if (prayerId && secretAuthForId === prayerId) return true;

  // 생체인식 등록되어 있으면 먼저 시도
  if (state.webauthnCredentialId && canUseWebAuthn()) {
    const bioOk = await tryBiometricUnlock();
    if (bioOk) {
      if (prayerId) secretAuthForId = prayerId;
      toast('생체인식으로 잠금 해제됨');
      return true;
    }
  }

  // 비밀번호 입력
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-pin-unlock');
    document.getElementById('input-pin-unlock').value = '';
    const bioBtn = document.getElementById('btn-pin-biometric');
    const regBtn = document.getElementById('btn-pin-register-bio');
    if (bioBtn) {
      bioBtn.style.display = (state.webauthnCredentialId && canUseWebAuthn()) ? '' : 'none';
    }
    if (regBtn) {
      // 등록 안 됐고 HTTPS면 등록 버튼 표시
      regBtn.style.display = (!state.webauthnCredentialId && canUseWebAuthn()) ? '' : 'none';
    }
    modal.classList.add('open');
    const okBtn = document.getElementById('btn-pin-unlock');
    const cancelBtn = document.getElementById('btn-pin-unlock-cancel');
    const handler = (ok) => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      if (bioBtn) bioBtn.removeEventListener('click', onBio);
      if (regBtn) regBtn.removeEventListener('click', onReg);
      modal.classList.remove('open');
      resolve(ok);
    };
    const onOk = () => {
      const pin = document.getElementById('input-pin-unlock').value;
      if (pin === state.appPin) {
        if (prayerId) secretAuthForId = prayerId;
        handler(true);
      } else {
        toast('비밀번호가 틀렸습니다');
      }
    };
    const onCancel = () => handler(false);
    const onBio = async () => {
      const bioOk = await tryBiometricUnlock();
      if (bioOk) {
        if (prayerId) secretAuthForId = prayerId;
        handler(true);
      } else {
        toast('생체인식에 실패했습니다. 비밀번호를 입력하세요.');
      }
    };
    const onReg = async () => {
      // 먼저 비번 확인 후 등록
      const pin = document.getElementById('input-pin-unlock').value;
      if (pin !== state.appPin) {
        toast('생체인식 등록 전 비밀번호를 먼저 입력하세요');
        return;
      }
      const ok = await registerBiometric();
      if (ok) {
        toast('생체인식이 등록되었습니다. 다음부터 Face ID를 사용할 수 있습니다');
        if (bioBtn) bioBtn.style.display = '';
        if (regBtn) regBtn.style.display = 'none';
      }
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    if (bioBtn) bioBtn.addEventListener('click', onBio);
    if (regBtn) regBtn.addEventListener('click', onReg);
    setTimeout(() => document.getElementById('input-pin-unlock').focus(), 200);
  });
}

async function savePrayer() {
  const title = document.getElementById('input-prayer-title').value.trim();
  if (!title) {
    toast('제목을 입력해주세요');
    document.getElementById('input-prayer-title').focus();
    return;
  }
  let categoryId = document.getElementById('input-prayer-category').value;
  if (!categoryId && state.categories.length > 0) categoryId = state.categories[0].id;
  const content = document.getElementById('input-prayer-content').value.trim();
  const isSecret = document.getElementById('input-is-secret').checked;
  const schedule = getScheduleFromForm();
  const editId = document.getElementById('modal-prayer').dataset.editId;

  if (isSecret) {
    const ok = await ensurePinForSecret();
    if (!ok) {
      toast('비밀기도를 사용하려면 비밀번호가 필요합니다');
      return;
    }
  }

  if (editId) {
    const p = state.prayers.find(x => x.id === editId);
    if (p) {
      p.title = title;
      p.categoryId = categoryId;
      p.content = content;
      p.isSecret = isSecret;
      Object.assign(p, schedule);
    }
  } else {
    state.prayers.push({
      id: uid(),
      title,
      categoryId: categoryId || 'cat_me',
      content,
      answers: [],
      isSecret,
      archived: false,
      completedToday: false,
      createdAt: todayStr(),
      ...schedule
    });
  }
  save();
  closePrayerModal();
  closeDetailModal();
  renderPrayers();
  if (document.getElementById('page-all').style.display !== 'none') {
    renderAllPrayers(document.getElementById('search-all').value);
  }
  if (document.getElementById('page-archive').style.display !== 'none') {
    renderArchivePrayers(document.getElementById('search-archive').value);
  }
  toast('저장되었습니다');
}

// ---------- 상세 기도 카드 ----------
async function openDetailModal(id) {
  const p = state.prayers.find(x => x.id === id);
  if (!p) return;

  if (p.isSecret) {
    const ok = await unlockSecret(id);
    if (!ok) return;
  }

  const cat = state.categories.find(c => c.id === p.categoryId);
  const answers = getAnswers(p);

  document.getElementById('detail-title').textContent = p.title || '';
  document.getElementById('detail-category').textContent = cat ? cat.name : '';
  document.getElementById('detail-schedule').textContent = scheduleLabel(p) + (p.isSecret ? ' · 🔒비밀' : '');
  document.getElementById('detail-content').textContent = p.content || '(내용 없음)';

  // 응답 목록 렌더
  const answerBox = document.getElementById('detail-answer-list');
  if (answers.length === 0) {
    answerBox.innerHTML = '<div style="color:var(--text-secondary); font-size:0.9rem;">아직 응답 기록이 없습니다.</div>';
  } else {
    answerBox.innerHTML = answers.map(a => `
      <div style="background:var(--accent-soft); padding:10px 12px; border-radius:10px; margin-bottom:6px;">
        <div style="font-size:0.75rem; color:var(--accent); margin-bottom:2px;">${escapeHtml(a.date || '')}</div>
        <div style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(a.text)}</div>
      </div>
    `).join('');
  }

  document.getElementById('input-new-answer').value = '';

  // 보관 버튼 텍스트
  const archiveBtn = document.getElementById('btn-detail-archive');
  if (p.archived) {
    archiveBtn.textContent = '보관 해제';
  } else {
    archiveBtn.textContent = '보관함으로 보내기';
  }

  // 완료 버튼 텍스트 (토글)
  const confirmBtn = document.getElementById('btn-detail-confirm');
  if (p.completedToday) {
    confirmBtn.textContent = '↩ 오늘의 기도로 되돌리기';
  } else {
    confirmBtn.textContent = '✓ 오늘 기도 완료';
  }

  const modal = document.getElementById('modal-detail');
  modal.dataset.prayerId = id;
  modal.classList.add('open');
}

function closeDetailModal() {
  document.getElementById('modal-detail').classList.remove('open');
  // 상세 카드를 닫으면 비밀기도 인증도 초기 (다음에 다시 요청)
  secretAuthForId = null;
}

function detailConfirm() {
  const id = document.getElementById('modal-detail').dataset.prayerId;
  const p = state.prayers.find(x => x.id === id);
  if (p) {
    p.completedToday = !p.completedToday;
    save();
    renderPrayers();
    toast(p.completedToday ? '오늘 기도 완료로 이동했습니다' : '오늘의 기도로 되돌렸습니다');
  }
  closeDetailModal();
}

function detailEdit() {
  const id = document.getElementById('modal-detail').dataset.prayerId;
  closeDetailModal();
  openPrayerModal(id);
}

function detailAddAnswer() {
  const id = document.getElementById('modal-detail').dataset.prayerId;
  const p = state.prayers.find(x => x.id === id);
  if (!p) return;
  const text = document.getElementById('input-new-answer').value.trim();
  if (!text) {
    toast('응답 내용을 입력해주세요');
    return;
  }
  if (!Array.isArray(p.answers)) p.answers = getAnswers(p);
  p.answers.push({ date: todayStr(), text });
  // 구버전 필드 정리
  delete p.answerMemo;
  save();
  openDetailModal(id); // 다시 렌더
  toast('응답이 기록되었습니다');
}

function detailArchive() {
  const id = document.getElementById('modal-detail').dataset.prayerId;
  const p = state.prayers.find(x => x.id === id);
  if (!p) return;
  p.archived = !p.archived;
  save();
  closeDetailModal();
  renderPrayers();
  if (document.getElementById('page-all').style.display !== 'none') {
    renderAllPrayers(document.getElementById('search-all').value);
  }
  if (document.getElementById('page-archive').style.display !== 'none') {
    renderArchivePrayers(document.getElementById('search-archive').value);
  }
  toast(p.archived ? '보관함으로 보냈습니다' : '보관을 해제했습니다');
}

function detailDelete() {
  const id = document.getElementById('modal-detail').dataset.prayerId;
  if (!confirm('이 기도를 삭제할까요?')) return;
  state.prayers = state.prayers.filter(x => x.id !== id);
  save();
  closeDetailModal();
  renderPrayers();
  if (document.getElementById('page-all').style.display !== 'none') {
    renderAllPrayers(document.getElementById('search-all').value);
  }
  if (document.getElementById('page-archive').style.display !== 'none') {
    renderArchivePrayers(document.getElementById('search-archive').value);
  }
  toast('삭제되었습니다');
}

// 공동체 기도 가져오기
async function downloadCommunity() {
  if (!state.communityUrl) {
    toast('먼저 설정에서 주소를 등록해주세요');
    document.getElementById('page-settings').classList.add('active');
    document.getElementById('page-home').classList.remove('active');
    document.getElementById('btn-add-prayer').classList.add('hidden');
    openUrlModal();
    return;
  }

  try {
    toast('가져오는 중...');
    const res = await fetch(state.communityUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('네트워크 오류');
    const text = await res.text();
    const imported = parsePrayerText(text);
    mergeCommunity(imported);
  } catch (e) {
    console.error(e);
    toast('가져오기에 실패했습니다. 주소를 확인해주세요.');
  }
}

function importCommunityFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const imported = parsePrayerText(text);
    mergeCommunity(imported);
  };
  reader.readAsText(file, 'UTF-8');
}

function parsePrayerText(text) {
  let churchName = '';
  const blocks = text.split(/^---$/gm);
  const items = [];

  blocks.forEach(block => {
    const lines = block.split(/\r?\n/).map(l => l.trim());
    let title = '', categoryName = '', scheduleType = 'daily';
    let contentLines = [];
    let isReadingContent = false;

    lines.forEach(line => {
      if (!line) return;
      if (line.startsWith('# CHURCH:')) {
        churchName = line.replace('# CHURCH:', '').trim();
      } else if (line.startsWith('[제목]')) {
        title = line.replace('[제목]', '').trim();
        isReadingContent = false;
      } else if (line.startsWith('[내용]')) {
        const c = line.replace('[내용]', '').trim();
        if (c) contentLines.push(c);
        isReadingContent = true;
      } else if (line.startsWith('[카테고리]')) {
        categoryName = line.replace('[카테고리]', '').trim();
        isReadingContent = false;
      } else if (line.startsWith('[스케줄]')) {
        const s = line.replace('[스케줄]', '').trim();
        if (s === '매일') scheduleType = 'daily';
        isReadingContent = false;
      } else if (isReadingContent) {
        contentLines.push(line);
      }
    });

    if (title) {
      items.push({
        title,
        content: contentLines.join('\n'),
        categoryName: categoryName || '',
        scheduleType
      });
    }
  });

  if (churchName) {
    state.churchName = churchName;
  }

  // 구형 양식(제목 | 내용) 호환성 유지
  if (items.length === 0) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    return lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        title: parts[0] || '',
        content: parts[1] || '',
        categoryName: parts[2] || '',
        scheduleStart: parts[3] || '',
        scheduleEnd: parts[4] || '',
        scheduleType: (parts[3] || parts[4]) ? 'range' : 'daily'
      };
    });
  }

  return items;
}

function resolveCommunityCategory(item) {
  if (item.categoryId && state.communityCategories.some(c => c.id === item.categoryId)) {
    return item.categoryId;
  }
  if (item.categoryName) {
    const found = state.communityCategories.find(c => c.name === item.categoryName);
    if (found) return found.id;
    // 새 구분 자동 추가
    const id = uid();
    state.communityCategories.push({ id, name: item.categoryName });
    return id;
  }
  return state.communityCategories[0]?.id || 'cc_other';
}

function mergeCommunity(imported) {
    // 1. 기존 공동체 기도 및 카테고리 초기화 (덮어쓰기 처리)
    state.communityPrayers = [];

    let added = 0;
    imported.forEach(item => {
        if (!item.title) return;

        state.communityPrayers.push({
            id: uid(),
            title: item.title,
            content: item.content || '',
            categoryId: resolveCommunityCategory(item),
            scheduleType: item.scheduleType || 'daily',
            scheduleDate: item.scheduleDate || '',
            scheduleStart: item.scheduleStart || '',
            scheduleEnd: item.scheduleEnd || '',
            weekdays: item.weekdays || [],
            importedAt: todayStr()
        });
        added++;
    });

    save();
    renderCommunity();
    toast(added > 0 ? `${added}개의 공동체 기도를 새로 등록했습니다.` : '등록할 기도가 없습니다.');
}

// ---------- 공동체 기도 카드 ----------
function openCommunityDetail(id) {
  const p = state.communityPrayers.find(x => x.id === id);
  if (!p) return;
  document.getElementById('cdetail-title').textContent = p.title || '';
  document.getElementById('cdetail-category').textContent = communityCategoryName(p.categoryId) || '구분 없음';
  document.getElementById('cdetail-schedule').textContent = scheduleLabel(p);
  document.getElementById('cdetail-content').textContent = p.content || '(내용 없음)';
  const modal = document.getElementById('modal-community-detail');
  modal.dataset.prayerId = id;
  modal.classList.add('open');
}

function closeCommunityDetail() {
  document.getElementById('modal-community-detail').classList.remove('open');
}

function openCommunityModal(editId = null) {
  renderCommunityCategorySelect();
  const modal = document.getElementById('modal-community');
  document.getElementById('modal-community-title').textContent = editId ? '공동체 기도 수정' : '공동체 기도 추가';
  document.getElementById('input-community-title').value = '';
  document.getElementById('input-community-content').value = '';
  document.getElementById('input-c-schedule-type').value = 'daily';
  document.getElementById('input-c-schedule-date').value = '';
  document.getElementById('input-c-schedule-start').value = '';
  document.getElementById('input-c-schedule-end').value = '';
  document.querySelectorAll('.c-weekday-check').forEach(c => c.checked = false);
  updateCommunityScheduleFields();
  if (state.communityCategories.length) {
    document.getElementById('input-community-category').value = state.communityCategories[0].id;
  }
  if (editId) {
    const p = state.communityPrayers.find(x => x.id === editId);
    if (p) {
      document.getElementById('input-community-title').value = p.title || '';
      document.getElementById('input-community-content').value = p.content || '';
      if (p.categoryId) document.getElementById('input-community-category').value = p.categoryId;
      document.getElementById('input-c-schedule-type').value = p.scheduleType || 'daily';
      document.getElementById('input-c-schedule-date').value = p.scheduleDate || '';
      document.getElementById('input-c-schedule-start').value = p.scheduleStart || '';
      document.getElementById('input-c-schedule-end').value = p.scheduleEnd || '';
      (p.weekdays || []).forEach(d => {
        const cb = document.querySelector(`.c-weekday-check[value="${d}"]`);
        if (cb) cb.checked = true;
      });
      updateCommunityScheduleFields();
    }
  }
  modal.dataset.editId = editId || '';
  modal.classList.add('open');
}

function closeCommunityModal() {
  document.getElementById('modal-community').classList.remove('open');
}

function updateCommunityScheduleFields() {
  const type = document.getElementById('input-c-schedule-type').value;
  document.getElementById('c-schedule-date-group').style.display = type === 'date' ? '' : 'none';
  document.getElementById('c-schedule-range-group').style.display = type === 'range' ? '' : 'none';
  document.getElementById('c-schedule-weekdays-group').style.display = type === 'weekdays' ? '' : 'none';
}

function saveCommunityPrayer() {
  const title = document.getElementById('input-community-title').value.trim();
  if (!title) {
    toast('제목을 입력해주세요');
    return;
  }
  const content = document.getElementById('input-community-content').value.trim();
  const categoryId = document.getElementById('input-community-category').value;
  const type = document.getElementById('input-c-schedule-type').value;
  const schedule = { scheduleType: type };
  if (type === 'date') schedule.scheduleDate = document.getElementById('input-c-schedule-date').value || '';
  if (type === 'range') {
    schedule.scheduleStart = document.getElementById('input-c-schedule-start').value || '';
    schedule.scheduleEnd = document.getElementById('input-c-schedule-end').value || '';
  }
  if (type === 'weekdays') {
    schedule.weekdays = Array.from(document.querySelectorAll('.c-weekday-check:checked')).map(c => parseInt(c.value, 10));
  }
  const editId = document.getElementById('modal-community').dataset.editId;
  if (editId) {
    const p = state.communityPrayers.find(x => x.id === editId);
    if (p) {
      p.title = title;
      p.content = content;
      p.categoryId = categoryId;
      Object.assign(p, schedule);
    }
  } else {
    state.communityPrayers.push({
      id: uid(),
      title,
      content,
      categoryId,
      importedAt: todayStr(),
      ...schedule
    });
  }
  save();
  closeCommunityModal();
  closeCommunityDetail();
  renderCommunity();
  toast('저장되었습니다');
}

function communityDetailEdit() {
  const id = document.getElementById('modal-community-detail').dataset.prayerId;
  closeCommunityDetail();
  openCommunityModal(id);
}

function communityDetailDelete() {
  const id = document.getElementById('modal-community-detail').dataset.prayerId;
  if (!confirm('이 공동체 기도를 삭제할까요?')) return;
  state.communityPrayers = state.communityPrayers.filter(x => x.id !== id);
  save();
  closeCommunityDetail();
  renderCommunity();
  toast('삭제되었습니다');
}

function openUrlModal() {
  document.getElementById('input-community-url').value = state.communityUrl || '';
  document.getElementById('modal-url').classList.add('open');
}

function saveUrl() {
  const url = document.getElementById('input-community-url').value.trim();
  state.communityUrl = url;
  save();
  renderSettings();
  document.getElementById('modal-url').classList.remove('open');
  toast('주소가 저장되었습니다');
}

function addCategory() {
  const name = document.getElementById('input-new-category').value.trim();
  if (!name) {
    toast('이름을 입력해주세요');
    return;
  }
  if (state.categories.some(c => c.name === name)) {
    toast('이미 있는 카테고리입니다');
    return;
  }
  state.categories.push({ id: uid(), name });
  save();
  document.getElementById('input-new-category').value = '';
  renderCategoryList();
  renderCategoriesSelect();
  toast('카테고리가 추가되었습니다');
}

// 성경 업로드
function uploadBible(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    // 간단한 파싱: "구절 | 참조" 또는 그냥 텍스트 줄
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const verses = lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        return { text: parts[0], ref: parts[1] };
      }
      return { text: line, ref: '' };
    }).filter(v => v.text.length > 5);

    if (verses.length === 0) {
      toast('유효한 구절을 찾지 못했습니다');
      return;
    }
    state.bibleVerses = verses;
    save();
    renderVerse();
    toast(`${verses.length}개의 말씀을 불러왔습니다`);
  };
  reader.readAsText(file, 'UTF-8');
}

// 데이터 내보내기
function exportData() {
  const data = {
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    categories: state.categories,
    prayers: state.prayers,
    communityPrayers: state.communityPrayers,
    communityCategories: state.communityCategories,
    communityUrl: state.communityUrl,
    bibleVerses: state.bibleVerses,
    verseIndex: state.verseIndex,
    showVerse: state.showVerse,
    showCommunity: state.showCommunity,
    appPin: state.appPin
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `기도카드_백업_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('내보내기 완료');
}

// 데이터 가져오기
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') {
        toast('올바른 백업 파일이 아닙니다');
        return;
      }

      const prayerCount = (data.prayers || []).length;
      const communityCount = (data.communityPrayers || []).length;
      const msg = `백업 파일을 가져옵니다.\n\n기도 ${prayerCount}개, 공동체 기도 ${communityCount}개\n\n기존 데이터를 덮어쓸까요?`;
      if (!confirm(msg)) return;

      // 데이터 복원
      if (Array.isArray(data.categories) && data.categories.length) {
        state.categories = data.categories;
      }
      if (Array.isArray(data.prayers)) {
        state.prayers = data.prayers;
      }
      if (Array.isArray(data.communityPrayers)) {
        state.communityPrayers = data.communityPrayers;
      }
      if (Array.isArray(data.communityCategories) && data.communityCategories.length) {
        state.communityCategories = data.communityCategories;
      }
      if (typeof data.communityUrl === 'string') {
        state.communityUrl = data.communityUrl;
      }
      if (Array.isArray(data.bibleVerses) && data.bibleVerses.length) {
        state.bibleVerses = data.bibleVerses;
      }
      if (typeof data.verseIndex === 'number') {
        state.verseIndex = data.verseIndex;
      }
      if (typeof data.showVerse === 'boolean') {
        state.showVerse = data.showVerse;
      }
      if (typeof data.showCommunity === 'boolean') {
        state.showCommunity = data.showCommunity;
      }

      // 날짜가 다르면 완료 상태 초기화
      const today = todayStr();
      if (state.lastDate !== today) {
        state.prayers.forEach(p => { p.completedToday = false; });
        state.lastDate = today;
      }

      save();
      renderDate();
      renderVerse();
      renderPrayers();
      renderCommunity();
      renderCategoriesSelect();
      renderSettings();
      applySectionVisibility();
      toast('데이터를 가져왔습니다');
    } catch (err) {
      console.error(err);
      toast('파일을 읽을 수 없습니다. JSON 형식인지 확인해주세요.');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ---------- 버전 확인 ----------
async function checkForUpdate() {
  toast('업데이트 확인 중...');
  try {
    // 캐시 무시하고 최신 version.json 가져오기
    const res = await fetch(VERSION_CHECK_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    const remoteVersion = data.version || data;

    if (remoteVersion === APP_VERSION) {
      toast(`최신 버전입니다 (${APP_VERSION})`);
    } else {
      const ok = confirm(`새 버전(${remoteVersion})이 있습니다.\n지금 새로고침하여 업데이트할까요?`);
      if (ok) {
        // 서비스 워커 캐시 갱신 후 새로고침
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const reg of regs) await reg.unregister();
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        location.reload(true);
      }
    }
  } catch (e) {
    // 로컬 파일로 열었거나 version.json이 없을 때
    toast(`현재 버전 ${APP_VERSION} (오프라인/로컬 모드)`);
  }
}

// ---------- Navigation ----------
function hideAllPages() {
  ['page-home', 'page-all', 'page-archive', 'page-settings'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('active');
      el.style.display = 'none';
    }
  });
}

function setNavActive(page) {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });
}

function showHome() {
  hideAllPages();
  document.getElementById('page-home').style.display = 'block';
  document.getElementById('page-home').classList.add('active');
  document.getElementById('btn-add-prayer').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  setNavActive('home');
  renderPrayers();
  renderCommunity();
}

function showAll() {
  hideAllPages();
  document.getElementById('page-all').style.display = 'block';
  document.getElementById('page-all').classList.add('active');
  document.getElementById('btn-add-prayer').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  setNavActive('all');
  const q = document.getElementById('search-all').value;
  renderAllPrayers(q);
}

function showArchive() {
  hideAllPages();
  document.getElementById('page-archive').style.display = 'block';
  document.getElementById('page-archive').classList.add('active');
  document.getElementById('btn-add-prayer').classList.remove('hidden');
  document.getElementById('bottom-nav').classList.remove('hidden');
  setNavActive('archive');
  const q = document.getElementById('search-archive').value;
  renderArchivePrayers(q);
}

function showSettings() {
  hideAllPages();
  document.getElementById('page-settings').style.display = 'block';
  document.getElementById('page-settings').classList.add('active');
  document.getElementById('btn-add-prayer').classList.add('hidden');
  document.getElementById('bottom-nav').classList.add('hidden');
  renderSettings();
}

// ---------- Init ----------
function init() {
  load();
  renderDate();
  renderVerse();
  renderPrayers();
  renderCommunity();
  renderCategoriesSelect();
  renderSettings();
  applySectionVisibility();

  // 이벤트
  document.getElementById('btn-add-prayer').addEventListener('click', () => openPrayerModal());
  document.getElementById('btn-cancel-prayer').addEventListener('click', closePrayerModal);
  document.getElementById('btn-save-prayer').addEventListener('click', savePrayer);
  document.getElementById('input-schedule-type').addEventListener('change', updateScheduleFields);

  // 상세 카드
  document.getElementById('btn-detail-confirm').addEventListener('click', detailConfirm);
  document.getElementById('btn-detail-edit').addEventListener('click', detailEdit);
  document.getElementById('btn-detail-delete').addEventListener('click', detailDelete);
  document.getElementById('btn-detail-close').addEventListener('click', closeDetailModal);
  document.getElementById('btn-detail-archive').addEventListener('click', detailArchive);
  document.getElementById('btn-add-answer').addEventListener('click', detailAddAnswer);

  document.getElementById('btn-settings').addEventListener('click', showSettings);
  document.getElementById('btn-back-home').addEventListener('click', showHome);

  // 하단 탭
  document.getElementById('nav-home').addEventListener('click', showHome);
  document.getElementById('nav-all').addEventListener('click', showAll);
  document.getElementById('nav-archive').addEventListener('click', showArchive);

  // 검색
  document.getElementById('search-all').addEventListener('input', (e) => {
    renderAllPrayers(e.target.value);
  });
  document.getElementById('search-archive').addEventListener('input', (e) => {
    renderArchivePrayers(e.target.value);
  });

  document.getElementById('btn-download-community').addEventListener('click', downloadCommunity);
  document.getElementById('btn-import-community').addEventListener('click', () => {
    document.getElementById('file-community').click();
  });
  document.getElementById('file-community').addEventListener('change', (e) => {
    if (e.target.files[0]) importCommunityFile(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btn-add-community').addEventListener('click', () => openCommunityModal());
  document.getElementById('btn-cancel-community').addEventListener('click', closeCommunityModal);
  document.getElementById('btn-save-community').addEventListener('click', saveCommunityPrayer);
  document.getElementById('input-c-schedule-type').addEventListener('change', updateCommunityScheduleFields);
  document.getElementById('btn-cdetail-edit').addEventListener('click', communityDetailEdit);
  document.getElementById('btn-cdetail-delete').addEventListener('click', communityDetailDelete);
  document.getElementById('btn-cdetail-close').addEventListener('click', closeCommunityDetail);

  document.getElementById('setting-community-url').addEventListener('click', openUrlModal);
  document.getElementById('btn-cancel-url').addEventListener('click', () => {
    document.getElementById('modal-url').classList.remove('open');
  });
  document.getElementById('btn-save-url').addEventListener('click', saveUrl);

  document.getElementById('setting-categories').addEventListener('click', () => {
    renderCategoryList();
    document.getElementById('modal-categories').classList.add('open');
  });
  document.getElementById('btn-close-categories').addEventListener('click', () => {
    document.getElementById('modal-categories').classList.remove('open');
  });
  document.getElementById('btn-add-category').addEventListener('click', addCategory);

  document.getElementById('setting-bible').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.json';
    input.onchange = (e) => {
      if (e.target.files[0]) uploadBible(e.target.files[0]);
    };
    input.click();
  });

  document.getElementById('setting-export').addEventListener('click', exportData);

  document.getElementById('setting-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  // 다음 말씀
  document.getElementById('btn-next-verse').addEventListener('click', nextVerse);

  // 버전 확인
  document.getElementById('setting-version').addEventListener('click', checkForUpdate);

  // 표시 설정 토글
  document.getElementById('toggle-verse').addEventListener('change', (e) => {
    state.showVerse = e.target.checked;
    save();
    applySectionVisibility();
    toast(state.showVerse ? '오늘의 말씀을 표시합니다' : '오늘의 말씀을 숨겼습니다');
  });
  document.getElementById('toggle-community').addEventListener('change', (e) => {
    state.showCommunity = e.target.checked;
    save();
    applySectionVisibility();
    toast(state.showCommunity ? '공동체 기도를 표시합니다' : '공동체 기도를 숨겼습니다');
  });

  // 모달 바깥 클릭 닫기
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

// 다크모드 스위치 이벤트 (동적 연결 보장)
  const bindDarkMode = () => {
    const toggleDark = document.getElementById('toggle-darkmode');
    if (toggleDark && !toggleDark.dataset.bound) {
      toggleDark.dataset.bound = 'true';
      toggleDark.addEventListener('change', (e) => {
        state.darkMode = e.target.checked;
        save();
        applyTheme();
        toast(state.darkMode ? '다크 모드가 적용되었습니다' : '라이트 모드가 적용되었습니다');
      });
    }
  };

  // 설정 이동 시에도 이벤트 연결 재확인
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    showSettings();
    bindDarkMode();
  });

  bindDarkMode();
  applyTheme(); // 초기 실행 시 테마 강제 적용

  // 홈 표시
  showHome();
}

document.addEventListener('DOMContentLoaded', init);
