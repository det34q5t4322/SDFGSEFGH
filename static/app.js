/* ════════════════════════════════════════
   COLLEGE SCHEDULE APP — app.js
   Современный интерфейс: sidebar, day-strip,
   live-card, плиточный выбор групп,
   интерактивный список преподавателей и аудиторий
════════════════════════════════════════ */

'use strict';

// ── THEME & PREFERENCES INITIALIZATION (Zero-flicker) ─
const STORAGE_THEME        = 'college_schedule_theme';
const STORAGE_FONT_FAMILY  = 'schedule_font_family';
const STORAGE_FONT_SIZE    = 'schedule_font_size';
const STORAGE_SHOW_TEACHER = 'schedule_show_teacher';
const STORAGE_SHOW_ROOM    = 'schedule_show_room';
const STORAGE_SHOW_BADGES  = 'schedule_show_badges';
const STORAGE_SHOW_BREAKS  = 'schedule_show_breaks';

(function() {
  try {
    const savedTheme = localStorage.getItem(STORAGE_THEME) || 'obsidian';
    document.documentElement.setAttribute('data-theme', savedTheme);
    const savedFont = localStorage.getItem(STORAGE_FONT_FAMILY) || 'system';
    document.documentElement.setAttribute('data-font', savedFont);
    const savedSize = localStorage.getItem(STORAGE_FONT_SIZE) || 'normal';
    document.documentElement.setAttribute('data-font-size', savedSize);
    if (localStorage.getItem(STORAGE_SHOW_TEACHER) === 'false') {
      document.documentElement.setAttribute('data-hide-teacher', 'true');
    }
    if (localStorage.getItem(STORAGE_SHOW_ROOM) === 'false') {
      document.documentElement.setAttribute('data-hide-room', 'true');
    }
    if (localStorage.getItem(STORAGE_SHOW_BADGES) === 'false') {
      document.documentElement.setAttribute('data-hide-badges', 'true');
    }
    if (localStorage.getItem(STORAGE_SHOW_BREAKS) === 'false') {
      document.documentElement.setAttribute('data-hide-breaks', 'true');
    }
  } catch (_) {}
})();

// ── ICONS (Lucide SVG System) ──────────────
const ICONS = {
  calendar: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
  calendarDays: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>',
  gradCap: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/></svg>',
  door: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h20"/><path d="M13 20V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16"/><path d="M9 12v.01"/></svg>',
  book: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 2v14l3-2 3 2V2"/></svg>',
  palette: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  users: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  refresh: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
  clock: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  mapPin: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
  user: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  coffee: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/></svg>',
  utensils: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"/><path d="M15 11v11"/><path d="M5 2v14a3 3 0 0 0 3 3v3"/><path d="M8 2v6"/><path d="M5 2h3"/></svg>',
  swap: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>',
  ban: '<svg class="lucide-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
  check: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  extLink: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  alert: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  chevronLeft: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  moon: '<svg class="lucide-icon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  play: '<svg class="lucide-icon" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>'
};

// ── CONFIG ──────────────────────────────
const API = '/api';
const STORAGE_GROUP   = 'schedule_group_v2';
const STORAGE_PARITY  = 'schedule_parity';
const STORAGE_CACHE_PREFIX = 'schedule_cache_v2_';
const AUTO_REFRESH_MS = 30_000;

const DAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
const DAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const DAYS_EN_ORDER = [1,2,3,4,5,6]; // Пн-Сб

const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

const DEFAULT_GROUPS = [
  {"name": "ИИ11-26АП", "course": "1 курс"}, {"name": "ИИ11-26БП", "course": "1 курс"},
  {"name": "ИИ9-26АП", "course": "1 курс"}, {"name": "ИИ9-26БП", "course": "1 курс"},
  {"name": "ИИ9-26ВП", "course": "1 курс"}, {"name": "ИСС9-26", "course": "1 курс"},
  {"name": "ОИБ11-26П", "course": "1 курс"}, {"name": "ОИБ9-26А", "course": "1 курс"},
  {"name": "ОИБ9-26Б", "course": "1 курс"}, {"name": "ОИБ9-26П", "course": "1 курс"},
  {"name": "РЛ11-26П", "course": "1 курс"}, {"name": "РЛ9-26П", "course": "1 курс"},
  {"name": "РУП11-26П", "course": "1 курс"}, {"name": "РУП9-26А", "course": "1 курс"},
  {"name": "РУП9-26АП", "course": "1 курс"}, {"name": "РУП9-26Б", "course": "1 курс"},
  {"name": "РУП9-26БП", "course": "1 курс"}, {"name": "СР9-26", "course": "1 курс"},
  {"name": "ССА11-26П", "course": "1 курс"}, {"name": "ССА9-26А", "course": "1 курс"},
  {"name": "ССА9-26Б", "course": "1 курс"}, {"name": "ССА9-26П", "course": "1 курс"},
  {"name": "ЭБ11-26П", "course": "1 курс"}, {"name": "ЭБ9-26П", "course": "1 курс"},
  {"name": "ИИ9-25АП", "course": "2 курс"}, {"name": "ИИ9-25БП", "course": "2 курс"},
  {"name": "ИИ9-25ВП", "course": "2 курс"}, {"name": "ИСП11-25П", "course": "2 курс"},
  {"name": "ИСП11-25оз", "course": "Очно-заочное"}, {"name": "ИСП9-25", "course": "2 курс"},
  {"name": "ИСП9-25АП", "course": "2 курс"}, {"name": "ИСП9-25БП", "course": "2 курс"},
  {"name": "ИСП9-25ВП", "course": "2 курс"}, {"name": "ИСС9-25", "course": "2 курс"},
  {"name": "ОИБ11-25П", "course": "2 курс"}, {"name": "ОИБ9-25", "course": "2 курс"},
  {"name": "ОИБ9-25АП", "course": "2 курс"}, {"name": "ОИБ9-25БП", "course": "2 курс"},
  {"name": "РЛ9-25П", "course": "2 курс"}, {"name": "СР9-25", "course": "2 курс"},
  {"name": "ССА11-25П", "course": "2 курс"}, {"name": "ССА9-25А", "course": "2 курс"},
  {"name": "ССА9-25Б", "course": "2 курс"}, {"name": "ССА9-25П", "course": "2 курс"},
  {"name": "ЭБ9-25П", "course": "2 курс"}, {"name": "ИСП11-24П", "course": "3 курс"},
  {"name": "ИСП11-24оз", "course": "Очно-заочное"}, {"name": "ИСП9-24А", "course": "3 курс"},
  {"name": "ИСП9-24АП", "course": "3 курс"}, {"name": "ИСП9-24Б", "course": "3 курс"},
  {"name": "ИСП9-24БП", "course": "3 курс"}, {"name": "ИСС9-24", "course": "3 курс"},
  {"name": "ОИБ11-24П", "course": "3 курс"}, {"name": "ОИБ9-24А", "course": "3 курс"},
  {"name": "ОИБ9-24Б", "course": "3 курс"}, {"name": "ОИБ9-24П", "course": "3 курс"},
  {"name": "СР9-24", "course": "3 курс"}, {"name": "ССА9-24А", "course": "3 курс"},
  {"name": "ССА9-24Б", "course": "3 курс"}, {"name": "ССА9-24П", "course": "3 курс"},
  {"name": "ИСП11-23АПоз", "course": "Очно-заочное"}, {"name": "ИСП11-23ВПоз", "course": "Очно-заочное"},
  {"name": "ИСП9-23А", "course": "4 курс"}, {"name": "ИСП9-23Б", "course": "4 курс"},
  {"name": "ИСП9-23В", "course": "4 курс"}, {"name": "ИСП9-23Г", "course": "4 курс"},
  {"name": "ИСС9-23", "course": "4 курс"}, {"name": "ОИБ9-23А", "course": "4 курс"},
  {"name": "ОИБ9-23Б", "course": "4 курс"}, {"name": "ОИБ9-23В", "course": "4 курс"},
  {"name": "СР9-23", "course": "4 курс"}, {"name": "ССА11-23оз", "course": "Очно-заочное"},
  {"name": "ССА9-23А", "course": "4 курс"}, {"name": "ССА9-23Б", "course": "4 курс"},
  {"name": "ССА9-23В", "course": "4 курс"}, {"name": "РУП11-26оз", "course": "Очно-заочное"},
  {"name": "ССА11-26оз", "course": "Очно-заочное"}
];

const DEFAULT_GROUP = 'ИСС9-25';

// ── STATE ───────────────────────────────
const S = {
  group:              localStorage.getItem(STORAGE_GROUP) || DEFAULT_GROUP,
  activeGid:          '',
  parity:             'auto',
  parityOverride:     null,         // 'num' | 'den' | null (ручное переключение чётности через чип в шапке)
  weekOffset:         0,            // 0 = текущая неделя, 1 = следующая, -1 = предыдущая
  view:               'today',      // today | week | teacher | classroom
  selectedDay:        null,         // 1-6 (Пн-Сб), null = сегодня
  data:               null,
  groupsList:         DEFAULT_GROUPS,
  teachersList:       [],
  classroomsList:     [],
  selectedTeacher:    null,
  selectedClassroom:  null,
  tabs:               [],
  manualTabMode:      false,        // true = пользователь явно выбрал вкладку в сайдбаре
  isNotPublished:     false,        // true = расписание на выбранную дату ещё не опубликовано
  refreshTimer:       null,
  isLoading:          false,        // true = запрос расписания в процессе
  isNavigatingWeek:   false,        // true = переключение недели выполняется
};

// ── FAULT TOLERANCE & NETWORK HELPERS ───
function logApp(level, msg, data = null) {
  const t = new Date().toLocaleTimeString('ru-RU');
  const tag = `[Schedule ${t}]`;
  if (level === 'error') console.error(tag, msg, data || '');
  else if (level === 'warn') console.warn(tag, msg, data || '');
  else console.log(tag, msg, data || '');
}

function showOfflineBanner(message, isWakingUp = false) {
  if (!els.offlineBanner || !els.offlineBannerText) return;
  els.offlineBannerText.textContent = message;
  els.offlineBanner.className = 'offline-banner' + (isWakingUp ? ' waking-up' : '');
  if (els.offlineBannerRetryBtn) {
    els.offlineBannerRetryBtn.style.display = isWakingUp ? 'none' : 'inline-flex';
  }
  els.offlineBanner.style.display = 'flex';
}

function hideOfflineBanner() {
  if (els.offlineBanner) {
    els.offlineBanner.style.display = 'none';
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Превышено время ожидания ответа сервера (${Math.round(timeoutMs / 1000)}с)`);
    }
    throw err;
  }
}

// ── DOM REFS ────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  sidebar:              $('sidebar'),
  sidebarOverlay:       $('sidebarOverlay'),
  menuBtn:              $('menuBtn'),
  sidebarGroupName:     $('sidebarGroupName'),
  sidebarGroupAvatar:   $('sidebarGroupAvatar'),
  sidebarTabList:       $('sidebarTabList'),
  sidebarSyncStatus:    $('sidebarSyncStatus'),
  sidebarUpdated:       $('sidebarUpdated'),
  sidebarChangeGroup:   $('sidebarChangeGroup'),
  sidebarRefresh:       $('sidebarRefresh'),

  topbarGroupName:      $('topbarGroupName'),
  topbarParity:         $('topbarParity'),

  liveCard:             $('liveCard'),
  liveCardIcon:         $('liveCardIcon'),
  liveCardTitle:        $('liveCardTitle'),
  liveCardSub:          $('liveCardSub'),
  liveCardProgress:     $('liveCardProgress'),
  liveCardCloseBtn:     $('liveCardCloseBtn'),
  liveCardRestoreBtn:   $('liveCardRestoreBtn'),
  liveRestoreIcon:      $('liveRestoreIcon'),
  liveRestoreText:      $('liveRestoreText'),

  topbarThemeBtn:       $('topbarThemeBtn'),
  sidebarThemeBtn:      $('sidebarThemeBtn'),
  themeModal:           $('themeModal'),
  closeThemeModal:      $('closeThemeModal'),
  themesGrid:           $('themesGrid'),

  dayStrip:             $('dayStrip'),
  prevWeekBtn:          $('prevWeekBtn'),
  nextWeekBtn:          $('nextWeekBtn'),
  weekNavRange:         $('weekNavRange'),
  weekNavBadge:         $('weekNavBadge'),

  scheduleView:         $('scheduleView'),

  // Преподаватели
  teacherView:          $('teacherView'),
  teacherSearchInput:   $('teacherSearchInput'),
  teacherSearchBtn:     $('teacherSearchBtn'),
  teacherSelectWrap:    $('teacherSelectWrap'),
  teacherCountBadge:    $('teacherCountBadge'),
  teachersGrid:         $('teachersGrid'),
  teacherResult:        $('teacherResult'),

  // Аудитории
  classroomView:        $('classroomView'),
  classroomSearchInput: $('classroomSearchInput'),
  classroomSearchBtn:   $('classroomSearchBtn'),
  classroomSelectWrap:  $('classroomSelectWrap'),
  classroomCountBadge:  $('classroomCountBadge'),
  classroomsGrid:       $('classroomsGrid'),
  classroomResult:      $('classroomResult'),

  // Статистика
  statsView:            $('statsView'),
  statsContainer:       $('statsContainer'),

  // Английский язык (Сигнализация тревоги)
  englishView:          $('englishView'),
  sidebarEnglish:       $('sidebarEnglish'),

  // Модальные окна
  groupModal:           $('groupModal'),
  closeGroupModal:      $('closeGroupModal'),
  groupSearchInput:     $('groupSearchInput'),
  groupsGrid:           $('groupsGrid'),
  courseChips:          $('courseChips'),

  onboardModal:         $('onboardModal'),
  onboardSearchInput:   $('onboardSearchInput'),
  onboardGroupsGrid:    $('onboardGroupsGrid'),
  onboardCourseChips:   $('onboardCourseChips'),

  // Отказоустойчивость и оффлайн-баннер
  offlineBanner:         $('offlineBanner'),
  offlineBannerText:     $('offlineBannerText'),
  offlineBannerRetryBtn: $('offlineBannerRetryBtn'),

  // Конструктор интерфейса
  mainFlowContainer:        $('mainFlowContainer'),
  layoutEditorBar:          $('layoutEditorBar'),
  sidebarLayoutEditorBtn:   $('sidebarLayoutEditorBtn'),
  sidebarResetLayoutBtn:    $('sidebarResetLayoutBtn'),
  modalOpenLayoutEditorBtn: $('modalOpenLayoutEditorBtn'),
  modalResetLayoutBtn:      $('modalResetLayoutBtn'),
  layoutSaveBtn:            $('layoutSaveBtn'),
  layoutCancelBtn:          $('layoutCancelBtn'),
  layoutResetBtn:           $('layoutResetBtn'),
  presetStandardBtn:        $('presetStandardBtn'),
  presetDaysFirstBtn:       $('presetDaysFirstBtn'),
  presetScheduleFocusBtn:   $('presetScheduleFocusBtn'),
};

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
async function init() {
  try { setupThemes(); } catch (e) { console.error('setupThemes error:', e); }
  try { setupSidebar(); } catch (e) { console.error('setupSidebar error:', e); }
  try { setupSidebarNav(); } catch (e) { console.error('setupSidebarNav error:', e); }
  try { setupWeekNav(); } catch (e) { console.error('setupWeekNav error:', e); }
  try { setupSearchInputs(); } catch (e) { console.error('setupSearchInputs error:', e); }
  try { initLayoutManager(); } catch (e) { console.error('initLayoutManager error:', e); }

  // Привязка повтора в оффлайн-баннере
  els.offlineBannerRetryBtn?.addEventListener('click', async () => {
    if (els.offlineBannerRetryBtn.classList.contains('is-loading')) return;
    const svg = els.offlineBannerRetryBtn.querySelector('svg');
    if (svg) svg.classList.add('is-spinning');
    els.offlineBannerRetryBtn.classList.add('is-loading');
    try {
      await loadSchedule(true);
    } finally {
      if (svg) svg.classList.remove('is-spinning');
      els.offlineBannerRetryBtn?.classList.remove('is-loading');
    }
  });

  // 1. Извлекаем группу с приоритетом на сохранённый выбор пользователя
  let urlGroup = null;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    urlGroup = urlParams.get('group') || urlParams.get('tgWebAppStartParam');
  } catch (_) {}

  let savedGroup = null;
  try {
    savedGroup = localStorage.getItem(STORAGE_GROUP) || localStorage.getItem('schedule_group');
    if (savedGroup === 'null' || savedGroup === 'undefined' || !savedGroup.trim()) {
      savedGroup = null;
    }
  } catch (_) {}

  // Определение группы:
  // Если пользователь открыл прямую ссылку на ДРУГУЮ группу (не дефолтную и не сохранённую) — уважаем ссылку
  if (urlGroup && urlGroup !== DEFAULT_GROUP && urlGroup !== savedGroup) {
    S.group = urlGroup;
  } else if (savedGroup) {
    S.group = savedGroup;
  } else if (urlGroup) {
    S.group = urlGroup;
  } else {
    S.group = DEFAULT_GROUP;
  }

  try {
    localStorage.setItem(STORAGE_GROUP, S.group);
    localStorage.setItem('schedule_group', S.group);
    const u = new URL(window.location.href);
    u.searchParams.set('group', S.group);
    window.history.replaceState(null, '', u.toString());
  } catch (_) {}

  // 2. СРАЗУ (0 мс) обновляем шапку, сайдбар и карточку дня
  updateSidebarGroupInfo();
  try { buildDayStrip(); } catch (e) { console.error('buildDayStrip error:', e); }
  try { updateTopbarParity(); } catch (e) { console.error('updateTopbarParity error:', e); }
  try { startLiveCardClock(); } catch (e) { console.error('startLiveCardClock error:', e); }

  // 3. Синхронизация с сервером Telegram и CloudStorage
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (tgUser?.id) {
    try {
      fetch(`/api/user-group?user_id=${tgUser.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.group && data.group !== S.group && !savedGroup) {
            S.group = data.group;
            try {
              localStorage.setItem(STORAGE_GROUP, data.group);
              const u = new URL(window.location.href);
              u.searchParams.set('group', data.group);
              window.history.replaceState(null, '', u.toString());
            } catch (_) {}
            updateSidebarGroupInfo();
            loadSchedule();
          }
        })
        .catch(() => {});
    } catch (_) {}
  }

  if (window.Telegram?.WebApp?.CloudStorage) {
    try {
      window.Telegram.WebApp.CloudStorage.getItem(STORAGE_GROUP, (err, val) => {
        if (!err && val && val !== 'null' && val !== 'undefined') {
          if (val !== S.group && !savedGroup) {
            S.group = val;
            try {
              localStorage.setItem(STORAGE_GROUP, val);
              const u = new URL(window.location.href);
              u.searchParams.set('group', val);
              window.history.replaceState(null, '', u.toString());
            } catch (_) {}
            updateSidebarGroupInfo();
            loadSchedule();
          }
        } else if (S.group) {
          window.Telegram.WebApp.CloudStorage.setItem(STORAGE_GROUP, S.group);
        }
      });
    } catch (_) {}
  }

  // 4. Загружаем данные расписания
  loadSchedule();
  startAutoRefresh();
}

