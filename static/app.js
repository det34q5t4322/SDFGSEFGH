/**
 * Расписание Колледжа телекоммуникаций
 * Клиентский скрипт: логика расписания, Telegram WebApp, кэширование, перерывы и живые таймеры
 */

// Инициализация Telegram WebApp
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.colorScheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// Константы дней недели
const DAYS_ORDER = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DAY_MAP = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  0: "Воскресенье"
};

// Звонки пар
const BELL_TIMES = [
  { num: 1, start: "08:00", end: "09:35", sMin: 8 * 60, eMin: 9 * 60 + 35, display: "08:00 - 09:35" },
  { num: 2, start: "09:45", end: "11:20", sMin: 9 * 60 + 45, eMin: 11 * 60 + 20, display: "09:45 - 11:20" },
  { num: 3, start: "11:50", end: "13:25", sMin: 11 * 60 + 50, eMin: 13 * 60 + 25, display: "11:50 - 13:25" },
  { num: 4, start: "13:55", end: "15:30", sMin: 13 * 60 + 55, eMin: 15 * 60 + 30, display: "13:55 - 15:30" },
  { num: 5, start: "15:40", end: "17:15", sMin: 15 * 60 + 40, eMin: 17 * 60 + 15, display: "15:40 - 17:15" },
  { num: 6, start: "17:25", end: "19:00", sMin: 17 * 60 + 25, eMin: 19 * 60 + 0, display: "17:25 - 19:00" }
];

// Перемены между парами
const BREAK_TIMES = [
  {
    afterPair: 1,
    beforePair: 2,
    start: "09:35",
    end: "09:45",
    duration: 10,
    isBig: false,
    title: "Перемена 10 мин",
    icon: "",
    sMin: 9 * 60 + 35,
    eMin: 9 * 60 + 45
  },
  {
    afterPair: 2,
    beforePair: 3,
    start: "11:20",
    end: "11:50",
    duration: 30,
    isBig: true,
    title: "Большая перемена 30 мин (Обед)",
    icon: "",
    sMin: 11 * 60 + 20,
    eMin: 11 * 60 + 50
  },
  {
    afterPair: 3,
    beforePair: 4,
    start: "13:25",
    end: "13:55",
    duration: 30,
    isBig: true,
    title: "Большая перемена 30 мин",
    icon: "",
    sMin: 13 * 60 + 25,
    eMin: 13 * 60 + 55
  },
  {
    afterPair: 4,
    beforePair: 5,
    start: "15:30",
    end: "15:40",
    duration: 10,
    isBig: false,
    title: "Перемена 10 мин",
    icon: "",
    sMin: 15 * 60 + 30,
    eMin: 15 * 60 + 40
  },
  {
    afterPair: 5,
    beforePair: 6,
    start: "17:15",
    end: "17:25",
    duration: 10,
    isBig: false,
    title: "Перемена 10 мин",
    icon: "",
    sMin: 17 * 60 + 15,
    eMin: 17 * 60 + 25
  }
];

// Состояние приложения
const state = {
  allGroups: [],
  selectedGroup: localStorage.getItem('college_selected_group') || '',
  favorites: JSON.parse(localStorage.getItem('college_favorites') || '[]'),
  scheduleData: null,
  activeView: 'today', // 'today', 'tomorrow', 'week', 'teacher', 'classroom'
  parityMode: 'auto',  // 'auto', 'num', 'den', 'all'
  currentParity: 'num', // 'num' (числитель) или 'den' (знаменатель)
  weekNumber: 1,
  hideEmpty: true,      // Показывать ТОЛЬКО те пары, которые реально идут в этот день
  lastUpdated: '',
  timestamp: 0,
  teachers: [],
  classrooms: [],
  currentCourseFilter: 'all',
};

// Функция всплывающих уведомлений
function showToast(text) {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-notification';
  toast.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(text)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Безопасное экранирование значения для вставки в JS-атрибут onclick
function escapeAttr(text) {
  if (!text) return '';
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Определение номера недели и чётности (числитель / знаменатель)
function calculateAcademicParity(targetDate = new Date()) {
  const year = targetDate.getMonth() >= 7 ? targetDate.getFullYear() : targetDate.getFullYear() - 1;
  const septFirst = new Date(year, 8, 1); // 1 сентября
  const septFirstDay = septFirst.getDay(); // 0-Вс, 1-Пн...
  const septFirstMonday = new Date(septFirst);
  septFirstMonday.setDate(septFirst.getDate() - ((septFirstDay + 6) % 7));

  const diffTime = targetDate.getTime() - septFirstMonday.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const weekNum = Math.max(1, Math.floor(diffDays / 7) + 1);
  const isNumerator = (weekNum % 2 === 1);

  return {
    weekNum,
    isNumerator,
    parity: isNumerator ? 'num' : 'den',
    parityName: isNumerator ? 'Числитель (I)' : 'Знаменатель (II)'
  };
}

// Обновление плашки недели в интерфейсе
function updateParityUI() {
  const cur = calculateAcademicParity(new Date());
  state.currentParity = cur.parity;
  state.weekNumber = cur.weekNum;

  const autoBtn = document.querySelector('.parity-btn[data-parity="auto"]');
  if (autoBtn) {
    autoBtn.textContent = `Авто (${cur.parity === 'num' ? 'I Числ.' : 'II Знам.'})`;
    autoBtn.title = `Текущая ${cur.weekNum}-я неделя семестра: ${cur.parityName}`;
  }

  const weekBadge = document.getElementById('currentWeekHeaderBadge');
  if (weekBadge) {
    weekBadge.textContent = `${cur.weekNum}-я нед. • ${cur.parityName}`;
  }
}

// ==========================================================================
// API Запросы и Постоянная Авто-Синхронизация
// ==========================================================================

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();
    state.lastUpdated = data.last_updated;
    state.timestamp = data.timestamp || 0;
    
    document.getElementById('syncStatusText').textContent = 
      `Автообновление активно • ${data.last_updated ? data.last_updated.split(' ')[1] : ''}`;
    
    if (data.subtitle) {
      document.getElementById('semesterSubtitle').textContent = data.subtitle;
    }

    if (data.week_info) {
      state.currentParity = data.week_info.parity;
      state.weekNumber = data.week_info.week_number;
    }
    updateParityUI();
  } catch (err) {
    console.error('Ошибка получения статуса:', err);
    showToast('Сетевая ошибка: сервер недоступен');
  }
}