// ════════════════════════════════════════
//  THEMES & CUSTOMIZATION
// ════════════════════════════════════════
const THEMES = [
  { id: 'obsidian',  name: 'Obsidian Night',   bg: '#0b0c16', sidebar: '#0f101c', card: '#131422', accent: '#4f8ef7', dot2: '#22c55e', text: '#f0f2fa' },
  { id: 'carbon',    name: 'Midnight Carbon',  bg: '#09090b', sidebar: '#0d0d10', card: '#121215', accent: '#38bdf8', dot2: '#34d399', text: '#f4f4f6' },
  { id: 'tokyo',     name: 'Cyber Tokyo',      bg: '#090a16', sidebar: '#0e1020', card: '#121427', accent: '#f43f5e', dot2: '#8b5cf6', text: '#fafafc' },
  { id: 'crimson',   name: 'Crimson Dusk',     bg: '#0e0609', sidebar: '#17080c', card: '#180c12', accent: '#f43f5e', dot2: '#fb7185', text: '#fff1f2' },
  { id: 'abyss',     name: 'Ocean Abyss',      bg: '#050c18', sidebar: '#071020', card: '#0a182c', accent: '#06b6d4', dot2: '#38bdf8', text: '#ecfeff' },
  { id: 'synthwave', name: 'Sunset 80s',       bg: '#110720', sidebar: '#140926', card: '#1c0d33', accent: '#ff6b2b', dot2: '#d946ef', text: '#fff7ed' },
  { id: 'matrix',    name: 'Matrix Neon',      bg: '#030904', sidebar: '#050e06', card: '#08160a', accent: '#00ff66', dot2: '#22c55e', text: '#dcfce7' },
  { id: 'solar',     name: 'Solar Gold',       bg: '#11100e', sidebar: '#151311', card: '#1a1815', accent: '#eab308', dot2: '#f59e0b', text: '#fefce8' },
  { id: 'forest',    name: 'Nord Forest',      bg: '#070e0d', sidebar: '#0a1715', card: '#0e1b19', accent: '#10b981', dot2: '#34d399', text: '#edfcf6' },
  { id: 'emerald',   name: 'Cyber Emerald',    bg: '#05110e', sidebar: '#071511', card: '#0c201b', accent: '#14b8a6', dot2: '#2dd4bf', text: '#f0fdfa' },
  { id: 'amethyst',  name: 'Amethyst Dusk',    bg: '#0d0b18', sidebar: '#130f24', card: '#18132e', accent: '#c084fc', dot2: '#a855f7', text: '#f5f3ff' },
  { id: 'mocha',     name: 'Warm Mocha',       bg: '#120f0d', sidebar: '#17120e', card: '#1c1713', accent: '#f59e0b', dot2: '#d97706', text: '#fff7ed' },
  { id: 'ice',       name: 'Arctic Ice',       bg: '#070f1a', sidebar: '#091321', card: '#0e1c2e', accent: '#38bdf8', dot2: '#67e8f9', text: '#f0f9ff' },
  { id: 'terminal',  name: 'Amber CRT',        bg: '#050505', sidebar: '#090909', card: '#0b0b0b', accent: '#ffb000', dot2: '#4ade80', text: '#ffdf80' },
  { id: 'light',     name: 'Nordic Light',     bg: '#f4f5f8', sidebar: '#ffffff', card: '#ffffff', accent: '#2563eb', dot2: '#16a34a', text: '#0f172a' },
  { id: 'sakura',    name: 'Sakura Pastel',    bg: '#fbf5f8', sidebar: '#ffffff', card: '#ffffff', accent: '#ec4899', dot2: '#f43f5e', text: '#27121e' }
];

const STORAGE_MINIMAL = 'schedule_minimal_mode';

function getStoredTheme() {
  return localStorage.getItem(STORAGE_THEME) || 'obsidian';
}

function isMinimalMode() {
  return localStorage.getItem(STORAGE_MINIMAL) === 'true';
}

function applyMinimalMode(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-minimal', 'true');
  } else {
    document.documentElement.removeAttribute('data-minimal');
  }
  localStorage.setItem(STORAGE_MINIMAL, enabled ? 'true' : 'false');
  if (window.Telegram?.WebApp?.CloudStorage) {
    try {
      Telegram.WebApp.CloudStorage.setItem(STORAGE_MINIMAL, enabled ? 'true' : 'false', () => {});
    } catch (_) {}
  }
  const toggle = document.getElementById('minimalModeToggle');
  if (toggle && toggle.checked !== enabled) toggle.checked = enabled;
}

function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId);
  localStorage.setItem(STORAGE_THEME, themeId);
  renderThemesGrid();
}

// ── FONT FAMILY & SIZE MANAGEMENT ──
function getStoredFontFamily() {
  let val = localStorage.getItem(STORAGE_FONT_FAMILY) || 'system';
  if (val === 'rounded') val = 'comic';
  if (val === 'tech') val = 'courier';
  if (val === 'mono') val = 'pixel';
  return val;
}

function applyFontFamily(fontId) {
  if (fontId === 'rounded') fontId = 'comic';
  if (fontId === 'tech') fontId = 'courier';
  if (fontId === 'mono') fontId = 'pixel';
  document.documentElement.setAttribute('data-font', fontId);
  localStorage.setItem(STORAGE_FONT_FAMILY, fontId);
  if (window.Telegram?.WebApp?.CloudStorage) {
    try { Telegram.WebApp.CloudStorage.setItem(STORAGE_FONT_FAMILY, fontId, () => {}); } catch (_) {}
  }
  updateFontFamilyUI();
}

function updateFontFamilyUI() {
  const cur = getStoredFontFamily();
  document.querySelectorAll('#fontFamilyGrid .font-chip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === cur);
  });
}

function getStoredFontSize() {
  return localStorage.getItem(STORAGE_FONT_SIZE) || 'normal';
}

function applyFontSize(sizeId) {
  document.documentElement.setAttribute('data-font-size', sizeId);
  localStorage.setItem(STORAGE_FONT_SIZE, sizeId);
  if (window.Telegram?.WebApp?.CloudStorage) {
    try { Telegram.WebApp.CloudStorage.setItem(STORAGE_FONT_SIZE, sizeId, () => {}); } catch (_) {}
  }
  updateFontSizeUI();
}

function updateFontSizeUI() {
  const cur = getStoredFontSize();
  document.querySelectorAll('#fontSizeSegmented .font-size-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === cur);
  });
}

// ── CARD DISPLAY OPTIONS ──
const DISPLAY_OPTION_CONFIGS = [
  { id: 'toggleShowTeacher', key: STORAGE_SHOW_TEACHER, attr: 'data-hide-teacher' },
  { id: 'toggleShowRoom',    key: STORAGE_SHOW_ROOM,    attr: 'data-hide-room' },
  { id: 'toggleShowBadges',  key: STORAGE_SHOW_BADGES,  attr: 'data-hide-badges' },
  { id: 'toggleShowBreaks',  key: STORAGE_SHOW_BREAKS,  attr: 'data-hide-breaks' },
];

function getStoredDisplayOption(key, defaultVal = true) {
  const val = localStorage.getItem(key);
  if (val === null) return defaultVal;
  return val === 'true';
}

function applyDisplayOption(storageKey, dataAttr, isVisible) {
  if (isVisible) {
    document.documentElement.removeAttribute(dataAttr);
  } else {
    document.documentElement.setAttribute(dataAttr, 'true');
  }
  localStorage.setItem(storageKey, isVisible ? 'true' : 'false');
  if (window.Telegram?.WebApp?.CloudStorage) {
    try { Telegram.WebApp.CloudStorage.setItem(storageKey, isVisible ? 'true' : 'false', () => {}); } catch (_) {}
  }
}

function setupDisplayOptions() {
  DISPLAY_OPTION_CONFIGS.forEach(c => {
    const isVis = getStoredDisplayOption(c.key, true);
    applyDisplayOption(c.key, c.attr, isVis);
    const el = document.getElementById(c.id);
    if (el) {
      el.checked = isVis;
      el.onchange = e => {
        applyDisplayOption(c.key, c.attr, e.target.checked);
      };
    }
  });
}

function setupThemes() {
  applyTheme(getStoredTheme());
  applyMinimalMode(isMinimalMode());
  applyFontFamily(getStoredFontFamily());
  applyFontSize(getStoredFontSize());
  setupDisplayOptions();

  // Привязка кнопок шрифта
  document.querySelectorAll('#fontFamilyGrid .font-chip-btn').forEach(btn => {
    btn.onclick = () => applyFontFamily(btn.dataset.font);
  });

  // Привязка кнопок размера текста
  document.querySelectorAll('#fontSizeSegmented .font-size-btn').forEach(btn => {
    btn.onclick = () => applyFontSize(btn.dataset.size);
  });

  if (window.Telegram?.WebApp?.CloudStorage) {
    try {
      Telegram.WebApp.CloudStorage.getItem(STORAGE_MINIMAL, (err, val) => {
        if (!err && val !== null && val !== undefined) {
          const cloudVal = (val === 'true');
          if (cloudVal !== isMinimalMode()) {
            applyMinimalMode(cloudVal);
          }
        }
      });
      Telegram.WebApp.CloudStorage.getItem(STORAGE_FONT_FAMILY, (err, val) => {
        if (!err && val && val !== getStoredFontFamily()) applyFontFamily(val);
      });
      Telegram.WebApp.CloudStorage.getItem(STORAGE_FONT_SIZE, (err, val) => {
        if (!err && val && val !== getStoredFontSize()) applyFontSize(val);
      });
    } catch (_) {}
  }

  const minToggle = document.getElementById('minimalModeToggle');
  minToggle?.addEventListener('change', e => {
    applyMinimalMode(e.target.checked);
  });

  els.topbarThemeBtn?.addEventListener('click', openThemeModal);
  els.sidebarThemeBtn?.addEventListener('click', () => {
    closeSidebar();
    openThemeModal();
  });
  els.closeThemeModal?.addEventListener('click', closeThemeModal);
  els.themeModal?.addEventListener('click', e => {
    if (e.target === els.themeModal) closeThemeModal();
  });
}

function openThemeModal() {
  renderThemesGrid();
  updateFontFamilyUI();
  updateFontSizeUI();

  const minToggle = document.getElementById('minimalModeToggle');
  if (minToggle) minToggle.checked = isMinimalMode();

  DISPLAY_OPTION_CONFIGS.forEach(c => {
    const el = document.getElementById(c.id);
    if (el) el.checked = getStoredDisplayOption(c.key, true);
  });

  els.themeModal?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeThemeModal() {
  els.themeModal?.classList.remove('open');
  document.body.style.overflow = '';
}

function renderThemesGrid() {
  if (!els.themesGrid) return;
  const curTheme = getStoredTheme();

  els.themesGrid.innerHTML = THEMES.map(t => {
    const isAct = (t.id === curTheme);
    return `
      <div class="theme-card${isAct ? ' active' : ''}" data-theme-id="${t.id}">
        <div class="theme-preview-box" style="background:${t.bg}; border-color:${isAct ? t.accent : 'rgba(255,255,255,0.08)'}">
          <div class="theme-preview-mini-sidebar" style="background:${t.sidebar}"></div>
          <div class="theme-preview-mini-cards">
            <div class="theme-preview-mini-card" style="background:${t.card}; border-color:${t.accent}40">
              <div class="theme-preview-mini-dot" style="background:${t.accent}"></div>
              <div class="theme-preview-mini-bar" style="background:${t.text}"></div>
            </div>
            <div class="theme-preview-mini-card" style="background:${t.card}">
              <div class="theme-preview-mini-dot" style="background:${t.dot2}"></div>
              <div class="theme-preview-mini-bar" style="background:${t.text}60"></div>
            </div>
          </div>
          <span class="theme-card-badge">${ICONS.check}</span>
        </div>
        <div class="theme-card-info">
          <span class="theme-card-title">${t.name}</span>
        </div>
      </div>
    `;
  }).join('');

  els.themesGrid.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const tid = card.dataset.themeId;
      applyTheme(tid);
    });
  });
}

// ════════════════════════════════════════
//  SIDEBAR
// ════════════════════════════════════════
function setupSidebar() {
  els.menuBtn?.addEventListener('click', openSidebar);
  els.sidebarOverlay?.addEventListener('click', closeSidebar);
  els.sidebarChangeGroup?.addEventListener('click', () => { closeSidebar(); openGroupModal(); });
  els.sidebarRefresh?.addEventListener('click', async () => {
    if (els.sidebarRefresh.classList.contains('is-loading')) return;
    const svg = els.sidebarRefresh.querySelector('svg');
    if (svg) svg.classList.add('is-spinning');
    els.sidebarRefresh.classList.add('is-loading');
    closeSidebar();
    try {
      await loadSchedule(true);
    } finally {
      if (svg) svg.classList.remove('is-spinning');
      els.sidebarRefresh?.classList.remove('is-loading');
    }
  });

  const diaryBtn = document.getElementById('sidebarDiaryBtn');
  diaryBtn?.addEventListener('click', () => {
    closeSidebar();
    const diaryUrl = 'https://online-obr-college-dist-gpt-msk.1c.ru/library.html?db_name=moskva_kolledzh_telekommunikatcii_mtusi';
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(diaryUrl);
    } else {
      window.open(diaryUrl, '_blank', 'noopener,noreferrer');
    }
  });

  let startX = 0;
  els.sidebar?.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  els.sidebar?.addEventListener('touchmove', e => {
    if (e.touches[0].clientX - startX < -50) closeSidebar();
  }, { passive: true });
}

function openSidebar() {
  els.sidebar?.classList.add('open');
  els.sidebarOverlay?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  els.sidebar?.classList.remove('open');
  els.sidebarOverlay?.classList.remove('active');
  document.body.style.overflow = '';
}

function updateSidebarGroupInfo() {
  if (!S.group) return;
  if (els.sidebarGroupName) els.sidebarGroupName.textContent = S.group;
  if (els.sidebarGroupAvatar) els.sidebarGroupAvatar.textContent = S.group.slice(0, 2).toUpperCase();
  if (els.topbarGroupName) els.topbarGroupName.textContent = S.group;
}

function isTestTab(tabName) {
  if (!tabName) return false;
  return /тест|test|draft|черновик|шаблон|temp|sample|^лист\s*\d*$/i.test(String(tabName).trim());
}

// ════════════════════════════════════════
//  AUTOMATIC DATE & WEEK RESOLUTION
// ════════════════════════════════════════
function getWeekDateRange(weekOffset = 0) {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const dayFromMon = (dow === 0 ? 7 : dow) - 1; // 0 for Mon, 6 for Sun
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayFromMon + (weekOffset * 7));
  mon.setHours(0, 0, 0, 0);
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  sat.setHours(23, 59, 59, 999);
  return { mon, sat };
}

function findTabForWeek(weekOffset = 0) {
  const { mon, sat } = getWeekDateRange(weekOffset);
  const targetParity = getActiveParity(); // 'num' or 'den'
  // Фильтруем только вкладки с диапазонами дат (исключая «Основное», «Расписание 1 сентября», тестовые)
  const datedTabs = (S.tabs || []).filter(t => t.has_date_range && !isTestTab(t.name));
  const matching = [];

  for (const tab of datedTabs) {
    const startStr = tab.start_iso || tab.date_start;
    const endStr = tab.end_iso || tab.date_end;
    if (!startStr || !endStr) continue;
    const tabStart = new Date(startStr);
    const tabEnd = new Date(endStr);
    // Проверка пересечения отрезков [mon, sat] и [tabStart, tabEnd]
    if (mon <= tabEnd && sat >= tabStart) {
      matching.push(tab);
    }
  }

  if (matching.length === 0) return null;

  // 1. Точное совпадение: диапазон дат + тип недели (числитель/знаменатель)
  const parityMatch = matching.find(t => t.parity === targetParity);
  if (parityMatch) return parityMatch;

  // 2. Вкладка без указания типа недели (fallback: parity === null)
  const untypedMatch = matching.find(t => !t.parity);
  if (untypedMatch) return untypedMatch;

  // 3. Fallback: первая пересекающаяся вкладка
  return matching[0];
}

function renderScheduleNotPublished() {
  if (!els.scheduleView) return;
  const { mon, sat } = getWeekDateRange(S.weekOffset || 0);
  const mStr = `${mon.getDate()} ${MONTH_NAMES[mon.getMonth()]}`;
  const sStr = `${sat.getDate()} ${MONTH_NAMES[sat.getMonth()]}`;
  const rangeText = `${mStr} – ${sStr}`;

  els.scheduleView.innerHTML = `
    <div class="schedule-not-published-card">
      <div class="not-published-icon">${ICONS.calendar}</div>
      <div class="not-published-title">Расписание на эту неделю ещё не опубликовано</div>
      <div class="not-published-desc">Колледж ещё не выложил расписание на период <strong>${rangeText}</strong>. Обычно расписание на новую неделю публикуется в конце текущей недели.</div>
      <button class="not-published-btn" onclick="resetToCurrentWeek()">
        ${ICONS.calendar}
        <span>Вернуться к текущей неделе</span>
      </button>
    </div>
  `;
}

window.resetToCurrentWeek = function() {
  S.weekOffset = 0;
  S.selectedDay = null;
  S.manualTabMode = false;
  S.isNotPublished = false;
  S.parityOverride = null;

  const autoTab = findTabForWeek(0);
  if (autoTab) {
    S.activeGid = autoTab.gid;
  }
  buildSidebarTabs();
  buildDayStrip();
  updateTopbarParity();
  loadSchedule(false);
};

function buildSidebarTabs() {
  if (!els.sidebarTabList) return;
  els.sidebarTabList.innerHTML = '';
  const cleanTabs = (S.tabs || []).filter(tab => !isTestTab(tab.name));
  cleanTabs.forEach(tab => {
    const btn = document.createElement('button');
    const isActive = (tab.gid === S.activeGid) || (!S.activeGid && tab.is_active);
    btn.className = 'sidebar-tab-btn' + (isActive ? ' active' : '');

    let metaBadge = '';
    if (tab.start_dm && tab.end_dm) {
      metaBadge = `<span class="sidebar-tab-badge">${tab.start_dm}–${tab.end_dm}</span>`;
    } else if (tab.is_main) {
      metaBadge = `<span class="sidebar-tab-badge special">Резерв</span>`;
    }

    btn.innerHTML = `<span class="sidebar-tab-dot"></span><span class="sidebar-tab-name">${esc(tab.name)}</span>${metaBadge}`;
    btn.addEventListener('click', () => {
      S.manualTabMode = true;
      S.isNotPublished = false;
      S.parityOverride = null;
      S.activeGid = tab.gid;
      closeSidebar();
      loadSchedule(true);
      if (S.view === 'teacher') initTeachersView(true);
      if (S.view === 'classroom') initClassroomsView(true);
    });
    els.sidebarTabList.appendChild(btn);
  });
}

// ════════════════════════════════════════
//  SIDEBAR NAV
// ════════════════════════════════════════
function setupSidebarNav() {
  document.querySelectorAll('.sidebar-nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      setView(btn.dataset.view);
      closeSidebar();
    });
  });
}

function setView(view) {
  S.view = view;
  document.querySelectorAll('.sidebar-nav-item[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const isSched = (view === 'today' || view === 'week' || view === 'schedule');
  if (els.scheduleView) els.scheduleView.style.display = isSched ? 'block' : 'none';
  if (els.teacherView) els.teacherView.style.display = view === 'teacher' ? 'block' : 'none';
  if (els.classroomView) els.classroomView.style.display = view === 'classroom' ? 'block' : 'none';
  if (els.statsView) els.statsView.style.display = view === 'stats' ? 'block' : 'none';
  if (els.englishView) els.englishView.style.display = view === 'english' ? 'block' : 'none';
  
  const navWrap = document.querySelector('.week-nav-wrap');
  if (navWrap) navWrap.style.display = isSched ? 'block' : 'none';
  if (els.dayStrip?.parentElement) els.dayStrip.parentElement.style.display = isSched ? 'block' : 'none';

  if (isSched) renderSchedule();
  if (view === 'teacher') initTeachersView();
  if (view === 'classroom') initClassroomsView();
  if (view === 'stats') initStatsView();
  if (view === 'english') startEnglishCountdown();
  else stopEnglishCountdown();
}

// ════════════════════════════════════════
//  WEEK NAVIGATION & PARITY
// ════════════════════════════════════════
function getAcademicParityForDate(d) {
  const target = new Date(d);
  const m = target.getMonth(); // 0=янв, 7=авг, 8=сен
  const y = (m >= 7) ? target.getFullYear() : target.getFullYear() - 1;
  const septFirst = new Date(y, 8, 1);
  const septFirstDay = (septFirst.getDay() + 6) % 7; // 0=пн, 6=вс
  const septFirstMonday = new Date(septFirst);
  septFirstMonday.setDate(septFirst.getDate() - septFirstDay);
  septFirstMonday.setHours(0, 0, 0, 0);

  const targetDay = new Date(target);
  targetDay.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((targetDay - septFirstMonday) / (86400 * 1000));
  const weekNum = Math.max(1, Math.floor(diffDays / 7) + 1);
  return (weekNum % 2 === 1) ? 'num' : 'den';
}

function updateTopbarParity() {
  const p = getActiveParity();
  if (els.topbarParity) {
    const isOverridden = Boolean(S.parityOverride);
    els.topbarParity.textContent = (p === 'num') ? 'I Числ.' : 'II Знам.';
    els.topbarParity.classList.toggle('overridden', isOverridden);
    els.topbarParity.title = 'Нажмите, чтобы переключить (I Числ. / II Знам.)';
  }
}

function getActiveParity() {
  // 1. Ручное переключение через чип в шапке (если активировано)
  if (S.parityOverride === 'num' || S.parityOverride === 'den') {
    return S.parityOverride;
  }

  // 2. Если выбранная вкладка имеет явную чётность в названии («Числитель» / «Знаменатель»),
  // её расписание ВСЕГДА отображается строго в соответствии с типом этой вкладки!
  const currentTab = (S.tabs || []).find(t => t.gid === S.activeGid);
  const tabParity = currentTab?.parity;
  if (tabParity === 'num' || tabParity === 'den') {
    return tabParity;
  }
  if (S.data?.tab_name) {
    const tLower = S.data.tab_name.toLowerCase();
    if (tLower.includes('числитель')) return 'num';
    if (tLower.includes('знаменатель')) return 'den';
  }

  // 3. Для вкладок без явной чётности (например «Основное»):
  // Чётность рассчитывается от даты просматриваемой недели!
  const { mon } = getWeekDateRange(S.weekOffset || 0);
  return getAcademicParityForDate(mon);
}

function updateWeekNav(monday, saturday) {
  if (!els.weekNavRange || !els.weekNavBadge) return;

  const mDay = monday.getDate();
  const mMonth = monday.getMonth();
  const sDay = saturday.getDate();
  const sMonth = saturday.getMonth();

  let rangeStr = '';
  if (mMonth === sMonth) {
    rangeStr = `${mDay} – ${sDay} ${MONTH_NAMES[mMonth]}`;
  } else {
    rangeStr = `${mDay} ${MONTH_NAMES[mMonth]} – ${sDay} ${MONTH_NAMES[sMonth]}`;
  }
  els.weekNavRange.textContent = rangeStr;

  els.weekNavBadge.className = 'week-nav-badge';
  if (S.weekOffset === 0) {
    els.weekNavBadge.textContent = 'Эта неделя';
  } else if (S.weekOffset === 1) {
    els.weekNavBadge.textContent = 'След. неделя';
    els.weekNavBadge.classList.add('next-week');
  } else if (S.weekOffset === -1) {
    els.weekNavBadge.textContent = 'Прошлая нед.';
    els.weekNavBadge.classList.add('prev-week');
  } else if (S.weekOffset > 1) {
    els.weekNavBadge.textContent = `Через ${S.weekOffset} нед.`;
    els.weekNavBadge.classList.add('next-week');
  } else {
    els.weekNavBadge.textContent = `${Math.abs(S.weekOffset)} нед. назад`;
    els.weekNavBadge.classList.add('prev-week');
  }
}

async function changeWeek(delta) {
  if (S.isNavigatingWeek) return;
  S.isNavigatingWeek = true;

  if (els.prevWeekBtn) {
    els.prevWeekBtn.disabled = true;
    els.prevWeekBtn.classList.add('is-loading');
  }
  if (els.nextWeekBtn) {
    els.nextWeekBtn.disabled = true;
    els.nextWeekBtn.classList.add('is-loading');
  }

  try {
    S.weekOffset += delta;
    S.manualTabMode = false;
    S.parityOverride = null;

    const targetTab = findTabForWeek(S.weekOffset);
    if (targetTab) {
      S.isNotPublished = false;
      const needFetch = (!S.data || S.data.gid !== targetTab.gid);
      S.activeGid = targetTab.gid;
      buildSidebarTabs();
      buildDayStrip();
      updateTopbarParity();
      if (needFetch) {
        renderSkeleton();
        await loadSchedule(false);
      } else {
        renderSchedule();
        updateLiveCard();
      }
    } else {
      S.isNotPublished = true;
      buildSidebarTabs();
      buildDayStrip();
      updateTopbarParity();
      renderScheduleNotPublished();
      updateLiveCard();
    }
  } catch (err) {
    logApp('error', 'Ошибка при смене недели:', err);
  } finally {
    S.isNavigatingWeek = false;
    if (els.prevWeekBtn) {
      els.prevWeekBtn.disabled = false;
      els.prevWeekBtn.classList.remove('is-loading');
    }
    if (els.nextWeekBtn) {
      els.nextWeekBtn.disabled = false;
      els.nextWeekBtn.classList.remove('is-loading');
    }
  }
}

function setupWeekNav() {
  els.prevWeekBtn?.addEventListener('click', () => changeWeek(-1));
  els.nextWeekBtn?.addEventListener('click', () => changeWeek(1));
  els.topbarParity?.addEventListener('click', () => {
    const current = getActiveParity();
    S.parityOverride = (current === 'num') ? 'den' : 'num';
    updateTopbarParity();
    renderSchedule();
    updateLiveCard();
  });
  setupSwipeGestures();
}

function setupSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;

  const target = document.body;
  target.addEventListener('touchstart', (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  target.addEventListener('touchend', (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (document.querySelector('.modal-backdrop.open') || document.querySelector('.sidebar.open')) {
        return;
      }
      if (dx < 0) {
        changeWeek(1); // свайп влево -> следующая неделя
      } else {
        changeWeek(-1); // свайп вправо -> предыдущая неделя
      }
    }
  }
}

// ════════════════════════════════════════
//  DAY STRIP
// ════════════════════════════════════════
function buildDayStrip() {
  if (!els.dayStrip) return;
  const today = new Date();
  const todayDow = today.getDay(); // 0=вс

  els.dayStrip.innerHTML = '';

  const { mon: monday, sat: saturday } = getWeekDateRange(S.weekOffset || 0);
  updateWeekNav(monday, saturday);

  if (S.selectedDay === null) {
    if (S.weekOffset === 0 && todayDow >= 1 && todayDow <= 6) {
      S.selectedDay = todayDow;
    } else {
      S.selectedDay = 1; // понедельник
    }
  }

  DAYS_EN_ORDER.forEach(dow => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + (dow - 1));
    const isToday = (S.weekOffset === 0) && (d.toDateString() === today.toDateString());
    const isActive = (S.selectedDay === dow);

    const dayNum = String(d.getDate()).padStart(2, '0');

    const chip = document.createElement('div');
    chip.className = 'day-chip' + (isActive ? ' active' : '') + (isToday ? ' today-chip' : '');
    chip.dataset.dow = dow;
    chip.innerHTML = `<span class="day-chip-name">${DAYS_SHORT[dow]}</span><span class="day-chip-num">${dayNum}</span>`;
    chip.addEventListener('click', () => selectDay(dow));
    els.dayStrip.appendChild(chip);
  });

  const activeChip = els.dayStrip.querySelector('.day-chip.active');
  if (activeChip) activeChip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function selectDay(dow) {
  if (S.selectedDay === dow) return;
  S.selectedDay = dow;
  buildDayStrip();
  renderSchedule();
  updateLiveCard();
}

// ════════════════════════════════════════
//  LIVE STATUS CARD
// ════════════════════════════════════════
const STORAGE_LIVE_HIDDEN = 'college_schedule_live_hidden';

const BELL = [
  null,
  { s: 8 * 60,      e: 9 * 60 + 35  },  // 08:00 - 09:35 (95 мин)
  { s: 9 * 60 + 45, e: 11 * 60 + 20 }, // 09:45 - 11:20 (95 мин)
  { s: 11 * 60 + 50,e: 13 * 60 + 25 }, // 11:50 - 13:25 (95 мин)
  { s: 13 * 60 + 55,e: 15 * 60 + 30 }, // 13:55 - 15:30 (95 мин)
  { s: 15 * 60 + 40,e: 17 * 60 + 15 }, // 15:40 - 17:15 (95 мин)
  { s: 17 * 60 + 25,e: 19 * 60 + 0  },  // 17:25 - 19:00 (95 мин)
];

const BREAKS = [
  null,
  { s: 9 * 60 + 35,  e: 9 * 60 + 45,  dur: 10, name: 'Маленькая перемена (10 мин)', time: '09:35 – 09:45' },
  { s: 11 * 60 + 20, e: 11 * 60 + 50, dur: 30, name: 'Большая перемена (30 мин)',    time: '11:20 – 11:50' },
  { s: 13 * 60 + 25, e: 13 * 60 + 55, dur: 30, name: 'Большая перемена (30 мин)',    time: '13:25 – 13:55' },
  { s: 15 * 60 + 30, e: 15 * 60 + 40, dur: 10, name: 'Маленькая перемена (10 мин)', time: '15:30 – 15:40' },
  { s: 17 * 60 + 15, e: 17 * 60 + 25, dur: 10, name: 'Маленькая перемена (10 мин)', time: '17:15 – 17:25' },
];

function fmtSec(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  if (m > 0) {
    return `${m} мин ${String(s).padStart(2, '0')} сек`;
  }
  return `${s} сек`;
}

function fmtHoursSec(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) {
    return `${h} ч ${m} мин ${String(s).padStart(2, '0')} сек`;
  }
  if (m > 0) {
    return `${m} мин ${String(s).padStart(2, '0')} сек`;
  }
  return `${s} сек`;
}