// Постоянная проверка обновлений таблицы каждые 10 секунд
async function checkLiveUpdates() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    const isDifferent = (state.lastUpdated && data.last_updated && data.last_updated !== state.lastUpdated) ||
                        (state.timestamp && data.timestamp && data.timestamp !== state.timestamp);

    if (isDifferent) {
      console.log('Обнаружены свежие данные в Google Таблице. Обновляем...');
      state.lastUpdated = data.last_updated;
      state.timestamp = data.timestamp;

      document.getElementById('syncStatusText').textContent = 
        `Автообновление активно • ${data.last_updated ? data.last_updated.split(' ')[1] : ''}`;
      
      showToast('Расписание автоматически синхронизировано с Google Таблицей!');

      if (state.selectedGroup) {
        const sRes = await fetch(`/api/schedule?group=${encodeURIComponent(state.selectedGroup)}`);
        if (sRes.ok) {
          state.scheduleData = await sRes.json();
          renderCurrentView();
          updateLiveTracker();
        }
      }
    } else if (!state.lastUpdated && data.last_updated) {
      state.lastUpdated = data.last_updated;
      state.timestamp = data.timestamp;
    }
  } catch (err) {
    // игнорируем секундные ошибки сети, но если это долгая проблема, можно показать тост
    if (!state.networkErrorLogged) {
      console.warn('Проблема с подключением к серверу при автообновлении');
      state.networkErrorLogged = true;
    }
  }
}

async function fetchGroups() {
  try {
    const res = await fetch('/api/groups');
    const data = await res.json();
    state.allGroups = data.groups || [];

    // Если группа не выбрана — выбираем первую популярную или первую из списка
    if (!state.selectedGroup && state.allGroups.length > 0) {
      const defaultGroup = state.allGroups.find(g => g.name === 'ИСП9-24А') || state.allGroups[0];
      selectGroup(defaultGroup.name);
    } else if (state.selectedGroup) {
      loadScheduleForGroup(state.selectedGroup);
    }

    renderGroupsGrid();
    renderQuickFavorites();
  } catch (err) {
    console.error('Ошибка загрузки групп:', err);
    document.getElementById('scheduleContent').innerHTML = 
      `<div style="text-align: center; color: #ef4444; padding: 30px;">
        Ошибка загрузки данных с сервера. Проверьте подключение.
      </div>`;
  }
}

async function loadScheduleForGroup(groupName) {
  state.selectedGroup = groupName;
  localStorage.setItem('college_selected_group', groupName);

  // Обновляем шапку
  document.getElementById('currentGroupDisplay').textContent = groupName;
  const groupObj = state.allGroups.find(g => g.name === groupName);
  document.getElementById('currentCourseTag').textContent = groupObj ? groupObj.course : 'Группа';

  updateFavButton();

  document.getElementById('scheduleContent').innerHTML = 
    `<div style="text-align: center; padding: 40px; color: var(--text-muted);">
      Загрузка расписания для ${escapeHtml(groupName)}...
    </div>`;

  try {
    const res = await fetch(`/api/schedule?group=${encodeURIComponent(groupName)}`);
    if (!res.ok) throw new Error('Группа не найдена');
    const data = await res.json();
    state.scheduleData = data;
    renderCurrentView();
    updateLiveTracker();
  } catch (err) {
    console.error('Ошибка получения расписания:', err);
    document.getElementById('scheduleContent').innerHTML = 
      `<div style="text-align: center; color: #ef4444; padding: 30px;">
        Не удалось загрузить расписание для группы ${groupName}
      </div>`;
  }
}

// ==========================================================================
// Рендеринг интерфейса с точным числителем/знаменателем и переменами
// ==========================================================================

function renderCurrentView() {
  if (!state.scheduleData) return;

  const content = document.getElementById('scheduleContent');
  const teacherView = document.getElementById('teacherView');
  const classroomView = document.getElementById('classroomView');

  // Скрываем/показываем нужные контейнеры
  if (state.activeView === 'teacher') {
    content.style.display = 'none';
    teacherView.style.display = 'flex';
    classroomView.style.display = 'none';
    loadTeachersList();
    return;
  }
  if (state.activeView === 'classroom') {
    content.style.display = 'none';
    teacherView.style.display = 'none';
    classroomView.style.display = 'flex';
    loadClassroomsList();
    return;
  }

  content.style.display = 'flex';
  teacherView.style.display = 'none';
  classroomView.style.display = 'none';

  const now = new Date();
  const todayIndex = now.getDay(); // 0 - Вс, 1 - Пн ... 6 - Сб
  const todayName = DAY_MAP[todayIndex];

  let targetDayItems = [];

  if (state.activeView === 'today') {
    if (todayIndex === 0) {
      // Воскресенье — показываем расписание на понедельник следующей недели
      const monDate = new Date(now);
      monDate.setDate(now.getDate() + 1);
      targetDayItems.push({
        dayName: "Понедельник",
        isToday: false,
        targetDate: monDate,
        note: "Сегодня воскресенье • Показываем расписание на понедельник"
      });
    } else {
      targetDayItems.push({
        dayName: todayName,
        isToday: true,
        targetDate: now,
        note: null
      });
    }
  } else if (state.activeView === 'tomorrow') {
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(now.getDate() + 1);
    const tomorrowIndex = tomorrowDate.getDay();

    if (tomorrowIndex === 0) {
      // Завтра воскресенье — покажем понедельник
      const mondayDate = new Date(now);
      mondayDate.setDate(now.getDate() + 2);
      targetDayItems.push({
        dayName: "Понедельник",
        isToday: false,
        targetDate: mondayDate,
        note: "Завтра воскресенье • Показываем расписание на понедельник"
      });
    } else {
      targetDayItems.push({
        dayName: DAY_MAP[tomorrowIndex],
        isToday: false,
        targetDate: tomorrowDate,
        note: null
      });
    }
  } else {
    // Вся неделя
    for (const dName of DAYS_ORDER) {
      targetDayItems.push({
        dayName: dName,
        isToday: (dName === todayName && todayIndex !== 0),
        targetDate: now,
        note: null
      });
    }
  }

  let html = '';

  for (const item of targetDayItems) {
    const dayName = item.dayName;
    const isToday = item.isToday;
    const targetDate = item.targetDate;
    const dayParityInfo = calculateAcademicParity(targetDate);
    
    // Эффективная четность: если 'auto', то берем реальную четность даты этого дня
    const effectiveParity = (state.parityMode === 'auto') ? dayParityInfo.parity : state.parityMode;
    const parityBadgeText = (effectiveParity === 'num') ? 'Числитель (I)' : (effectiveParity === 'den' ? 'Знаменатель (II)' : 'Все недели');
    const parityBadgeClass = (effectiveParity === 'num') ? 'week-type-num' : (effectiveParity === 'den' ? 'week-type-den' : 'week-type-both');

    const pairs = state.scheduleData.days[dayName] || [];
    const dateStr = state.scheduleData.day_dates?.[dayName] || '';

    // Подсчет актуальных пар на этот день
    const activeLessons = pairs.filter(p => getActiveLessonForPair(p, effectiveParity) !== null);

    // Подсчет замен и отмен на этот день
    let replacementsCount = 0;
    for (const p of pairs) {
      const act = getActiveLessonForPair(p, effectiveParity);
      if (act) {
        if (act.lesson && (act.lesson.is_replacement || act.lesson.is_cancelled)) {
          replacementsCount++;
        } else if (act.isSplitAll) {
          if (act.numerator && (act.numerator.is_replacement || act.numerator.is_cancelled)) replacementsCount++;
          if (act.denominator && (act.denominator.is_replacement || act.denominator.is_cancelled)) replacementsCount++;
        }
      }
    }

    html += `
      <div class="day-card ${isToday ? 'today' : ''}">
        <div class="day-header">
          <div class="day-name-wrapper">
            <h3 class="day-name">${dayName}</h3>
            ${dateStr ? `<span class="day-date-badge">${dateStr}</span>` : ''}
            ${isToday ? `<span class="today-badge">СЕГОДНЯ</span>` : ''}
            <span class="week-type-badge ${parityBadgeClass}" style="margin-left: 4px;">${parityBadgeText}</span>
          </div>
          <div class="day-pairs-count">
            ${activeLessons.length} ${getNoun(activeLessons.length, 'пара', 'пары', 'пар')}
          </div>
        </div>

        ${item.note ? `
          <div style="padding: 8px 20px; background: rgba(99, 102, 241, 0.08); font-size: 0.82rem; color: var(--accent-primary); border-bottom: 1px solid var(--border-color);">
            ${item.note}
          </div>
        ` : ''}

        ${replacementsCount > 0 ? `
          <div class="day-replacement-alert" style="margin: 12px 20px 0 20px;">
            <span class="day-replacement-alert-icon">
              <svg class="svg-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </span>
            <div class="day-replacement-alert-text">
              Внимание! На ${dayName} ${dateStr} действуют замены и отмены занятий.
              <span class="day-replacement-alert-count">${replacementsCount} ${getNoun(replacementsCount, 'замена/отмена', 'замены/отмены', 'замен/отмен')}</span>
            </div>
          </div>
        ` : ''}

        <div class="pairs-list">
          ${renderPairsListWithBreaks(pairs, isToday, effectiveParity)}
        </div>
      </div>
    `;
  }

  content.innerHTML = html || `<div style="text-align: center; padding: 40px; color: var(--text-muted);">Нет занятий</div>`;
}