function setupLiveCardToggle() {
  const isHidden = localStorage.getItem(STORAGE_LIVE_HIDDEN) === '1';
  if (isHidden) {
    if (els.liveCard) els.liveCard.style.display = 'none';
    if (els.liveCardRestoreBtn) els.liveCardRestoreBtn.style.display = 'flex';
  } else {
    if (els.liveCard) els.liveCard.style.display = 'flex';
    if (els.liveCardRestoreBtn) els.liveCardRestoreBtn.style.display = 'none';
  }

  els.liveCardCloseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (els.liveCard) els.liveCard.style.display = 'none';
    if (els.liveCardRestoreBtn) els.liveCardRestoreBtn.style.display = 'flex';
    localStorage.setItem(STORAGE_LIVE_HIDDEN, '1');
  });

  els.liveCardRestoreBtn?.addEventListener('click', () => {
    if (els.liveCard) els.liveCard.style.display = 'flex';
    if (els.liveCardRestoreBtn) els.liveCardRestoreBtn.style.display = 'none';
    localStorage.setItem(STORAGE_LIVE_HIDDEN, '0');
  });
}

function updateActiveBreakDividers() {
  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  document.querySelectorAll('.schedule-break-divider').forEach(div => {
    const sMin = parseInt(div.dataset.sMin, 10);
    const eMin = parseInt(div.dataset.eMin, 10);
    if (!isNaN(sMin) && !isNaN(eMin)) {
      const sSec = sMin * 60;
      const eSec = eMin * 60;
      const isActive = (nowSec >= sSec && nowSec < eSec);
      div.classList.toggle('break-active-glow', isActive);
      let badge = div.querySelector('.break-active-badge');
      if (isActive) {
        const leftSec = eSec - nowSec;
        if (badge) {
          badge.innerHTML = `${ICONS.play} Идёт сейчас (${fmtSec(leftSec)})`;
        } else {
          const right = div.querySelector('.break-info-right');
          if (right) {
            badge = document.createElement('span');
            badge.className = 'break-active-badge';
            badge.innerHTML = `${ICONS.play} Идёт сейчас (${fmtSec(leftSec)})`;
            right.prepend(badge);
          }
        }
      } else if (badge) {
        badge.remove();
      }
    }
  });
}

let _lastCalendarDate = new Date().toDateString();

function checkMidnightRollover() {
  const now = new Date();
  const currentDateStr = now.toDateString();
  if (_lastCalendarDate && currentDateStr !== _lastCalendarDate) {
    console.log('🌙 Смена календарных суток (Midnight Rollover):', _lastCalendarDate, '->', currentDateStr);
    _lastCalendarDate = currentDateStr;

    // Автоматически переключаем и обновляем расписание на новый день
    buildDayStrip();
    if (S.selectedDay === null) {
      if (S.view === 'today' || S.view === 'week') {
        renderSchedule();
      }
    }
    updateLiveCard();
  }
}

let _liveCardInterval = null;

function startLiveCardClock() {
  setupLiveCardToggle();
  updateLiveCard();
  if (_liveCardInterval) clearInterval(_liveCardInterval);
  _liveCardInterval = setInterval(() => {
    checkMidnightRollover();
    updateLiveCard();
    if (S.view === 'today') {
      updateActiveBreakDividers();
    }
  }, 1000);

  // Когда пользователь разблокирует экран утром / возвращается на вкладку
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkMidnightRollover();
      updateLiveCard();
      if (S.group) {
        loadSchedule(false);
      }
    }
  });
}

function getGroupDayPairs(dayName) {
  if (!S.data || !S.data.days) return [];
  const raw = S.data.days[dayName] || [];
  const activeParity = getActiveParity();
  const pairs = [];

  raw.forEach(slot => {
    if (slot.is_empty) return;
    const pn = slot.pair_num;
    let lesson = null;

    if (slot.is_split) {
      if (activeParity === 'num' && slot.numerator) {
        lesson = slot.numerator;
      } else if (activeParity === 'den' && slot.denominator) {
        lesson = slot.denominator;
      } else {
        lesson = slot.numerator || slot.denominator;
      }
    } else {
      lesson = slot.both || slot.numerator || slot.denominator;
    }

    if (lesson && lesson.subject) {
      pairs.push({
        ...lesson,
        pair_num: pn,
        pair_number: pn,
        start: slot.start,
        end: slot.end,
        time: slot.time
      });
    }
  });

  return pairs;
}

function updateLiveCard() {
  if (!els.liveCard) return;
  if (!S.group) {
    setLiveCard('free', ICONS.coffee, 'Выберите группу', 'Нажмите "Сменить группу"', 'Выберите группу');
    return;
  }
  if (!S.data) {
    setLiveCard('free', ICONS.clock, S.group, 'Загрузка расписания...', S.group);
    return;
  }

  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const todayDow = now.getDay();

  const dayName = DAYS[todayDow];
  const pairs = getGroupDayPairs(dayName);

  // 1. Проверяем текущие пары сегодня
  if (pairs && pairs.length > 0) {
    for (const p of pairs) {
      const pn = p.pair_num;
      if (!pn || pn < 1 || pn > 6) continue;
      const bell = BELL[pn];
      const bellStartSec = bell.s * 60;
      const bellEndSec = bell.e * 60;

      if (nowSec >= bellStartSec && nowSec < bellEndSec) {
        const elapsedSec = nowSec - bellStartSec;
        const totalLeftSec = bellEndSec - nowSec;
        const totalPct = Math.min(100, Math.max(0, (elapsedSec / (bellEndSec - bellStartSec)) * 100));
        const subj = p.subject ? esc(p.subject.slice(0, 45)) : '';

        if (elapsedSec < 45 * 60) {
          // Первые 45 минут: два времени (до 5-минутки и до конца всей пары)
          const to5minSec = (45 * 60) - elapsedSec;
          setLiveCard('going', ICONS.book,
            `Идёт ${pn} пара: ${subj}`,
            `До 5-минутки: <b>${fmtSec(to5minSec)}</b> • До конца пары: <b>${fmtSec(totalLeftSec)}</b>`,
            `<b>${pn} пара</b> • До 5-мин: <b>${fmtSec(to5minSec)}</b> • До конца: <b>${fmtSec(totalLeftSec)}</b>`
          );
        } else if (elapsedSec < 50 * 60) {
          // Пятиминутка внутри пары (45-50 мин)
          const fiveLeftSec = (50 * 60) - elapsedSec;
          setLiveCard('break', ICONS.coffee,
            `Пятиминутка (${pn} пара): ${subj}`,
            `Пятиминутный перерыв: <b>осталось ${fmtSec(fiveLeftSec)}</b> • До конца пары: <b>${fmtSec(totalLeftSec)}</b>`,
            `<b>5-минутка (${pn} пара)</b>: осталось <b>${fmtSec(fiveLeftSec)}</b> • Конец: <b>${fmtSec(totalLeftSec)}</b>`
          );
        } else {
          // Вторая половина пары (после 5-минутки)
          setLiveCard('going', ICONS.book,
            `Идёт ${pn} пара (2-я часть): ${subj}`,
            `До конца пары: <b>${fmtSec(totalLeftSec)}</b> (до ${fmtTime(bell.e)})`,
            `<b>${pn} пара (2-я часть)</b> • До конца: <b>${fmtSec(totalLeftSec)}</b>`
          );
        }

        if (els.liveCardProgress) els.liveCardProgress.style.width = totalPct.toFixed(1) + '%';
        return;
      }

      // Перемена между парами сегодня
      if (pn < 6) {
        const brk = BREAKS[pn];
        if (brk) {
          const brkStartSec = brk.s * 60;
          const brkEndSec = brk.e * 60;
          if (nowSec >= brkStartSec && nowSec < brkEndSec) {
            const leftSec = brkEndSec - nowSec;
            const pct = Math.min(100, Math.max(0, ((nowSec - brkStartSec) / (brk.dur * 60)) * 100));
            setLiveCard('break', brk.dur >= 20 ? ICONS.utensils : ICONS.coffee,
              `${brk.name} • до ${fmtTime(brk.e)}`,
              `До начала ${pn + 1} пары осталось <b>${fmtSec(leftSec)}</b>`,
              `<b>${brk.name}</b>: осталось <b>${fmtSec(leftSec)}</b>`
            );
            if (els.liveCardProgress) els.liveCardProgress.style.width = pct.toFixed(1) + '%';
            return;
          }
        }
      }
    }

    // 2. До начала первой пары сегодня (утром)
    for (const p of pairs) {
      const pn = p.pair_num;
      if (!pn || pn < 1 || pn > 6) continue;
      const bell = BELL[pn];
      const bellStartSec = bell.s * 60;
      if (nowSec < bellStartSec) {
        const leftSec = bellStartSec - nowSec;
        const subj = p.subject ? esc(p.subject.slice(0, 45)) : '';
        setLiveCard('soon', ICONS.clock,
          `Скоро начало занятий • ${pn} пара в ${fmtTime(bell.s)}`,
          `До ${pn} пары осталось <b>${fmtHoursSec(leftSec)}</b> • ${subj}`,
          `До ${pn} пары: <b>${fmtHoursSec(leftSec)}</b>`
        );
        if (els.liveCardProgress) els.liveCardProgress.style.width = Math.max(0, 100 - (leftSec / 3600) * 100).toFixed(1) + '%';
        return;
      }
    }
  }

  // 3. Пары на сегодня окончены (или сегодня выходной) -> Ищем следующий учебный день и считаем время!
  for (let offset = 1; offset <= 7; offset++) {
    const nextDow = (todayDow + offset) % 7;
    const nextDayName = DAYS[nextDow];
    const nextPairs = getGroupDayPairs(nextDayName);
    if (nextPairs && nextPairs.length > 0) {
      const firstPair = nextPairs[0];
      const pn = firstPair.pair_num;
      const bell = pn >= 1 && pn <= 6 ? BELL[pn] : null;
      if (bell) {
        const targetDate = new Date(now);
        targetDate.setDate(now.getDate() + offset);
        targetDate.setHours(Math.floor(bell.s / 60), bell.s % 60, 0, 0);

        const diffSec = Math.floor((targetDate.getTime() - now.getTime()) / 1000);
        if (diffSec > 0) {
          let dayLabel = `завтра (${nextDayName})`;
          if (offset === 2) dayLabel = `послезавтра (${nextDayName})`;
          else if (offset > 2) dayLabel = `в ${nextDayName}`;

          const subj = firstPair.subject ? esc(firstPair.subject.slice(0, 45)) : '';
          const timeStr = fmtHoursSec(diffSec);

          setLiveCard('soon', ICONS.clock,
            `Следующие пары — ${dayLabel}`,
            `До ${pn} пары (${fmtTime(bell.s)}) осталось <b>${timeStr}</b> • ${subj}`,
            `${pn} пара ${dayLabel}: <b>${timeStr}</b>`
          );
          if (els.liveCardProgress) els.liveCardProgress.style.width = '0%';
          return;
        }
      }
    }
  }

  // 4. Если на неделю вперёд пар нет
  setLiveCard('free', ICONS.moon, 'Пары на сегодня окончены', 'Хорошего отдыха!', 'Пары окончены');
}