// Вспомогательная функция для склонения числительных
function getNoun(number, one, two, five) {
  let n = Math.abs(number);
  n %= 100;
  if (n >= 5 && n <= 20) return five;
  n %= 10;
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return two;
  return five;
}

// Определение активного занятия для пары с учетом недели
function getActiveLessonForPair(p, effectiveParity) {
  if (!p || p.is_empty) return null;
  if (p.both) {
    return { lesson: p.both, label: 'Каждую неделю', badgeClass: 'week-type-both' };
  }
  if (effectiveParity === 'num') {
    if (p.numerator) return { lesson: p.numerator, label: 'Числитель (I)', badgeClass: 'week-type-num' };
    return null;
  }
  if (effectiveParity === 'den') {
    if (p.denominator) return { lesson: p.denominator, label: 'Знаменатель (II)', badgeClass: 'week-type-den' };
    return null;
  }
  // 'all' - если обе недели
  if (p.numerator || p.denominator) {
    return { isSplitAll: true, numerator: p.numerator, denominator: p.denominator };
  }
  return null;
}

// Рендеринг списка пар с разделителями перемен
function renderPairsListWithBreaks(pairs, isToday, effectiveParity) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Собираем список активных пар
  const activePairsList = [];
  for (const p of pairs) {
    const active = getActiveLessonForPair(p, effectiveParity);
    if (active) {
      activePairsList.push({ pair: p, active: active });
    }
  }

  // Если включен режим "Только пары на день" и пар нет
  if (state.hideEmpty) {
    if (activePairsList.length === 0) {
      return `
        <div class="empty-day-banner" style="padding: 35px; text-align: center; color: var(--text-muted);">
          <div class="empty-day-icon" style="margin-bottom: 8px; color: var(--text-muted);">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <span style="font-weight: 600; font-size: 1.05rem;">В этот день занятий нет. Свободный день.</span>
        </div>
      `;
    }

    let rowsHtml = '';
    let prevPairNum = null;
    let prevPairEnd = null;

    for (let i = 0; i < activePairsList.length; i++) {
      const item = activePairsList[i];
      const p = item.pair;
      const active = item.active;
      const bell = BELL_TIMES.find(b => b.num === p.pair_num) || { sMin: 0, eMin: 0, start: p.start, end: p.end, display: p.time };
      const isCurrent = isToday && (nowMin >= bell.sMin && nowMin <= bell.eMin);

      // Если это не первая пара — вставляем плашку перемены
      if (prevPairNum !== null) {
        rowsHtml += renderBreakRow(prevPairNum, p.pair_num, prevPairEnd, bell.start, isToday, nowMin);
      }

      // Отрисовка самой пары
      if (active.isSplitAll) {
        rowsHtml += renderSplitPairRow(p, active, isCurrent);
      } else {
        rowsHtml += renderSinglePairRow(p, active.lesson, active.label, active.badgeClass, isCurrent);
      }

      prevPairNum = p.pair_num;
      prevPairEnd = bell.end;
    }

    return rowsHtml;
  }

  // Если режим "Все 6 слотов"
  let rowsHtml = '';
  for (let pairNum = 1; pairNum <= 6; pairNum++) {
    const p = pairs.find(x => x.pair_num === pairNum) || { pair_num: pairNum, time: BELL_TIMES[pairNum - 1]?.display, is_empty: true };
    const bell = BELL_TIMES.find(b => b.num === pairNum);
    const isCurrent = isToday && bell && (nowMin >= bell.sMin && nowMin <= bell.eMin);
    const active = getActiveLessonForPair(p, effectiveParity);

    if (pairNum > 1) {
      const prevBell = BELL_TIMES.find(b => b.num === pairNum - 1);
      rowsHtml += renderBreakRow(pairNum - 1, pairNum, prevBell?.end, bell?.start, isToday, nowMin);
    }

    if (!active) {
      rowsHtml += `
        <div class="pair-item is-empty">
          <div class="pair-time-col">
            <span class="pair-number">Пара ${p.pair_num}</span>
            <span class="pair-time-str">${p.time || bell?.display}</span>
          </div>
          <div class="pair-content-col">
            <span class="empty-pair-text">— Окно (нет пары) —</span>
          </div>
        </div>
      `;
    } else if (active.isSplitAll) {
      rowsHtml += renderSplitPairRow(p, active, isCurrent);
    } else {
      rowsHtml += renderSinglePairRow(p, active.lesson, active.label, active.badgeClass, isCurrent);
    }
  }

  return rowsHtml;
}