function setLiveCard(type, icon, title, sub, restoreText = '') {
  if (!els.liveCard) return;
  els.liveCard.className = 'live-card ' + type;
  if (els.liveCardIcon) els.liveCardIcon.innerHTML = icon;
  if (els.liveCardTitle) els.liveCardTitle.innerHTML = title;
  if (els.liveCardSub) els.liveCardSub.innerHTML = sub;
  if (type === 'free' && els.liveCardProgress) els.liveCardProgress.style.width = '0';
  if (els.liveRestoreIcon) els.liveRestoreIcon.innerHTML = icon;
  if (els.liveRestoreText) els.liveRestoreText.innerHTML = restoreText || title;
}

function fmtTime(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// ════════════════════════════════════════
//  LOAD DATA (FAULT TOLERANT & CACHED)
// ════════════════════════════════════════
async function loadSchedule(force = false) {
  if (S.isLoading && !force) {
    logApp('info', 'loadSchedule пропущен: предыдущий запрос ещё выполняется');
    return;
  }
  S.isLoading = true;

  if (!S.group) S.group = DEFAULT_GROUP;
  updateSidebarGroupInfo();

  const cacheKey = STORAGE_CACHE_PREFIX + S.group + '_' + (S.activeGid || 'active');

  // 1. ОФФЛАЙН-КЭШ: Мгновенно отображаем последнее сохранённое расписание (0 мс)
  if (!S.data) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        S.data = JSON.parse(cached);
        updateSidebarGroupInfo();
        buildDayStrip();
        updateTopbarParity();
        renderSchedule();
        updateLiveCard();
        updateSyncStatus(true, true);
        logApp('info', `Расписание мгновенно загружено из оффлайн-кэша для ${S.group}`);
      }
    } catch (err) {
      logApp('warn', 'Ошибка чтения оффлайн-кэша:', err);
    }
  }

  // Если данных в памяти нет — показываем элегантные skeleton-карточки
  if (!S.data && (S.view === 'today' || S.view === 'week' || S.view === 'schedule')) {
    renderSkeleton();
  }

  // 2. ИНДИКАТОР ПРОБУЖДЕНИЯ СЕРВЕРА RENDER (если ответ длится > 2.5с)
  const wakeupTimer = setTimeout(() => {
    showOfflineBanner('⏳ Сервер просыпается, подгружаем свежее расписание...', true);
  }, 2500);

  // 3. СЕТЕВОЙ ЗАПРОС С ТАЙМАУТОМ (8.5 сек)
  try {
    // Вкладки загружаем только если они ещё не загружены или принудительно (экономия 1-3с на Render)
    if (!S.tabs || S.tabs.length === 0 || force) {
      try {
        const tabsRes = await fetchWithTimeout(`${API}/tabs`, {}, 8500);
        if (tabsRes.ok) {
          const tabsData = await tabsRes.json();
          S.tabs = (tabsData.tabs || []).filter(tab => !isTestTab(tab.name));
        }
      } catch (tabsErr) {
        logApp('warn', 'Не удалось обновить список вкладок:', tabsErr);
      }
    }

    // Автоматическое определение вкладки по датам недели, если не включен ручной выбор
    if (!S.manualTabMode && S.tabs && S.tabs.length > 0) {
      const targetTab = findTabForWeek(S.weekOffset || 0);
      if (targetTab) {
        S.activeGid = targetTab.gid;
      } else if (S.weekOffset !== 0) {
        // Целевая неделя ещё не опубликована
        clearTimeout(wakeupTimer);
        hideOfflineBanner();
        S.isNotPublished = true;
        buildSidebarTabs();
        buildDayStrip();
        renderScheduleNotPublished();
        return;
      } else if (!S.activeGid || S.activeGid === 'active') {
        const foundActive = S.tabs.find(t => t.is_active);
        S.activeGid = foundActive ? foundActive.gid : (S.tabs[0]?.gid || '');
      }
    }

    const tabParam = S.activeGid ? `&tab=${encodeURIComponent(S.activeGid)}` : '';
    const forceParam = force ? '&force=true' : '';
    const url = `${API}/schedule?group=${encodeURIComponent(S.group)}${tabParam}${forceParam}`;
    const res = await fetchWithTimeout(url, {}, 8500);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const freshData = await res.json();

    if (freshData && freshData.published === false) {
      clearTimeout(wakeupTimer);
      hideOfflineBanner();
      S.isNotPublished = true;
      buildSidebarTabs();
      buildDayStrip();
      renderScheduleNotPublished();
      return;
    }

    if (!freshData || (!freshData.days && !freshData.schedules)) {
      throw new Error('Некорректный формат расписания от сервера');
    }

    clearTimeout(wakeupTimer);
    hideOfflineBanner();

    S.isNotPublished = false;
    S.data = freshData;

    // Если список вкладок ещё не был заполнен — обновляем из ответа расписания
    if ((!S.tabs || S.tabs.length === 0) && freshData.available_tabs) {
      S.tabs = freshData.available_tabs.filter(tab => !isTestTab(tab.name));
    }

    try {
      localStorage.setItem(cacheKey, JSON.stringify(freshData));
      localStorage.setItem('schedule_last_sync_time', freshData.last_updated || new Date().toLocaleString('ru-RU'));
    } catch (err) {
      logApp('warn', 'Ошибка записи в кэш:', err);
    }

    updateSidebarGroupInfo();
    buildSidebarTabs();
    buildDayStrip();
    updateTopbarParity();
    renderSchedule();
    updateLiveCard();
    updateSyncStatus(true, false);
    if (S.view === 'stats') renderStatsView(currentStatsScope);
    if (S.view === 'english') startEnglishCountdown();
    logApp('info', `Расписание успешно синхронизировано для ${S.group}`);
  } catch (e) {
    clearTimeout(wakeupTimer);
    logApp('error', `Сбой синхронизации расписания (${e.message}):`, e);

    // Проверяем наличие кэша
    let hasCachedData = Boolean(S.data);
    if (!hasCachedData) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          S.data = JSON.parse(cached);
          hasCachedData = true;
          updateSidebarGroupInfo();
          buildDayStrip();
          updateTopbarParity();
          renderSchedule();
          updateLiveCard();
        }
      } catch (err) {
        logApp('warn', 'Не удалось восстановить кэш:', err);
      }
    }

    updateSyncStatus(false, hasCachedData);

    if (hasCachedData) {
      const updTime = S.data?.last_updated || localStorage.getItem('schedule_last_sync_time') || 'ранее';
      showOfflineBanner(`Показано сохранённое расписание, обновлено ${updTime}`);
    } else if (els.scheduleView) {
      hideOfflineBanner();
      els.scheduleView.removeAttribute('aria-busy');
      els.scheduleView.innerHTML = `
        <div class="schedule-error-card">
          <div class="schedule-error-icon">${ICONS.alert}</div>
          <div class="schedule-error-title">Не удалось загрузить расписание</div>
          <div class="schedule-error-desc">Сервер временно недоступен или отсутствует подключение к интернету.</div>
          <button class="retry-btn" onclick="loadSchedule(true)">
            ${ICONS.refresh}
            <span>Попробовать снова</span>
          </button>
        </div>
      `;
    }
  } finally {
    clearTimeout(wakeupTimer);
    S.isLoading = false;
    if (els.scheduleView && S.data) els.scheduleView.removeAttribute('aria-busy');
  }
}

function updateSyncStatus(ok, isCached = false) {
  if (!els.sidebarSyncStatus) return;
  if (!ok) {
    els.sidebarSyncStatus.textContent = isCached ? '● Офлайн-копия (нет связи)' : '● Нет связи';
    els.sidebarSyncStatus.style.color = isCached ? 'var(--yellow)' : 'var(--red)';
  } else if (isCached) {
    els.sidebarSyncStatus.textContent = '● Загружено из памяти';
    els.sidebarSyncStatus.style.color = 'var(--accent)';
  } else {
    els.sidebarSyncStatus.textContent = '● Синхронизировано';
    els.sidebarSyncStatus.style.color = 'var(--green)';
  }
  if (S.data?.last_updated && els.sidebarUpdated) {
    els.sidebarUpdated.textContent = 'Обновлено: ' + S.data.last_updated;
  }
}

function startAutoRefresh() {
  clearInterval(S.refreshTimer);
  S.refreshTimer = setInterval(() => loadSchedule(), AUTO_REFRESH_MS);
}