// Отрисовка строки перемены между парами
function renderBreakRow(afterPair, beforePair, startTime, endTime, isToday, nowMin) {
  const breakDef = BREAK_TIMES.find(b => b.afterPair === afterPair && b.beforePair === beforePair);

  let icon = "";
  let title = "Перемена 10 мин";
  let isBig = false;
  let isWindow = false;
  let sMin = 0;
  let eMin = 0;
  let durationStr = "10 мин";
  let timeStr = `${startTime} - ${endTime}`;

  if (breakDef) {
    icon = breakDef.icon;
    title = breakDef.title;
    isBig = breakDef.isBig;
    durationStr = `${breakDef.duration} мин`;
    sMin = breakDef.sMin;
    eMin = breakDef.eMin;
    timeStr = `${breakDef.start} - ${breakDef.end}`;
  } else {
    // Длительное окно между парами (например, пропущена 2-я пара)
    isWindow = true;
    icon = "";
    title = "Окно между парами (Свободное время)";
    
    // Рассчитаем длительность окна
    const pPrev = BELL_TIMES.find(b => b.num === afterPair);
    const pNext = BELL_TIMES.find(b => b.num === beforePair);
    if (pPrev && pNext) {
      sMin = pPrev.eMin;
      eMin = pNext.sMin;
      const diffMin = Math.max(0, eMin - sMin);
      const hours = Math.floor(diffMin / 60);
      const mins = diffMin % 60;
      durationStr = hours > 0 ? `${hours} ч ${mins} мин` : `${mins} мин`;
      timeStr = `${pPrev.end} - ${pNext.start}`;
    }
  }

  const isActive = isToday && (nowMin >= sMin && nowMin < eMin);

  return `
    <div class="break-divider ${isBig ? 'is-big' : ''} ${isWindow ? 'is-window' : ''} ${isActive ? 'is-active' : ''}">
      <div class="break-divider-left">
        <span class="break-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </span>
        <span class="break-title">${title}</span>
        <span class="break-duration-badge">${durationStr}</span>
        ${isActive ? '<span class="status-dot" style="margin-left: 4px;" title="Идёт сейчас"></span>' : ''}
      </div>
      <div class="break-divider-time">
        ${timeStr}
      </div>
    </div>
  `;
}