// ════════════════════════════════════════
//  RENDER SKELETON (INSTANT GHOST CARDS)
// ════════════════════════════════════════
function renderSkeleton() {
  if (!els.scheduleView) return;
  els.scheduleView.setAttribute('aria-busy', 'true');
  els.scheduleView.innerHTML = `
    <div class="skeleton-schedule" id="skeletonLoader">
      <div class="skeleton-card">
        <div class="skeleton-col-num">
          <div class="skeleton-bar skeleton-num"></div>
          <div class="skeleton-bar skeleton-time"></div>
        </div>
        <div class="skeleton-col-body">
          <div class="skeleton-bar skeleton-title"></div>
          <div class="skeleton-bar skeleton-title-sub"></div>
          <div class="skeleton-meta-row">
            <div class="skeleton-bar skeleton-pill"></div>
            <div class="skeleton-bar skeleton-pill small"></div>
          </div>
        </div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton-col-num">
          <div class="skeleton-bar skeleton-num"></div>
          <div class="skeleton-bar skeleton-time"></div>
        </div>
        <div class="skeleton-col-body">
          <div class="skeleton-bar skeleton-title" style="width:65%"></div>
          <div class="skeleton-bar skeleton-title-sub" style="width:40%"></div>
          <div class="skeleton-meta-row">
            <div class="skeleton-bar skeleton-pill" style="width:110px"></div>
            <div class="skeleton-bar skeleton-pill small"></div>
          </div>
        </div>
      </div>
      <div class="skeleton-card">
        <div class="skeleton-col-num">
          <div class="skeleton-bar skeleton-num"></div>
          <div class="skeleton-bar skeleton-time"></div>
        </div>
        <div class="skeleton-col-body">
          <div class="skeleton-bar skeleton-title" style="width:82%"></div>
          <div class="skeleton-bar skeleton-title-sub" style="width:52%"></div>
          <div class="skeleton-meta-row">
            <div class="skeleton-bar skeleton-pill"></div>
            <div class="skeleton-bar skeleton-pill small"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════
//  RENDER SCHEDULE
// ════════════════════════════════════════
function renderSchedule() {
  if (!els.scheduleView) return;
  els.scheduleView.removeAttribute('aria-busy');
  if (S.isNotPublished) {
    renderScheduleNotPublished();
    return;
  }
  if (!S.data || !S.group) {
    els.scheduleView.innerHTML = `<div class="empty-pairs-hint">Группа не выбрана</div>`;
    return;
  }

  if (S.view === 'week') {
    renderWeek();
  } else {
    renderDay();
  }
}

function getActiveDow() {
  if (S.selectedDay !== null) return S.selectedDay;
  const dow = new Date().getDay();
  return dow === 0 ? 1 : dow;
}

function renderDay() {
  const dow = getActiveDow();
  const dayName = DAYS[dow];
  const html = renderDayPairs(dayName);
  els.scheduleView.innerHTML = html || `<div class="empty-pairs-hint">На ${dayName.toLowerCase()} пар нет</div>`;
}

function renderWeek() {
  let html = '';
  DAYS_EN_ORDER.forEach(dow => {
    const dayName = DAYS[dow];
    const today = new Date().getDay();
    const isToday = dow === today;
    const d = getDayDate(dow);
    let dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (S.data?.day_dates && S.data.day_dates[dayName]) {
      dateStr = S.data.day_dates[dayName];
    }
    html += `<div class="week-day-header">
      <span class="week-day-name">${dayName}</span>
      <span class="week-day-date">${dateStr}</span>
      ${isToday ? '<span class="week-day-today-tag">Сегодня</span>' : ''}
    </div>`;
    const dayHtml = renderDayPairs(dayName);
    html += dayHtml || `<div class="empty-pairs-hint" style="padding:12px 0">Пар нет</div>`;
  });
  els.scheduleView.innerHTML = html;
}

function getDayDate(dow) {
  const today = new Date();
  const todayDow = today.getDay() || 7;
  const diff = dow - todayDow + (S.weekOffset * 7);
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d;
}

function renderDayPairs(dayName) {
  if (!S.data || !S.data.days) return '';
  const slots = S.data.days[dayName] || [];

  const now = new Date();
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const nowMin = Math.floor(nowSec / 60);
  const isToday = (S.weekOffset === 0) && (DAYS[now.getDay()] === dayName);

  const activeParity = getActiveParity();
  let html = '';

  const validSlots = [];
  slots.forEach(slot => {
    if (slot.is_empty) return;
    if (slot.is_split) {
      const hasNum = slot.numerator && slot.numerator.subject;
      const hasDen = slot.denominator && slot.denominator.subject;
      if (activeParity === 'num') {
        if (hasNum) validSlots.push(slot);
      } else if (activeParity === 'den') {
        if (hasDen) validSlots.push(slot);
      } else {
        if (hasNum || hasDen) validSlots.push(slot);
      }
    } else {
      const p = slot.both || slot.numerator || slot.denominator;
      if (p && p.subject) {
        validSlots.push(slot);
      }
    }
  });

  validSlots.forEach((slot, idx) => {
    const pn = slot.pair_num;
    const bell = pn >= 1 && pn <= 6 ? BELL[pn] : null;
    const bellStartSec = bell ? bell.s * 60 : 0;
    const bellEndSec = bell ? bell.e * 60 : 0;
    const isGoing = bell && isToday && nowSec >= bellStartSec && nowSec < bellEndSec;

    // Разделитель перемены между парами
    if (idx > 0) {
      const prevPn = validSlots[idx - 1].pair_num;
      if (prevPn >= 1 && prevPn < pn && prevPn < 6) {
        const brk = BREAKS[prevPn];
        if (brk) {
          const brkStartSec = brk.s * 60;
          const brkEndSec = brk.e * 60;
          const isBreakActive = isToday && nowSec >= brkStartSec && nowSec < brkEndSec;
          const leftSec = isBreakActive ? (brkEndSec - nowSec) : 0;
          const glowClass = isBreakActive ? ' break-active-glow' : '';
          const activeBadge = isBreakActive ? `<span class="break-active-badge">${ICONS.play} Идёт сейчас (${fmtSec(leftSec)})</span>` : '';
          const breakIconSvg = brk.dur >= 20 ? ICONS.utensils : ICONS.coffee;

          html += `<div class="schedule-break-divider${glowClass}" data-s-min="${brk.s}" data-e-min="${brk.e}">
            <div class="break-info-left">
              <span class="break-icon">${breakIconSvg}</span>
              <span class="break-name">${brk.name}</span>
            </div>
            <div class="break-info-right">
              ${activeBadge}
              <span class="break-time">${brk.time}</span>
            </div>
          </div>`;
        }
      }
    }

    if (slot.is_split) {
      const num = slot.numerator;
      const den = slot.denominator;
      if (activeParity === 'all') {
        html += renderSplitCard(num, den, pn, bell, isGoing, idx);
      } else if (activeParity === 'num' && num && num.subject) {
        html += renderSingleCard(num, pn, bell, isGoing, 'I Числ.', idx);
      } else if (activeParity === 'den' && den && den.subject) {
        html += renderSingleCard(den, pn, bell, isGoing, 'II Знам.', idx);
      } else if (num && num.subject) {
        html += renderSingleCard(num, pn, bell, isGoing, 'I Числ.', idx);
      } else if (den && den.subject) {
        html += renderSingleCard(den, pn, bell, isGoing, 'II Знам.', idx);
      } else {
        html += renderSplitCard(num, den, pn, bell, isGoing, idx);
      }
      return;
    }

    const p = slot.both || slot.numerator || slot.denominator;
    if (!p || !p.subject) return;

    html += renderSingleCard(p, pn, bell, isGoing, '', idx);
  });

  return html;
}

function renderSingleCard(p, pn, bell, isGoing, parityBadge = '', cardIndex = 0) {
  const cancelled = p.is_cancelled || (p.subject && /отмена/i.test(p.subject));
  const replacement = p.is_replacement || (p.subject && /замена/i.test(p.subject));
  const classroom = p.classroom || p.room || '';
  const distant = p.is_distant || /дист/i.test(classroom);

  const timeStr = bell ? `${fmtTime(bell.s)}–${fmtTime(bell.e)}` : (p.time || '');
  const cardClass = ['pair-card',
    isGoing ? 'going' : '',
    cancelled ? 'cancelled' : '',
    replacement ? 'replacement' : '',
  ].filter(Boolean).join(' ');

  const badges = [
    isGoing     ? `<span class="pair-badge badge-going">${ICONS.play} Идёт</span>` : '',
    parityBadge ? `<span class="pair-badge badge-parity-tag">${esc(parityBadge)}</span>` : '',
    cancelled   ? `<span class="pair-badge badge-cancelled">${ICONS.ban} Отмена</span>` : '',
    replacement ? `<span class="pair-badge badge-replacement">${ICONS.swap} Замена</span>` : '',
    distant     ? `<span class="pair-badge badge-distant">${ICONS.extLink} Дистант</span>` : '',
  ].filter(Boolean).join('');

  const teacher = p.teacher || '';
  const teacherHtml = teacher
    ? `<button class="pair-teacher-btn" data-teacher="${esc(teacher)}" onclick="openTeacher(this.dataset.teacher)">${ICONS.user} <span>${esc(teacher)}</span></button>`
    : '';
  const roomHtml = classroom
    ? `<button class="pair-room-btn" data-room="${esc(classroom)}" onclick="openRoom(this.dataset.room)">${ICONS.mapPin} <span>${esc(classroom)}</span></button>`
    : '';

  return `<div class="${cardClass}" style="--card-index:${cardIndex}">
    <div class="pair-num-col">
      ${pn ? `<div class="pair-num">${pn}</div>` : ''}
      <div class="pair-time-small">${timeStr ? timeStr.split('–')[0] : ''}</div>
    </div>
    <div class="pair-body">
      <div class="pair-subject${cancelled ? ' cancelled-text' : ''}">${esc(p.subject || '')}</div>
      <div class="pair-meta">
        ${teacherHtml}${roomHtml}${badges}
      </div>
    </div>
    <div class="pair-time-right">
      <div class="pair-time-display">${timeStr.includes('–') ? (timeStr.split('–')[1] || '') : (timeStr.split('-')[1] || '')}</div>
    </div>
  </div>`;
}

function renderSplitCard(num, den, pn, bell, isGoing, cardIndex = 0) {
  const timeStr = bell ? `${fmtTime(bell.s)}–${fmtTime(bell.e)}` : '';

  const mkRow = (p, type, label) => {
    if (!p || !p.subject) return '';
    const teacher = p.teacher || '';
    const room = p.classroom || p.room || '';
    const teacherHtml = teacher
      ? `<button class="pair-teacher-btn" data-teacher="${esc(teacher)}" onclick="openTeacher(this.dataset.teacher)">${ICONS.user} <span>${esc(teacher)}</span></button>`
      : '';
    const roomHtml = room
      ? `<button class="pair-room-btn" data-room="${esc(room)}" onclick="openRoom(this.dataset.room)">${ICONS.mapPin} <span>${esc(room)}</span></button>`
      : '';
    return `<div class="split-row ${type}-row">
      <div class="pair-num-col">
        ${pn ? `<div class="pair-num">${pn}</div>` : ''}
      </div>
      <div class="pair-body">
        <div class="split-label">${label}</div>
        <div class="pair-subject">${esc(p.subject)}</div>
        <div class="pair-meta">${teacherHtml}${roomHtml}</div>
      </div>
      <div class="pair-time-right"><div class="pair-time-display">${timeStr.split('–')[1] || ''}</div></div>
    </div>`;
  };

  const numRow = mkRow(num, 'num', 'I Числ.');
  const denRow = mkRow(den, 'den', 'II Знам.');

  if (!numRow && !denRow) return '';
  return `<div class="split-pair-wrap${isGoing ? ' going' : ''}" style="--card-index:${cardIndex}">${numRow}${denRow}</div>`;
}

// ════════════════════════════════════════
//  TEACHER & ROOM SELECTION & SEARCH
// ════════════════════════════════════════
window.openTeacher = function(name) {
  setView('teacher');
  selectTeacher(name);
  closeSidebar();
};

window.openRoom = function(room) {
  setView('classroom');
  selectClassroom(room);
  closeSidebar();
};

window.clearTeacherSelection = function() {
  S.selectedTeacher = null;
  if (els.teacherSearchInput) els.teacherSearchInput.value = '';
  if (els.teacherResult) els.teacherResult.innerHTML = '';
  renderTeachersList('');
};

window.clearClassroomSelection = function() {
  S.selectedClassroom = null;
  if (els.classroomSearchInput) els.classroomSearchInput.value = '';
  if (els.classroomResult) els.classroomResult.innerHTML = '';
  renderClassroomsList('');
};

async function fetchEntityList(stateKey, endpoint, force = false) {
  if (S[stateKey].length === 0 || force) {
    try {
      const tabParam = S.activeGid ? `?tab=${encodeURIComponent(S.activeGid)}` : '';
      const res = await fetch(`${API}/${endpoint}${tabParam}`);
      if (res.ok) {
        const data = await res.json();
        S[stateKey] = data[endpoint] || [];
      }
    } catch (e) {
      console.error(`Ошибка загрузки ${endpoint}:`, e);
    }
  }
}

function renderEntityScheduleByDay(byDay, metaType) {
  let html = '';
  let totalLessons = 0;
  const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

  days.forEach(day => {
    const rows = byDay[day];
    if (!rows || rows.length === 0) return;
    totalLessons += rows.length;
    html += `<div class="week-day-header"><span class="week-day-name">${day}</span></div>`;
    rows.forEach(r => {
      const pn = r.pair_num || '?';
      const timeStr = r.time || '';
      const metaBtn = metaType === 'teacher'
        ? (r.classroom ? `<button class="pair-room-btn" onclick="openRoom('${esc(r.classroom)}')">${ICONS.mapPin} <span>${esc(r.classroom)}</span></button>` : '')
        : (r.teacher ? `<button class="pair-teacher-btn" onclick="openTeacher('${esc(r.teacher)}')">${ICONS.user} <span>${esc(r.teacher)}</span></button>` : '');

      html += `<div class="pair-card">
        <div class="pair-num-col"><div class="pair-num">${pn}</div><div class="pair-time-small">${timeStr.split('-')[0] || ''}</div></div>
        <div class="pair-body">
          <div class="pair-subject">${esc(r.subject)}</div>
          <div class="pair-meta">
            <span class="pair-badge badge-going">${esc(r.group)}</span>
            ${metaBtn}
            ${r.week ? `<span class="pair-badge">${esc(r.week)}</span>` : ''}
          </div>
        </div>
      </div>`;
    });
  });

  return { html, totalLessons };
}

async function initTeachersView(force = false) {
  await fetchEntityList('teachersList', 'teachers', force);
  renderTeachersList(els.teacherSearchInput?.value || '');
}

function renderTeachersList(query = '') {
  if (!els.teachersGrid) return;
  const q = query.toLowerCase().trim();
  const filtered = S.teachersList.filter(t => !q || t.toLowerCase().includes(q));

  if (els.teacherCountBadge) {
    els.teacherCountBadge.textContent = `${filtered.length} из ${S.teachersList.length}`;
  }

  if (filtered.length === 0) {
    els.teachersGrid.innerHTML = `<div class="empty-pairs-hint" style="grid-column: 1/-1; padding: 16px 0;">Преподаватели не найдены</div>`;
    return;
  }

  let html = '';
  filtered.forEach(t => {
    const isAct = (t === S.selectedTeacher);
    html += `<button class="teacher-chip-btn${isAct ? ' active' : ''}" data-teacher="${esc(t)}">
      <span class="teacher-chip-icon">${ICONS.gradCap}</span>
      <span class="teacher-chip-name" title="${esc(t)}">${esc(t)}</span>
    </button>`;
  });

  els.teachersGrid.innerHTML = html;

  els.teachersGrid.querySelectorAll('.teacher-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectTeacher(btn.dataset.teacher);
    });
  });
}

async function selectTeacher(teacherName) {
  if (!teacherName) return;
  S.selectedTeacher = teacherName;
  if (els.teacherSearchInput) els.teacherSearchInput.value = teacherName;
  renderTeachersList(teacherName);

  if (!els.teacherResult) return;
  els.teacherResult.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><div>Загрузка расписания преподавателя...</div></div>';

  try {
    const tabParam = S.activeGid ? `&tab=${encodeURIComponent(S.activeGid)}` : '';
    const res = await fetch(`${API}/teacher-schedule?teacher=${encodeURIComponent(teacherName.trim())}${tabParam}`);
    if (!res.ok) {
      els.teacherResult.innerHTML = `<div class="empty-pairs-hint">Преподаватель "${esc(teacherName)}" не найден</div>`;
      return;
    }

    const data = await res.json();
    const { html: daysHtml, totalLessons } = renderEntityScheduleByDay(data.days || {}, 'teacher');

    let html = `
      <div class="selected-target-banner">
        <div class="selected-target-title">
          <span>${ICONS.gradCap} ${esc(teacherName)}</span>
        </div>
        <button class="selected-target-clear-btn" onclick="clearTeacherSelection()">${ICONS.x} Сбросить</button>
      </div>
    `;

    html += (totalLessons > 0) ? daysHtml : '<div class="empty-pairs-hint">Занятий на текущую неделю не найдено</div>';
    els.teacherResult.innerHTML = html;
    els.teacherResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    els.teacherResult.innerHTML = `<div class="empty-pairs-hint">Ошибка поиска: ${esc(e.message)}</div>`;
  }
}

async function initClassroomsView(force = false) {
  await fetchEntityList('classroomsList', 'classrooms', force);
  renderClassroomsList(els.classroomSearchInput?.value || '');
}

function renderClassroomsList(query = '') {
  if (!els.classroomsGrid) return;
  const q = query.toLowerCase().trim();
  const filtered = S.classroomsList.filter(c => !q || c.toLowerCase().includes(q));

  if (els.classroomCountBadge) {
    els.classroomCountBadge.textContent = `${filtered.length} из ${S.classroomsList.length}`;
  }

  if (filtered.length === 0) {
    els.classroomsGrid.innerHTML = `<div class="empty-pairs-hint" style="grid-column: 1/-1; padding: 16px 0;">Аудитории не найдены</div>`;
    return;
  }

  let html = '';
  filtered.forEach(c => {
    const isAct = (c === S.selectedClassroom);
    html += `<button class="classroom-chip-btn${isAct ? ' active' : ''}" data-room="${esc(c)}">
      ${esc(c)}
    </button>`;
  });

  els.classroomsGrid.innerHTML = html;

  els.classroomsGrid.querySelectorAll('.classroom-chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectClassroom(btn.dataset.room);
    });
  });
}

async function selectClassroom(roomName) {
  if (!roomName) return;
  S.selectedClassroom = roomName;
  if (els.classroomSearchInput) els.classroomSearchInput.value = roomName;
  renderClassroomsList(roomName);

  if (!els.classroomResult) return;
  els.classroomResult.innerHTML = '<div class="loading-placeholder"><div class="loading-spinner"></div><div>Загрузка занятости аудитории...</div></div>';

  try {
    const tabParam = S.activeGid ? `&tab=${encodeURIComponent(S.activeGid)}` : '';
    const res = await fetch(`${API}/classroom-schedule?room=${encodeURIComponent(roomName.trim())}${tabParam}`);
    if (!res.ok) {
      els.classroomResult.innerHTML = `<div class="empty-pairs-hint">Аудитория "${esc(roomName)}" не найдена</div>`;
      return;
    }

    const data = await res.json();
    const { html: daysHtml, totalLessons } = renderEntityScheduleByDay(data.days || {}, 'classroom');

    let html = `
      <div class="selected-target-banner">
        <div class="selected-target-title">
          <span>${ICONS.door} Аудитория ${esc(roomName)}</span>
        </div>
        <button class="selected-target-clear-btn" onclick="clearClassroomSelection()">${ICONS.x} Сбросить</button>
      </div>
    `;

    html += (totalLessons > 0) ? daysHtml : '<div class="empty-pairs-hint">Занятий в аудитории не найдено</div>';
    els.classroomResult.innerHTML = html;
    els.classroomResult.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    els.classroomResult.innerHTML = `<div class="empty-pairs-hint">Ошибка поиска: ${esc(e.message)}</div>`;
  }
}

function setupSearchInputs() {
  // Живая фильтрация преподавателей при вводе
  els.teacherSearchInput?.addEventListener('input', () => {
    renderTeachersList(els.teacherSearchInput.value);
  });
  els.teacherSearchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = els.teacherSearchInput.value.trim();
      if (q) selectTeacher(q);
    }
  });
  els.teacherSearchBtn?.addEventListener('click', () => {
    const q = els.teacherSearchInput?.value.trim();
    if (q) selectTeacher(q);
  });

  // Живая фильтрация аудиторий при вводе
  els.classroomSearchInput?.addEventListener('input', () => {
    renderClassroomsList(els.classroomSearchInput.value);
  });
  els.classroomSearchInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const q = els.classroomSearchInput.value.trim();
      if (q) selectClassroom(q);
    }
  });
  els.classroomSearchBtn?.addEventListener('click', () => {
    const q = els.classroomSearchInput?.value.trim();
    if (q) selectClassroom(q);
  });
}

// ════════════════════════════════════════
//  EMERGENCY ENGLISH DEADLINE ALARM (💀🚨)
// ════════════════════════════════════════
let englishCountdownInterval = null;
let currentEnglishTargetDate = null;

function findUpcomingEnglishInSchedule(data) {
  if (!data || !data.days) return null;
  const now = new Date();
  const dayDates = data.day_dates || {};
  let candidates = [];

  for (const [dayName, pairs] of Object.entries(data.days)) {
    const dm = dayDates[dayName];
    if (!dm) continue;
    const parts = dm.split('.');
    if (parts.length < 2) continue;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const year = now.getFullYear();

    for (const p of pairs) {
      if (p.is_empty) continue;
      const pairInfo = p.both || p.numerator || p.denominator || {};
      const subj = pairInfo.subject || p.subject || '';
      if (!subj) continue;

      if (/англ|иностр/i.test(subj)) {
        const startStr = (p.start || (p.time ? p.time.split('-')[0] : '')).trim();
        const [startH, startM] = startStr.split(':').map(Number);
        const targetDate = new Date(year, m - 1, d, startH || 8, startM || 0, 0);

        if (targetDate.getTime() > now.getTime()) {
          candidates.push({
            dayName,
            dateFormatted: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${year}`,
            pairNum: p.pair_num || p.num || 1,
            time: p.time || `${p.start} - ${p.end}`,
            subject: subj,
            teacher: pairInfo.teacher || p.teacher || '',
            room: pairInfo.classroom || pairInfo.room || p.classroom || p.room || '',
            targetDate
          });
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.targetDate.getTime() - b.targetDate.getTime());
  return candidates[0];
}