// Отрисовка обычной пары с поддержкой замен, отмен и дистанта
function renderSinglePairRow(pair, details, weekLabel, weekClass, isCurrent) {
  const isRep = details.is_replacement;
  const isCanc = details.is_cancelled;
  const isDist = details.is_distant;
  const repDate = details.date || '';
  // Если предмет не указан — показываем fallback
  const subjectText = details.subject || (isCanc ? 'Пара отменена' : (isRep ? 'Замена' : ''));

  let itemExtraClass = '';
  if (isCanc) itemExtraClass = 'is-cancelled';
  else if (isRep) itemExtraClass = 'is-replacement';
  else if (isDist) itemExtraClass = 'is-distant';

  return `
    <div class="pair-item ${itemExtraClass} ${isCurrent ? 'is-current' : ''}">
      <div class="pair-time-col">
        <span class="pair-number">Пара ${pair.pair_num}</span>
        <span class="pair-time-str">${pair.time}</span>
      </div>

      <div class="pair-content-col">
        ${isCanc || isRep || isDist ? `
        <div class="pair-status-bar">
          ${isCanc ? `<span class="badge-cancelled">ОТМЕНА ${repDate ? `[${escapeHtml(repDate)}]` : ''}</span>` : ''}
          ${isRep ? `<span class="badge-replacement">ЗАМЕНА ${repDate ? `[${escapeHtml(repDate)}]` : ''}</span>` : ''}
          ${isDist ? `<span class="badge-distant">ДИСТАНТ</span>` : ''}
          <span class="week-type-badge ${weekClass}" style="margin-left: auto;">${weekLabel}</span>
        </div>
        ` : `
        <div class="pair-status-bar" style="justify-content: flex-end;">
          <span class="week-type-badge ${weekClass}">${weekLabel}</span>
        </div>
        `}

        <div class="pair-subject">
          ${details.code ? `<span class="subject-code-tag">${escapeHtml(details.code)}</span>` : ''}
          <span class="subject-name ${isCanc ? 'text-cancelled' : ''}">${escapeHtml(subjectText)}</span>
        </div>

        <div class="pair-chips">
          ${details.teacher ? `
            <span class="meta-chip meta-chip-teacher" onclick="searchTeacher('${escapeAttr(details.teacher)}')" title="Расписание преподавателя">
              Преподаватель: ${escapeHtml(details.teacher)}
            </span>
          ` : ''}
          ${isCanc ? '' : (details.classroom ? `
            <span class="meta-chip meta-chip-room" onclick="searchClassroom('${escapeAttr(details.classroom)}')" title="Занятость аудитории">
              ${details.classroom.toLowerCase().includes('дистант') ? 'Дистант' : 'Ауд.'} ${escapeHtml(details.classroom)}
            </span>
          ` : '')}
        </div>

        ${isRep && details.cancelled_subject ? `
          <div class="replacement-card">
            <span class="replacement-label">Было:</span>
            <span class="replacement-old">${details.cancelled_code ? `[${escapeHtml(details.cancelled_code)}] ` : ''}${escapeHtml(details.cancelled_subject)}${details.cancelled_teacher ? ` (${escapeHtml(details.cancelled_teacher)})` : ''}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function renderSplitPairRow(pair, active, isCurrent) {
  return `
    <div class="pair-item split-parent ${isCurrent ? 'is-current' : ''}">
      <div class="pair-time-col">
        <span class="pair-number">Пара ${pair.pair_num}</span>
        <span class="pair-time-str">${pair.time}</span>
      </div>
      <div class="pair-content-col">
        <div class="split-pair-container">
          ${active.numerator ? renderSplitSubRow(active.numerator, 'I Числ.', 'week-type-num') : '<div class="split-sub-card empty-sub"><span class="week-type-badge week-type-num">I Числ.</span><span class="empty-pair-text" style="margin-left: 8px;">Нет пары</span></div>'}
          ${active.denominator ? renderSplitSubRow(active.denominator, 'II Знам.', 'week-type-den') : '<div class="split-sub-card empty-sub"><span class="week-type-badge week-type-den">II Знам.</span><span class="empty-pair-text" style="margin-left: 8px;">Нет пары</span></div>'}
        </div>
      </div>
    </div>
  `;
}

function renderSplitSubRow(item, label, labelClass) {
  const isRep = item.is_replacement;
  const isCanc = item.is_cancelled;
  const isDist = item.is_distant;
  const repDate = item.date || '';
  // Если предмет не указан — показываем fallback
  const subjectText = item.subject || (isCanc ? 'Пара отменена' : (isRep ? 'Замена' : ''));

  return `
    <div class="split-row ${isCanc ? 'is-cancelled' : ''} ${isRep ? 'is-replacement' : ''}">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 3px;">
          <span class="week-type-badge ${labelClass}">${label}</span>
          ${isCanc ? `<span class="badge-cancelled">ОТМЕНА ${repDate ? `[${escapeHtml(repDate)}]` : ''}</span>` : ''}
          ${isRep ? `<span class="badge-replacement">ЗАМЕНА ${repDate ? `[${escapeHtml(repDate)}]` : ''}</span>` : ''}
          ${isDist ? `<span class="badge-distant">ДИСТАНТ</span>` : ''}
          ${item.code ? `<span class="subject-code-tag">${escapeHtml(item.code)}</span>` : ''}
          <span class="subject-name ${isCanc ? 'text-cancelled' : ''}">${escapeHtml(subjectText)}</span>
        </div>
        ${isRep && item.cancelled_subject ? `
          <div class="replacement-origin" style="margin-top: 2px;">
            Было: <s>${item.cancelled_code ? `[${escapeHtml(item.cancelled_code)}] ` : ''}${escapeHtml(item.cancelled_subject)}${item.cancelled_teacher ? ` (${escapeHtml(item.cancelled_teacher)})` : ''}</s>
          </div>
        ` : ''}
        ${isCanc ? `
          <div class="cancelled-notice" style="margin-top: 2px;">Пара отменена</div>
        ` : ''}
        ${item.teacher ? `<span class="teacher-tag" onclick="searchTeacher('${escapeAttr(item.teacher)}')">Преподаватель: ${escapeHtml(item.teacher)}</span>` : ''}
      </div>
      ${isCanc ? '' : (item.classroom ? `<span class="classroom-badge" onclick="searchClassroom('${escapeAttr(item.classroom)}')">Ауд. ${escapeHtml(item.classroom)}</span>` : '')}
    </div>
  `;
}

// ==========================================================================
// Живой трекер текущей пары и перемен (Live Status)
// ==========================================================================

function updateLiveTracker() {
  const container = document.getElementById('liveLessonContainer');
  if (!container || !state.scheduleData) return;

  const now = new Date();
  const todayIndex = now.getDay();

  if (todayIndex === 0) {
    container.innerHTML = `
      <div class="live-lesson-card" style="border-color: var(--border-color);">
        <div class="live-left">
          <span class="live-badge" style="background: var(--accent-primary);">Выходной</span>
          <div>
            <div class="live-text">Сегодня воскресенье — занятий нет.</div>
            <div class="live-timer">Отличного отдыха перед новой учебной неделей!</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const todayName = DAY_MAP[todayIndex];
  const pairs = state.scheduleData.days[todayName] || [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const effectiveParity = state.parityMode === 'auto' ? state.currentParity : state.parityMode;

  const activeToday = [];
  for (const b of BELL_TIMES) {
    const pData = pairs.find(p => p.pair_num === b.num);
    let item = null;
    if (pData) {
      if (pData.both) {
        item = pData.both;
      } else if (effectiveParity === 'num') {
        item = pData.numerator;
      } else if (effectiveParity === 'den') {
        item = pData.denominator;
      } else {
        // 'all' — берём числитель если есть, иначе знаменатель
        item = pData.numerator || pData.denominator;
      }
    }
    if (item && (item.subject || item.is_cancelled)) {
      activeToday.push({ bell: b, item: item, pair_num: b.num });
    }
  }

  if (activeToday.length === 0) {
    container.innerHTML = `
      <div class="live-lesson-card" style="border-color: var(--border-color);">
        <div class="live-left">
          <span class="live-badge" style="background: var(--text-muted);">Свободный день</span>
          <div>
            <div class="live-text">На сегодня у группы ${escapeHtml(state.selectedGroup)} нет пар!</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  let currentLesson = null;
  for (const act of activeToday) {
    if (nowMin >= act.bell.sMin && nowMin <= act.bell.eMin) {
      currentLesson = act;
      break;
    }
  }

  if (currentLesson) {
    const leftMin = currentLesson.bell.eMin - nowMin;
    const totalDuration = currentLesson.bell.eMin - currentLesson.bell.sMin;
    const elapsed = nowMin - currentLesson.bell.sMin;
    const percent = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));

    if (currentLesson.item.is_cancelled) {

      container.innerHTML = `
        <div class="live-lesson-card" style="border-left: 4px solid #ef4444; background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(30, 41, 59, 0.8) 100%);">
          <div style="width: 100%;">
            <div class="live-left" style="justify-content: space-between;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span class="live-badge" style="background: #ef4444;">ОТМЕНА ПАРЫ</span>
                <span class="live-text" style="text-decoration: line-through; opacity: 0.85;">
                  ${escapeHtml(currentLesson.item.subject || 'Пара отменена')}
                </span>
              </div>
              <div class="live-timer" style="font-weight: 700; color: #ef4444;">
                Свободное время: <b>${leftMin} мин</b> (до ${currentLesson.bell.end})
              </div>
            </div>
            <div style="font-size: 0.82rem; color: #f87171; margin-top: 4px;">
              Занятие отменено колледжем. Аудитория свободна.
            </div>
          </div>
        </div>
      `;
      return;
    }

    const badgeText = currentLesson.item.is_replacement ? `ЗАМЕНА • ${currentLesson.pair_num} ПАРА` : `ИДЁТ ${currentLesson.pair_num} ПАРА`;
    const badgeBg = currentLesson.item.is_replacement ? 'background: #f59e0b;' : '';

    container.innerHTML = `
      <div class="live-lesson-card" ${currentLesson.item.is_replacement ? 'style="border-left: 4px solid #f59e0b;"' : ''}>
        <div style="width: 100%;">
          <div class="live-left" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="live-badge" ${badgeBg ? `style="${badgeBg}"` : ''}>${badgeText}</span>
              <span class="live-text">
                ${escapeHtml(currentLesson.item.subject)}
                ${currentLesson.item.classroom ? `<b>[каб. ${currentLesson.item.classroom}]</b>` : ''}
              </span>
            </div>
            <div class="live-timer" style="font-weight: 700; color: var(--success);">
              До конца: <b>${leftMin} мин</b> (до ${currentLesson.bell.end})
            </div>
          </div>
          ${currentLesson.item.cancelled_subject ? `
            <div style="font-size: 0.8rem; color: #f87171; margin-top: 3px;">
              Было: <s>${escapeHtml(currentLesson.item.cancelled_subject)}</s>
            </div>
          ` : ''}
          ${currentLesson.item.teacher ? `
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px;">
              Преподаватель: ${escapeHtml(currentLesson.item.teacher)}
            </div>
          ` : ''}
          <div class="live-progress-container">
            <div class="live-progress-bar" style="width: ${percent}%;"></div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // 2. Проверяем, идет ли сейчас перемена
  let currentBreak = null;
  let nextLesson = null;

  for (const b of BREAK_TIMES) {
    if (nowMin >= b.sMin && nowMin < b.eMin) {
      // Идет перемена, проверим, есть ли следующая пара у студента
      const nxt = activeToday.find(a => a.pair_num === b.beforePair || a.pair_num > b.afterPair);
      if (nxt) {
        currentBreak = b;
        nextLesson = nxt;
        break;
      }
    }
  }

  // Проверим также свободные окна между парами
  if (!currentBreak) {
    for (let i = 0; i < activeToday.length - 1; i++) {
      const prevL = activeToday[i];
      const nextL = activeToday[i + 1];
      if (nowMin >= prevL.bell.eMin && nowMin < nextL.bell.sMin) {
        currentBreak = {
          title: "Перерыв между парами",
          icon: "",
          sMin: prevL.bell.eMin,
          eMin: nextL.bell.sMin,
          duration: nextL.bell.sMin - prevL.bell.eMin,
          start: prevL.bell.end,
          end: nextL.bell.start,
        };
        nextLesson = nextL;
        break;
      }
    }
  }

  if (currentBreak && nextLesson) {
    const leftMin = nextLesson.bell.sMin - nowMin;
    const totalBreakMin = Math.max(1, currentBreak.eMin - currentBreak.sMin);
    const elapsedBreak = Math.max(0, nowMin - currentBreak.sMin);
    const percent = Math.min(100, Math.max(0, Math.round((elapsedBreak / totalBreakMin) * 100)));

    const nextIsRep = nextLesson.item.is_replacement;
    const nextIsCanc = nextLesson.item.is_cancelled;
    const nextStatusTag = nextIsCanc ? '<span class="badge-cancelled" style="margin-left: 4px;">ПАРА ОТМЕНЕНА</span>' : (nextIsRep ? '<span class="badge-replacement" style="margin-left: 4px;">ЗАМЕНА</span>' : '');

    container.innerHTML = `
      <div class="live-lesson-card" style="border-color: rgba(245, 158, 11, 0.6); background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(99, 102, 241, 0.12) 100%);">
        <div style="width: 100%;">
          <div class="live-left" style="justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="live-badge" style="background: var(--warning);">СЕЙЧАС ПЕРЕМЕНА</span>
              <span class="live-text">
                Следующая: Пара ${nextLesson.pair_num} (${nextLesson.bell.start}) — <b>${escapeHtml(nextLesson.item.subject)}</b>
                ${nextStatusTag}
              </span>
            </div>
            <div class="live-timer" style="font-weight: 700; color: var(--warning);">
              До звонка: <b>${leftMin} мин</b>
            </div>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; display: flex; justify-content: space-between;">
            <span>Кабинет: <b>${escapeHtml(nextLesson.item.classroom || (nextIsCanc ? 'Отменена' : 'Не указан'))}</b> ${nextLesson.item.teacher ? `• Преподаватель: ${escapeHtml(nextLesson.item.teacher)}` : ''}</span>
            <span>Перемена: ${currentBreak.start} - ${currentBreak.end}</span>
          </div>
          <div class="live-progress-container">
            <div class="live-progress-bar" style="width: ${percent}%; background: linear-gradient(90deg, #f59e0b, #6366f1);"></div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // 3. До начала первой пары дня
  const firstLesson = activeToday[0];
  if (nowMin < firstLesson.bell.sMin) {
    const untilMin = firstLesson.bell.sMin - nowMin;
    const hours = Math.floor(untilMin / 60);
    const mins = untilMin % 60;
    const timeUntilStr = hours > 0 ? `${hours} ч ${mins} мин` : `${mins} мин`;

    const isRep = firstLesson.item.is_replacement;
    const isCanc = firstLesson.item.is_cancelled;
    const firstStatusBadge = isCanc ? '<span class="badge-cancelled" style="margin-left: 6px;">ОТМЕНА</span>' : (isRep ? '<span class="badge-replacement" style="margin-left: 6px;">ЗАМЕНА</span>' : '');

    container.innerHTML = `
      <div class="live-lesson-card" style="border-color: rgba(99, 102, 241, 0.5);">
        <div class="live-left">
          <span class="live-badge" style="background: var(--accent-primary);">СКОРО</span>
          <div>
            <div class="live-text">
              1-я пара начнется в <b>${firstLesson.bell.start}</b>: <span class="${isCanc ? 'text-cancelled' : ''}">${escapeHtml(firstLesson.item.subject)}</span>
              ${firstLesson.item.classroom ? `<b>[каб. ${escapeHtml(firstLesson.item.classroom)}]</b>` : ''}
              ${firstStatusBadge}
            </div>
            <div class="live-timer">До начала занятий: <b>${timeUntilStr}</b></div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // 4. Пары на сегодня закончились
  const lastLesson = activeToday[activeToday.length - 1];
  if (nowMin > lastLesson.bell.eMin) {
    container.innerHTML = `
      <div class="live-lesson-card" style="border-color: var(--border-color);">
        <div class="live-left">
          <span class="live-badge" style="background: var(--text-muted);">ЗАВЕРШЕНО</span>
          <div>
            <div class="live-text">Все учебные пары на сегодня окончены.</div>
            <div class="live-timer">Отличного отдыха перед завтрашним днем.</div>
          </div>
        </div>
      </div>
    `;
  }
}

// Запускаем обновление таймера раз в 10 секунд
setInterval(updateLiveTracker, 10000);

// ==========================================================================
// Модальное окно групп и поиск
// ==========================================================================

function openGroupModal() {
  document.getElementById('groupModal').classList.add('open');
  document.getElementById('groupSearchInput').value = '';
  document.getElementById('groupSearchInput').focus();
  renderGroupsGrid();
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('open');
}

function selectGroup(groupName) {
  state.selectedGroup = groupName;
  closeGroupModal();
  loadScheduleForGroup(groupName);
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
}

function renderGroupsGrid() {
  const container = document.getElementById('groupsGrid');
  const search = document.getElementById('groupSearchInput').value.trim().toLowerCase();
  const filter = state.currentCourseFilter;

  const filtered = state.allGroups.filter(g => {
    const matchesSearch = !search || g.name.toLowerCase().includes(search) || g.section.toLowerCase().includes(search);
    const matchesCourse = (filter === 'all') || (g.course === filter);
    return matchesSearch && matchesCourse;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">Группы не найдены</div>`;
    return;
  }

  container.innerHTML = filtered.map(g => `
    <div class="group-card-select ${g.name === state.selectedGroup ? 'selected' : ''}" onclick="selectGroup('${escapeAttr(g.name)}')">
      <div class="group-card-name">${escapeHtml(g.name)}</div>
      <div class="group-card-course">${escapeHtml(g.course)}</div>
    </div>
  `).join('');
}

// ==========================================================================
// Избранные группы
// ==========================================================================

function toggleFavorite() {
  if (!state.selectedGroup) return;
  const idx = state.favorites.indexOf(state.selectedGroup);
  if (idx >= 0) {
    state.favorites.splice(idx, 1);
  } else {
    state.favorites.push(state.selectedGroup);
  }
  localStorage.setItem('college_favorites', JSON.stringify(state.favorites));
  updateFavButton();
  renderQuickFavorites();
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function updateFavButton() {
  const btn = document.getElementById('favToggleBtn');
  const favText = document.getElementById('favBtnText');
  const favIcon = btn ? btn.querySelector('.fav-icon') : null;
  if (!btn || !state.selectedGroup) return;

  const isFav = state.favorites.includes(state.selectedGroup);
  if (favText) {
    favText.textContent = isFav ? 'В избранном' : 'В избранное';
  }
  if (isFav) {
    btn.classList.add('active');
    btn.style.borderColor = 'var(--accent-primary)';
    btn.style.color = 'var(--accent-primary)';
    if (favIcon) favIcon.setAttribute('fill', 'currentColor');
  } else {
    btn.classList.remove('active');
    btn.style.borderColor = '';
    btn.style.color = '';
    if (favIcon) favIcon.setAttribute('fill', 'none');
  }
}

function renderQuickFavorites() {
  const container = document.getElementById('quickFavorites');
  if (!container) return;
  if (state.favorites.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = state.favorites.map(g => `
    <span class="quick-fav-chip ${g === state.selectedGroup ? 'active' : ''}" onclick="selectGroup('${escapeAttr(g)}')">
      ${escapeHtml(g)}
    </span>
  `).join('');
}

// ==========================================================================
// Поиск преподавателей и аудиторий
// ==========================================================================

async function loadTeachersList(forceRefresh = false) {
  if (!forceRefresh && state.teachers.length > 0) return;
  try {
    const res = await fetch('/api/teachers');
    const data = await res.json();
    state.teachers = data.teachers || [];
    renderTeacherAutocomplete();
  } catch (err) {
    console.error('Ошибка загрузки преподавателей:', err);
  }
}

function renderTeacherAutocomplete() {
  const input = document.getElementById('teacherSearchInput');
  if (!input || !state.teachers.length) return;
  // Инпут сам подсказывает из list
  let dl = document.getElementById('teacherDatalist');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'teacherDatalist';
    input.setAttribute('list', 'teacherDatalist');
    input.parentNode.appendChild(dl);
  }
  dl.innerHTML = state.teachers.map(t => `<option value="${escapeAttr(t)}"></option>`).join('');
}

async function loadClassroomsList(forceRefresh = false) {
  if (!forceRefresh && state.classrooms.length > 0) return;
  try {
    const res = await fetch('/api/classrooms');
    const data = await res.json();
    state.classrooms = data.classrooms || [];
    renderClassroomAutocomplete();
  } catch (err) {
    console.error('Ошибка загрузки аудиторий:', err);
  }
}

function renderClassroomAutocomplete() {
  const input = document.getElementById('classroomSearchInput');
  if (!input || !state.classrooms.length) return;
  let dl = document.getElementById('classroomDatalist');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'classroomDatalist';
    input.setAttribute('list', 'classroomDatalist');
    input.parentNode.appendChild(dl);
  }
  dl.innerHTML = state.classrooms.map(r => `<option value="${escapeAttr(r)}"></option>`).join('');
}

async function searchTeacher(teacherName) {
  switchView('teacher');
  document.getElementById('teacherSearchInput').value = teacherName;

  const resultContainer = document.getElementById('teacherScheduleResult');
  resultContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Поиск...</div>`;

  try {
    const res = await fetch(`/api/teacher-schedule?teacher=${encodeURIComponent(teacherName)}`);
    if (!res.ok) throw new Error('Преподаватель не найден');
    const data = await res.json();

    let html = '';
    for (const d of DAYS_ORDER) {
      const lessons = data.days[d] || [];
      if (lessons.length === 0) continue;

      html += `
        <div class="day-card">
          <div class="day-header">
            <h4 class="day-name">${d}</h4>
            <span class="day-pairs-count">${lessons.length} пар</span>
          </div>
          <div class="pairs-list">
            ${lessons.map(l => `
              <div class="pair-item">
                <div class="pair-time-col">
                  <span class="pair-number">Пара ${l.pair_num}</span>
                  <span class="pair-time-str">${l.time}</span>
                </div>
                <div class="pair-content-col">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    ${l.is_replacement ? '<span class="badge-replacement">ЗАМЕНА</span>' : ''}
                    <span class="subject-name">${escapeHtml(l.subject)}</span>
                  </div>
                  <div class="pair-meta">
                    <span class="teacher-tag" onclick="selectGroup('${escapeAttr(l.group)}')">Группа: <b>${escapeHtml(l.group)}</b></span>
                    <span class="week-type-badge week-type-both">${l.week}</span>
                  </div>
                </div>
                <div class="pair-action-col">
                  ${l.classroom ? `<span class="classroom-badge">Ауд. ${escapeHtml(l.classroom)}</span>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    resultContainer.innerHTML = html || `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Пар не найдено</div>`;
  } catch (err) {
    resultContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Преподаватель не найден</div>`;
  }
}

async function searchClassroom(roomName) {
  switchView('classroom');
  document.getElementById('classroomSearchInput').value = roomName;

  const resultContainer = document.getElementById('classroomScheduleResult');
  resultContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Поиск...</div>`;

  try {
    const res = await fetch(`/api/classroom-schedule?room=${encodeURIComponent(roomName)}`);
    if (!res.ok) throw new Error('Аудитория не найдена');
    const data = await res.json();

    let html = '';
    for (const d of DAYS_ORDER) {
      const lessons = data.days[d] || [];
      if (lessons.length === 0) continue;

      html += `
        <div class="day-card">
          <div class="day-header">
            <h4 class="day-name">${d}</h4>
            <span class="day-pairs-count">${lessons.length} занятий</span>
          </div>
          <div class="pairs-list">
            ${lessons.map(l => `
              <div class="pair-item ${l.is_replacement ? 'is-replacement' : ''}">
                <div class="pair-time-col">
                  <span class="pair-number">Пара ${l.pair_num}</span>
                  <span class="pair-time-str">${l.time}</span>
                </div>
                <div class="pair-content-col">
                  <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    ${l.is_replacement ? '<span class="badge-replacement">ЗАМЕНА</span>' : ''}
                    <span class="subject-name">${escapeHtml(l.subject)}</span>
                  </div>
                  <div class="pair-meta">
                    <span class="teacher-tag" onclick="selectGroup('${escapeAttr(l.group)}')">Группа: <b>${escapeHtml(l.group)}</b></span>
                    ${l.teacher ? `<span class="teacher-tag">Преподаватель: <b>${escapeHtml(l.teacher)}</b></span>` : ''}
                  </div>
                </div>
                <div class="pair-action-col">
                  <span class="week-type-badge week-type-both">${l.week}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    resultContainer.innerHTML = html || `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Занятость не найдена</div>`;
  } catch (err) {
    resultContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">Аудитория не найдена</div>`;
  }
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === viewName);
  });
  renderCurrentView();
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
}

// ==========================================================================
// Утилиты
// ==========================================================================

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================================================
// Привязка обработчиков событий
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  updateParityUI();
  fetchStatus();
  fetchGroups();

  // Кнопки смены группы
  document.getElementById('openGroupModalBtn').addEventListener('click', openGroupModal);
  document.getElementById('closeGroupModalBtn').addEventListener('click', closeGroupModal);
  document.getElementById('groupModal').addEventListener('click', (e) => {
    if (e.target.id === 'groupModal') closeGroupModal();
  });

  // Поиск в модалке
  document.getElementById('groupSearchInput').addEventListener('input', renderGroupsGrid);

  // Фильтр курсов в модалке
  document.getElementById('courseFilterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.currentCourseFilter = chip.dataset.filter;
    renderGroupsGrid();
  });

  // Вкладки расписания
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Мобильная нижняя навигация
  document.querySelectorAll('.bottom-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === 'group') {
        openGroupModal();
      } else {
        switchView(nav);
      }
    });
  });

  // Переключатель числителя / знаменателя
  document.getElementById('parityControls').addEventListener('click', (e) => {
    const btn = e.target.closest('.parity-btn');
    if (!btn) return;
    document.querySelectorAll('.parity-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.parityMode = btn.dataset.parity;
    renderCurrentView();
    updateLiveTracker();
  });

  // Кнопка избранного
  document.getElementById('favToggleBtn').addEventListener('click', toggleFavorite);

  // Кнопка принудительного обновления
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('is-refreshing');
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = await res.json();
      // Сбрасываем кэши преподавателей и аудиторий
      state.teachers = [];
      state.classrooms = [];
      await fetchStatus();
      if (state.selectedGroup) {
        await loadScheduleForGroup(state.selectedGroup);
      }
      showToast('Расписание успешно обновлено из Google Sheets!');
    } catch (err) {
      showToast('Ошибка при обновлении — проверьте соединение');
    } finally {
      btn.classList.remove('is-refreshing');
    }
  });

  // Функция обновления UI переключателя темы
  function updateThemeUI(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('college_theme', theme);
    const sunIcon = document.querySelector('.theme-sun-icon');
    const moonIcon = document.querySelector('.theme-moon-icon');
    const textSpan = document.getElementById('themeBtnText');
    if (theme === 'dark') {
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
      if (textSpan) textSpan.textContent = 'Светлая';
    } else {
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
      if (textSpan) textSpan.textContent = 'Тёмная';
    }
  }

  const savedTheme = localStorage.getItem('college_theme') || 'dark';
  updateThemeUI(savedTheme);

  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      updateThemeUI(newTheme);
      if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    });
  }

  // Поиск преподавателей — Enter + кнопка
  const teacherInput = document.getElementById('teacherSearchInput');
  teacherInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) searchTeacher(val);
    }
  });
  // Кнопка поиска преподавателя
  const teacherSearchBtn = document.getElementById('teacherSearchBtn');
  if (teacherSearchBtn) {
    teacherSearchBtn.addEventListener('click', () => {
      const val = teacherInput.value.trim();
      if (val) searchTeacher(val);
    });
  }

  // Поиск аудиторий — Enter + кнопка
  const classroomInput = document.getElementById('classroomSearchInput');
  classroomInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) searchClassroom(val);
    }
  });
  // Кнопка поиска аудитории
  const classroomSearchBtn = document.getElementById('classroomSearchBtn');
  if (classroomSearchBtn) {
    classroomSearchBtn.addEventListener('click', () => {
      const val = classroomInput.value.trim();
      if (val) searchClassroom(val);
    });
  }

  // Кнопка переключения "Только пары на день" / "Показать окна"
  const togglePairsBtn = document.getElementById('toggleOnlyPairsBtn');
  if (togglePairsBtn) {
    togglePairsBtn.addEventListener('click', () => {
      state.hideEmpty = !state.hideEmpty;
      togglePairsBtn.classList.toggle('active', state.hideEmpty);
      togglePairsBtn.textContent = state.hideEmpty ? 'Только пары на день' : 'Все 6 слотов с окнами';
      renderCurrentView();
      if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    });
  }

  // Запуск постоянного автообновления данных (каждые 10 секунд опрос сервера)
  setInterval(checkLiveUpdates, 10000);

  // Мгновенная проверка при возврате пользователя на вкладку браузера
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkLiveUpdates();
      updateLiveTracker();
    }
  });
  window.addEventListener('focus', () => {
    checkLiveUpdates();
    updateLiveTracker();
  });
});