async function startEnglishCountdown() {
  stopEnglishCountdown();

  const daysEl = document.getElementById('alarmDays');
  const hoursEl = document.getElementById('alarmHours');
  const minsEl = document.getElementById('alarmMinutes');
  const secsEl = document.getElementById('alarmSeconds');
  const groupNoticeEl = document.getElementById('alarmGroupNotice');
  const dateEl = document.getElementById('alarmPairDate');
  const timeEl = document.getElementById('alarmPairTime');
  const subjEl = document.getElementById('alarmPairSubject');
  const teacherEl = document.getElementById('alarmPairTeacher');
  const roomEl = document.getElementById('alarmPairRoom');

  if (groupNoticeEl) groupNoticeEl.textContent = `Группа: ${S.group || '—'}`;
  if (dateEl) dateEl.textContent = 'Поиск ближайшей пары по расписанию...';
  if (timeEl) timeEl.textContent = 'Определение времени...';

  // 1. Быстрый и безошибочный серверный API
  let serverAlarm = null;
  try {
    const res = await fetchWithTimeout(`${API}/english-alarm?group=${encodeURIComponent(S.group || 'ИСС9-25')}`, {}, 6000);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found) {
        serverAlarm = data;
      }
    }
  } catch (err) {
    console.warn('Серверный запрос будильника не удался, переходим на клиентский поиск:', err);
  }

  if (serverAlarm) {
    if (dateEl) dateEl.textContent = serverAlarm.display_date;
    if (timeEl) timeEl.textContent = `${serverAlarm.pair_num} пара (${serverAlarm.time})`;
    if (subjEl) subjEl.textContent = serverAlarm.subject;
    if (teacherEl) teacherEl.textContent = serverAlarm.teacher || 'Не указан';
    if (roomEl) roomEl.textContent = serverAlarm.classroom ? `ауд. ${serverAlarm.classroom}` : 'Не указана';

    currentEnglishTargetDate = new Date(serverAlarm.target_iso);
  } else {
    // 2. Клиентский резервный поиск
    let englishPair = findUpcomingEnglishInSchedule(S.data);

    // Если в текущей вкладке нет — проверяем другие вкладки
    if (!englishPair && S.data?.available_tabs?.length) {
      const activeGid = S.data.active_gid || S.activeGid;
      for (const tab of S.data.available_tabs) {
        if (tab.gid === activeGid) continue;
        try {
          let tabData = null;
          const cacheKey = `schedule_${S.group}_${tab.gid}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try { tabData = JSON.parse(cached); } catch (_) {}
          }
          if (!tabData) {
            const res = await fetchWithTimeout(`${API}/schedule?group=${encodeURIComponent(S.group)}&tab=${encodeURIComponent(tab.gid)}`, {}, 5000);
            if (res.ok) {
              tabData = await res.json();
              try { localStorage.setItem(cacheKey, JSON.stringify(tabData)); } catch (_) {}
            }
          }
          if (tabData) {
            const candidate = findUpcomingEnglishInSchedule(tabData);
            if (candidate) {
              englishPair = candidate;
              break;
            }
          }
        } catch (err) {
          console.warn('Ошибка проверки вкладки на английский:', err);
        }
      }
    }

    if (!englishPair) {
      if (dateEl) dateEl.textContent = 'В расписании группы пар не найдено';
      if (timeEl) timeEl.textContent = '—';
      if (subjEl) subjEl.textContent = 'Иностранный язык';
      if (teacherEl) teacherEl.textContent = '—';
      if (roomEl) roomEl.textContent = '—';
      if (daysEl) daysEl.textContent = '00';
      if (hoursEl) hoursEl.textContent = '00';
      if (minsEl) minsEl.textContent = '00';
      if (secsEl) secsEl.textContent = '00';
      return;
    }

    if (dateEl) dateEl.textContent = `${englishPair.dayName}, ${englishPair.dateFormatted}`;
    if (timeEl) timeEl.textContent = `${englishPair.pairNum} пара (${englishPair.time})`;
    if (subjEl) subjEl.textContent = englishPair.subject;
    if (teacherEl) teacherEl.textContent = englishPair.teacher || 'Не указан';
    if (roomEl) roomEl.textContent = englishPair.room ? `ауд. ${englishPair.room}` : 'Не указана';

    currentEnglishTargetDate = englishPair.targetDate;
  }

  function tick() {
    if (!currentEnglishTargetDate) return;
    const now = new Date();
    const diff = currentEnglishTargetDate.getTime() - now.getTime();
    if (diff <= 0) {
      if (daysEl) daysEl.textContent = '00';
      if (hoursEl) hoursEl.textContent = '00';
      if (minsEl) minsEl.textContent = '00';
      if (secsEl) secsEl.textContent = '00';
      if (dateEl) dateEl.textContent += ' (ИДЁТ СЕЙЧАС ИЛИ ЗАВЕРШИЛСЯ)';
      stopEnglishCountdown();
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);

    if (daysEl) daysEl.textContent = String(d).padStart(2, '0');
    if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
    if (minsEl) minsEl.textContent = String(m).padStart(2, '0');
    if (secsEl) secsEl.textContent = String(s).padStart(2, '0');
  }

  tick();
  englishCountdownInterval = setInterval(tick, 1000);
}

function stopEnglishCountdown() {
  if (englishCountdownInterval) {
    clearInterval(englishCountdownInterval);
    englishCountdownInterval = null;
  }
}

// ════════════════════════════════════════
//  GROUP SCHEDULE STATISTICS VIEW (С 1 СЕНТЯБРЯ ПО СЕГОДНЯ)
// ════════════════════════════════════════
function initStatsView() {
  renderStatsView();
}

function getPairWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'пар';
  if (mod10 === 1) return 'пара';
  if (mod10 >= 2 && mod10 <= 4) return 'пары';
  return 'пар';
}

function calculateUnifiedSeptStats(currentScheduleData, septFirstScheduleData) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let totalPassed = 0;
  const passedSubjectsMap = {};
  const uniqueDatesSet = new Set();

  function recordPassedPair(p, pairInfo, subj, dateStr, dayName) {
    totalPassed++;
    uniqueDatesSet.add(dateStr);

    if (!passedSubjectsMap[subj]) {
      passedSubjectsMap[subj] = {
        name: subj,
        count: 0,
        sessions: [],
        teacher: pairInfo.teacher || p.teacher || '',
        room: pairInfo.classroom || pairInfo.room || p.classroom || p.room || ''
      };
    }
    const entry = passedSubjectsMap[subj];
    entry.count++;
    entry.sessions.push({
      date: dateStr,
      dayName,
      num: p.pair_num || p.num || 1,
      time: p.time || `${p.start || ''} - ${p.end || ''}`.trim()
    });
    if (!entry.teacher && (pairInfo.teacher || p.teacher)) {
      entry.teacher = pairInfo.teacher || p.teacher;
    }
    if (!entry.room && (pairInfo.classroom || p.room)) {
      entry.room = pairInfo.classroom || p.room;
    }
  }

  // 1. Вкладка «Расписание 1 сентября» (01.09.2026, Вторник)
  if (septFirstScheduleData && septFirstScheduleData.days) {
    for (const [dayName, pairs] of Object.entries(septFirstScheduleData.days)) {
      for (const p of pairs) {
        if (p.is_empty) continue;
        const pairInfo = p.both || p.numerator || p.denominator || {};
        const subj = (pairInfo.subject || p.subject || '').trim();
        if (!subj || /самостоятельн/i.test(subj)) continue;
        recordPassedPair(p, pairInfo, subj, '01.09', 'Вторник');
      }
    }
  }

  // 2. Вкладка текущей недели (02.09 - 05.09)
  if (currentScheduleData && currentScheduleData.days) {
    const dayDates = currentScheduleData.day_dates || {};

    for (const [dayName, pairs] of Object.entries(currentScheduleData.days)) {
      const dm = dayDates[dayName];
      if (!dm) continue;
      const parts = dm.split('.');
      if (parts.length < 2) continue;
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const dayDate = new Date(now.getFullYear(), m - 1, d, 0, 0, 0, 0);

      // Учитываем только дни до сегодня включительно
      if (dayDate.getTime() > todayStart.getTime()) {
        continue;
      }

      for (const p of pairs) {
        if (p.is_empty) continue;
        const pairInfo = p.both || p.numerator || p.denominator || {};
        const subj = (pairInfo.subject || p.subject || '').trim();
        if (!subj || /самостоятельн/i.test(subj)) continue;

        let isPassed = false;
        if (dayDate.getTime() < todayStart.getTime()) {
          isPassed = true;
        } else {
          // Сегодня: проверяем время окончания пары
          const endStr = (p.end || (p.time ? p.time.split('-')[1] : '')).trim();
          const endParts = endStr.split(':').map(Number);
          const endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
          isPassed = (nowMinutes >= endMin);
        }

        if (isPassed) {
          recordPassedPair(p, pairInfo, subj, dm, dayName);
        }
      }
    }
  }

  const subjectList = Object.values(passedSubjectsMap);
  subjectList.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    totalPassed,
    uniqueDaysCount: uniqueDatesSet.size,
    subjectList
  };
}

async function renderStatsView() {
  if (!els.statsContainer) return;

  if (!S.data || S.isNotPublished) {
    els.statsContainer.innerHTML = `
      <div class="stats-header-wrap">
        <h2 class="stats-view-title">Статистика пар: ${esc(S.group || 'Группа не выбрана')}</h2>
        <span class="stats-view-subtitle">Расписание на этот период ещё не опубликовано</span>
      </div>
      <div class="schedule-error-card">
        <p>Расписание для группы ${esc(S.group || '')} пока недоступно для расчёта статистики.</p>
      </div>
    `;
    return;
  }

  els.statsContainer.innerHTML = `
    <div class="loading-placeholder">
      <div class="loading-spinner"></div>
      <div>Сбор статистики с 1 сентября по сегодняшний день...</div>
    </div>
  `;

  // Подгружаем вкладку 1 сентября (gid 731591268) при её наличии
  let septFirstData = null;
  const septCacheKey = `schedule_${S.group}_731591268`;
  const cachedSept = localStorage.getItem(septCacheKey);
  if (cachedSept) {
    try { septFirstData = JSON.parse(cachedSept); } catch (_) {}
  }
  if (!septFirstData) {
    try {
      const res = await fetchWithTimeout(`${API}/schedule?group=${encodeURIComponent(S.group)}&tab=731591268`, {}, 4000);
      if (res.ok) {
        septFirstData = await res.json();
        try { localStorage.setItem(septCacheKey, JSON.stringify(septFirstData)); } catch (_) {}
      }
    } catch (e) {
      console.warn('Tab 1 Sept not found or error:', e);
    }
  }

  const stats = calculateUnifiedSeptStats(S.data, septFirstData);
  const now = new Date();
  const dayStr = String(now.getDate()).padStart(2, '0');
  const monthStr = MONTH_NAMES[now.getMonth()];
  const todayFormatted = `${now.getDate()} ${monthStr} ${now.getFullYear()} г.`;
  const timeFormatted = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  els.statsContainer.innerHTML = `
    <div class="stats-header-wrap">
      <h2 class="stats-view-title">Статистика пар с 1 сентября по сегодня</h2>
      <div class="stats-view-subtitle">
        Группа: <strong>${esc(S.group || '—')}</strong> • Период: 01.09 – ${dayStr}.${String(now.getMonth() + 1).padStart(2, '0')} (${todayFormatted}, ${timeFormatted})
      </div>
    </div>

    <!-- KPI Hero Grid -->
    <div class="stats-kpi-grid">
      <div class="stats-kpi-card hero-kpi">
        <div class="stats-kpi-top">
          <span class="stats-kpi-label">Прошло пар с 1 сентября</span>
          <span class="stats-kpi-icon">🏆</span>
        </div>
        <div class="stats-kpi-value">${stats.totalPassed}</div>
      </div>
      <div class="stats-kpi-card">
        <div class="stats-kpi-top">
          <span class="stats-kpi-label">Предметов проведено</span>
          <span class="stats-kpi-icon">📚</span>
        </div>
        <div class="stats-kpi-value">${stats.subjectList.length}</div>
      </div>
      <div class="stats-kpi-card">
        <div class="stats-kpi-top">
          <span class="stats-kpi-label">Учебных дней с парами</span>
          <span class="stats-kpi-icon">📅</span>
        </div>
        <div class="stats-kpi-value">${stats.uniqueDaysCount}</div>
      </div>
    </div>

    <!-- Passed Subjects List -->
    <div class="stats-subjects-block">
      <div class="stats-block-header">
        <span class="stats-block-title">Какие пары уже прошли с 1 сентября (${stats.subjectList.length})</span>
      </div>

      <div class="stats-subjects-list">
        ${stats.subjectList.length === 0 ? `
          <div class="schedule-error-card">
            <p>За период с 1 сентября по сегодняшний день завершённых занятий для группы ${esc(S.group || '')} не найдено.</p>
          </div>
        ` : ''}
        ${stats.subjectList.map(item => {
          const sessionsByDate = {};
          item.sessions.forEach(s => {
            if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
            sessionsByDate[s.date].push(s.num);
          });
          const sessionTags = Object.entries(sessionsByDate).map(([date, nums]) => {
            nums.sort((a, b) => a - b);
            return `<span class="stats-session-chip">📅 ${date} (${nums.join(', ')} пара)</span>`;
          }).join('');

          return `
            <div class="stats-passed-card">
              <div class="stats-passed-top">
                <span class="stats-passed-name">${esc(item.name)}</span>
                <span class="stats-passed-badge">${item.count} ${getPairWord(item.count)} прошло</span>
              </div>
              <div class="stats-sessions-chips">
                ${sessionTags}
              </div>
              <div class="stats-passed-meta">
                <span class="stats-passed-teacher">${item.teacher ? `👨‍🏫 ${esc(item.teacher)}` : 'Преподаватель не указан'}</span>
                <span class="stats-passed-room">${item.room ? `ауд. ${esc(item.room)}` : ''}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ════════════════════════════════════════
//  GROUP SELECTION (ПЛИТКИ / КВАДРАТИКИ)
// ════════════════════════════════════════
function ensureGroupsLoaded() {
  if (!S.groupsList || S.groupsList.length === 0) {
    try {
      const cached = localStorage.getItem('cached_groups_v2');
      if (cached) S.groupsList = JSON.parse(cached);
    } catch (_) {}
    if (!S.groupsList || S.groupsList.length === 0) {
      S.groupsList = DEFAULT_GROUPS;
    }
  }
  // Фоновое обновление с сервера
  try {
    const tabParam = S.activeGid ? `?tab=${encodeURIComponent(S.activeGid)}` : '';
    fetch(`${API}/groups${tabParam}`).then(res => {
      if (res.ok) return res.json();
    }).then(data => {
      if (data && data.groups && data.groups.length > 0) {
        S.groupsList = data.groups;
        try { localStorage.setItem('cached_groups_v2', JSON.stringify(data.groups)); } catch (_) {}
      }
    }).catch(() => {});
  } catch (_) {}
  return S.groupsList || DEFAULT_GROUPS;
}

function saveActiveGroup(grp) {
  S.group = grp;
  try {
    localStorage.setItem(STORAGE_GROUP, grp);
    localStorage.setItem('schedule_group', grp);
  } catch (_) {}
  if (window.Telegram?.WebApp?.CloudStorage) {
    try {
      window.Telegram.WebApp.CloudStorage.setItem(STORAGE_GROUP, grp);
    } catch (_) {}
  }
  try {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser?.id) {
      fetch('/api/user-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: String(tgUser.id), group: grp })
      }).catch(() => {});
    }
  } catch (_) {}
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('group', grp);
    window.history.replaceState(null, '', u.toString());
  } catch (_) {}
}

function openGroupModal() {
  ensureGroupsLoaded();
  els.groupModal?.classList.add('open');
  buildGroupGrid(els.groupsGrid, els.groupSearchInput, els.courseChips, (grp) => {
    if (S.group === grp && S.data) {
      closeGroupModal();
      return;
    }
    saveActiveGroup(grp);
    closeGroupModal();
    updateSidebarGroupInfo();
    renderSkeleton();
    loadSchedule(true);
    startAutoRefresh();
  });
}

function closeGroupModal() {
  els.groupModal?.classList.remove('open');
}

els.closeGroupModal?.addEventListener('click', closeGroupModal);
els.groupModal?.addEventListener('click', e => { if (e.target === els.groupModal) closeGroupModal(); });

function showOnboarding() {
  ensureGroupsLoaded();
  els.onboardModal?.classList.add('open');
  buildGroupGrid(els.onboardGroupsGrid, els.onboardSearchInput, els.onboardCourseChips, (grp) => {
    saveActiveGroup(grp);
    els.onboardModal?.classList.remove('open');
    updateSidebarGroupInfo();
    loadSchedule(true);
    startAutoRefresh();
  });
}

function buildGroupGrid(gridEl, searchEl, chipsEl, onSelect) {
  if (!gridEl) return;
  const groups = S.groupsList || [];

  if (groups.length === 0) {
    gridEl.innerHTML = '<div class="empty-pairs-hint">Загрузка групп...</div>';
    return;
  }

  let activeFilter = 'all';

  function detectCourse(gName) {
    if (gName.includes('9-') || gName.startsWith('10-') || gName.includes('-26')) return '1 курс';
    if (gName.includes('-25') || gName.includes('-24')) return '2 курс';
    if (gName.includes('-23')) return '3 курс';
    if (gName.includes('-22')) return '4 курс';
    if (gName.toLowerCase().includes('оз') || gName.toLowerCase().includes('заоч')) return 'Очно-заочное';
    return 'Другое';
  }

  const normalizedGroups = groups.map(item => {
    const name = typeof item === 'string' ? item : item.name;
    const course = (typeof item === 'object' && item.course) ? item.course : detectCourse(name);
    return { name, course, lower: name.toLowerCase() };
  });

  function render(filter, query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = normalizedGroups.filter(item => {
      const matchQ = !q || item.lower.includes(q);
      const matchF = filter === 'all' || item.course === filter;
      return matchQ && matchF;
    });

    const byCourse = {};
    filtered.forEach(item => {
      (byCourse[item.course] = byCourse[item.course] || []).push(item);
    });

    let html = '<div class="groups-container">';
    const order = ['1 курс', '2 курс', '3 курс', '4 курс', 'Очно-заочное', 'Другое'];
    let anyGroups = false;

    order.forEach(course => {
      const items = byCourse[course];
      if (!items || items.length === 0) return;
      anyGroups = true;

      if (filter === 'all') {
        html += `<div class="course-section-title">${ICONS.gradCap} <span>${esc(course)}</span> <span class="course-section-count">(${items.length})</span></div>`;
      }
      html += '<div class="groups-tiles-grid">';
      items.forEach(item => {
        const isSel = (item.name === S.group);
        html += `<button class="group-tile${isSel ? ' selected' : ''}" data-group="${esc(item.name)}">
          <span class="group-tile-name">${esc(item.name)}</span>
          <span class="group-tile-tag">${esc(item.course)}</span>
        </button>`;
      });
      html += '</div>';
    });

    html += '</div>';

    gridEl.innerHTML = anyGroups ? html : `<div class="empty-pairs-hint">Группы не найдены</div>`;

    gridEl.querySelectorAll('.group-tile').forEach(btn => {
      btn.addEventListener('click', () => onSelect(btn.dataset.group));
    });
  }

  if (chipsEl) {
    chipsEl.querySelectorAll('.course-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.filter === 'all');
      chip.onclick = () => {
        activeFilter = chip.dataset.filter;
        chipsEl.querySelectorAll('.course-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === activeFilter));
        render(activeFilter, searchEl?.value);
      };
    });
  }

  if (searchEl) {
    searchEl.value = '';
    searchEl.oninput = () => render(activeFilter, searchEl.value);
  }

  render('all', '');
}

// ════════════════════════════════════════
//  LAYOUT CONSTRUCTOR & REORDERING
// ════════════════════════════════════════
const STORAGE_LAYOUT_ORDER = 'schedule_layout_order_v1';
const MANDATORY_LAYOUT_WIDGET = 'widget-schedule-content';
const DEFAULT_LAYOUT_ORDER = [
  'widget-live-status',
  'widget-week-nav',
  'widget-day-strip',
  'widget-schedule-content'
];

const PRESETS_LAYOUT = {
  standard: [
    'widget-live-status',
    'widget-week-nav',
    'widget-day-strip',
    'widget-schedule-content'
  ],
  daysFirst: [
    'widget-day-strip',
    'widget-live-status',
    'widget-week-nav',
    'widget-schedule-content'
  ],
  scheduleFocus: [
    'widget-schedule-content',
    'widget-live-status',
    'widget-week-nav',
    'widget-day-strip'
  ]
};

let sortableLayoutInstance = null;
let isLayoutEditingMode = false;
let layoutOrderBeforeEdit = null;

function validateLayoutOrder(order) {
  if (!Array.isArray(order) || order.length === 0) {
    return [...DEFAULT_LAYOUT_ORDER];
  }
  // Anti-brick rule: обязательно наличие основного расписания
  if (!order.includes(MANDATORY_LAYOUT_WIDGET)) {
    console.warn('[Layout] Missing mandatory widget, resetting to default.');
    return [...DEFAULT_LAYOUT_ORDER];
  }
  const validWidgets = new Set(DEFAULT_LAYOUT_ORDER);
  const cleanOrder = order.filter(id => validWidgets.has(id));
  const uniqueOrder = Array.from(new Set(cleanOrder));
  // Если какие-то виджеты отсутствуют — дополняем их в конец
  DEFAULT_LAYOUT_ORDER.forEach(id => {
    if (!uniqueOrder.includes(id)) uniqueOrder.push(id);
  });
  return uniqueOrder;
}

function getStoredLayoutOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_LAYOUT_ORDER);
    if (!raw) return [...DEFAULT_LAYOUT_ORDER];
    const parsed = JSON.parse(raw);
    return validateLayoutOrder(parsed);
  } catch (err) {
    console.error('[Layout] Failed to parse stored layout:', err);
    return [...DEFAULT_LAYOUT_ORDER];
  }
}

function getCurrentDOMOrder() {
  const container = els.mainFlowContainer || $('mainFlowContainer');
  if (!container) return [...DEFAULT_LAYOUT_ORDER];
  const items = container.querySelectorAll('.flow-widget');
  const order = [];
  items.forEach(item => {
    const id = item.dataset.widget;
    if (id) order.push(id);
  });
  return validateLayoutOrder(order);
}

function applyLayoutOrder(order, persist = false) {
  const validated = validateLayoutOrder(order);
  const container = els.mainFlowContainer || $('mainFlowContainer');
  if (!container) return;

  // Безопасное перемещение существующих DOM-элементов без перерисовки и без потери слушателей событий
  validated.forEach(widgetId => {
    const el = container.querySelector(`.flow-widget[data-widget="${widgetId}"]`);
    if (el) {
      container.appendChild(el);
    }
  });

  if (persist) {
    try {
      localStorage.setItem(STORAGE_LAYOUT_ORDER, JSON.stringify(validated));
    } catch (e) {
      console.warn('[Layout] Failed to save layout to localStorage:', e);
    }
  }

  // Обновление отображения кнопок сброса
  const isCustom = !areArraysEqual(validated, DEFAULT_LAYOUT_ORDER);
  if (els.sidebarResetLayoutBtn) {
    els.sidebarResetLayoutBtn.style.display = isCustom ? 'flex' : 'none';
  }
  if (els.modalResetLayoutBtn) {
    els.modalResetLayoutBtn.style.display = isCustom ? 'inline-flex' : 'none';
  }
}

function areArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function updatePresetChipsUI() {
  const current = getCurrentDOMOrder();
  const isStd = areArraysEqual(current, PRESETS_LAYOUT.standard);
  const isDays = areArraysEqual(current, PRESETS_LAYOUT.daysFirst);
  const isFocus = areArraysEqual(current, PRESETS_LAYOUT.scheduleFocus);

  els.presetStandardBtn?.classList.toggle('active', isStd);
  els.presetDaysFirstBtn?.classList.toggle('active', isDays);
  els.presetScheduleFocusBtn?.classList.toggle('active', isFocus);
}

function enterLayoutEditor() {
  if (isLayoutEditingMode) return;
  isLayoutEditingMode = true;

  try { closeSidebar(); } catch (_) {}
  try { closeThemeModal(); } catch (_) {}

  layoutOrderBeforeEdit = getCurrentDOMOrder();
  document.body.classList.add('layout-editing-active');
  if (els.layoutEditorBar) els.layoutEditorBar.style.display = 'block';

  // Инициализация или включение Sortable.js
  const container = els.mainFlowContainer || $('mainFlowContainer');
  if (container && window.Sortable) {
    if (!sortableLayoutInstance) {
      sortableLayoutInstance = Sortable.create(container, {
        animation: 220,
        handle: '.widget-drag-handle',
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        touchStartThreshold: 4,
        forceFallback: false,
        onEnd: () => {
          updatePresetChipsUI();
        }
      });
    } else {
      sortableLayoutInstance.option('disabled', false);
    }
  }

  updatePresetChipsUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitLayoutEditor(save = false) {
  if (!isLayoutEditingMode) return;
  const current = getCurrentDOMOrder();

  if (save) {
    applyLayoutOrder(current, true);
    showLayoutNotification('Расположение блоков сохранено!');
  } else {
    // Отмена: возвращаем исходный порядок
    if (layoutOrderBeforeEdit) {
      applyLayoutOrder(layoutOrderBeforeEdit, false);
    }
  }

  isLayoutEditingMode = false;
  document.body.classList.remove('layout-editing-active');
  if (els.layoutEditorBar) els.layoutEditorBar.style.display = 'none';
  if (sortableLayoutInstance) {
    sortableLayoutInstance.option('disabled', true);
  }
}

function resetLayoutOrder() {
  try {
    localStorage.removeItem(STORAGE_LAYOUT_ORDER);
  } catch (_) {}
  applyLayoutOrder(DEFAULT_LAYOUT_ORDER, false);
  updatePresetChipsUI();
  showLayoutNotification('Расположение блоков сброшено по умолчанию');
  if (!isLayoutEditingMode) {
    if (els.sidebarResetLayoutBtn) els.sidebarResetLayoutBtn.style.display = 'none';
    if (els.modalResetLayoutBtn) els.modalResetLayoutBtn.style.display = 'none';
  }
}

function showLayoutNotification(msg) {
  let toast = $('layoutToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'layoutToast';
    toast.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      background: var(--bg-card, #1c1c28);
      color: var(--text, #fff);
      border: 1px solid var(--accent, #6366f1);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      padding: 10px 18px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      z-index: 2500;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>⚡</span> <span>${esc(msg)}</span>`;
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
  }, 2600);
}

function initLayoutManager() {
  // 1. Восстанавливаем порядок блоков при старте
  const saved = getStoredLayoutOrder();
  applyLayoutOrder(saved, false);

  // 2. Слушатели кнопок открытия и сброса
  els.sidebarLayoutEditorBtn?.addEventListener('click', () => {
    closeSidebar();
    enterLayoutEditor();
  });
  els.sidebarResetLayoutBtn?.addEventListener('click', () => {
    resetLayoutOrder();
    closeSidebar();
  });
  els.modalOpenLayoutEditorBtn?.addEventListener('click', () => {
    closeThemeModal();
    enterLayoutEditor();
  });
  els.modalResetLayoutBtn?.addEventListener('click', () => {
    resetLayoutOrder();
  });

  // Кнопки плавающей панели действий
  els.layoutSaveBtn?.addEventListener('click', () => exitLayoutEditor(true));
  els.layoutCancelBtn?.addEventListener('click', () => exitLayoutEditor(false));
  els.layoutResetBtn?.addEventListener('click', () => {
    applyLayoutOrder(DEFAULT_LAYOUT_ORDER, false);
    updatePresetChipsUI();
  });

  // Пресеты
  els.presetStandardBtn?.addEventListener('click', () => {
    applyLayoutOrder(PRESETS_LAYOUT.standard, false);
    updatePresetChipsUI();
  });
  els.presetDaysFirstBtn?.addEventListener('click', () => {
    applyLayoutOrder(PRESETS_LAYOUT.daysFirst, false);
    updatePresetChipsUI();
  });
  els.presetScheduleFocusBtn?.addEventListener('click', () => {
    applyLayoutOrder(PRESETS_LAYOUT.scheduleFocus, false);
    updatePresetChipsUI();
  });

  // Клавиша Escape для выхода без сохранения
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isLayoutEditingMode) {
      exitLayoutEditor(false);
    }
  });
}

// ── UTILS ───────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
