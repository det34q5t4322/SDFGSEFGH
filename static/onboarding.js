/**
 * Модуль интерактивного онбординга (обучающего тура) для сайта расписания колледжа.
 * Чистый JS без внешних зависимостей.
 * Адаптирован под мобильные экраны (360-420px) и Telegram WebApp.
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'onboarding_completed';

  const STEPS = [
    {
      id: 'group',
      title: '👥 Ваша группа',
      body: 'Здесь отображается ваша текущая учебная группа. Нажмите прямо на название группы или откройте боковое меню (кнопка ☰), чтобы выбрать любую другую группу колледжа.',
      getTarget: () => document.querySelector('.topbar-title') || document.getElementById('topbarGroupName'),
      preferredPosition: 'bottom'
    },
    {
      id: 'calendar',
      title: '📅 Дни, недели и жесты',
      body: 'Переключайтесь между днями недели в один клик или <b>свайпами влево/вправо</b> прямо по расписанию! Стрелками <b>◀ ▶</b> можно листать недели. Текущий день и числитель/знаменатель определяются автоматически!',
      getTarget: () => document.getElementById('dayStripWrap') || document.getElementById('weekNavWrap'),
      preferredPosition: 'bottom'
    },
    {
      id: 'badges',
      title: '⚡ Метки «Замена» и «Отмена»',
      body: `Актуальные изменения выделяются наглядными метками:<br>
        <div class="onboarding-badges-demo">
          <span class="onboarding-demo-badge badge-swap">⇄ Замена</span>
          <span class="onboarding-demo-badge badge-cancel">✕ Отмена</span>
        </div>
        • <b>Замена</b> — пара перенесена или заменён преподаватель/аудитория.<br>
        • <b>Отмена</b> — пары не будет.<br>
        <span class="onboarding-note">Расписание регулярно обновляется из официального источника колледжа.</span>`,
      getTarget: () => {
        const firstCard = document.querySelector('#scheduleView .pair-card');
        return firstCard || document.getElementById('scheduleView');
      },
      preferredPosition: 'top'
    },
    {
      id: 'themes',
      title: '🎨 Оформление и темы',
      body: 'В боковом меню (кнопка ☰) доступен раздел <b>«Оформление и темы»</b>: выбирайте темы по вкусу (тёмные, светлые, киберпанк), настраивайте шрифт или включайте <b>«Минимальный режим»</b> без лишних рамок.',
      getTarget: () => document.getElementById('menuBtn'),
      preferredPosition: 'bottom'
    },
    {
      id: 'constructor',
      title: '🛠 Конструктор интерфейса',
      body: 'Настройте интерфейс под себя! В боковом меню выберите <b>«Конструктор интерфейса»</b>: можно менять порядок блоков на экране (перетаскиванием за иконку ⠿), скрывать ненужные виджеты и настраивать карточки пар.',
      getTarget: () => document.getElementById('menuBtn'),
      preferredPosition: 'bottom'
    }
  ];

  let activeStep = 0;
  let isRunning = false;
  let overlayEl = null;
  let spotlightEl = null;
  let cardEl = null;
  let resizeTimer = null;

  function shouldAutoStart() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') return false;
    } catch (_) {
      return false;
    }

    // Не запускаем, если включен режим редактирования конструктора
    if (document.body.classList.contains('layout-editing-active')) return false;

    // Не запускаем поверх активных модальных окон
    const modalBackdrop = document.querySelector('.modal-backdrop.active, .modal-backdrop.show');
    if (modalBackdrop) return false;

    return true;
  }

  function createDom() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'onboardingOverlay';
    overlayEl.className = 'onboarding-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-label', 'Обучение по интерфейсу');

    spotlightEl = document.createElement('div');
    spotlightEl.id = 'onboardingSpotlight';
    spotlightEl.className = 'onboarding-spotlight';

    cardEl = document.createElement('div');
    cardEl.id = 'onboardingCard';
    cardEl.className = 'onboarding-card';

    overlayEl.appendChild(spotlightEl);
    overlayEl.appendChild(cardEl);
    document.body.appendChild(overlayEl);

    // Закрытие по клавише Escape
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, { passive: true });
  }

  function onKeyDown(e) {
    if (!isRunning) return;
    if (e.key === 'Escape') {
      stop(true);
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      next();
    } else if (e.key === 'ArrowLeft') {
      prev();
    }
  }

  function onViewportChange() {
    if (!isRunning) return;
    if (resizeTimer) cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(() => {
      reposition();
    });
  }

  function renderCard() {
    if (!cardEl) return;
    const step = STEPS[activeStep];
    const total = STEPS.length;
    const isLast = activeStep === total - 1;
    const isFirst = activeStep === 0;

    let dotsHtml = '';
    for (let i = 0; i < total; i++) {
      dotsHtml += `<span class="onboarding-dot ${i === activeStep ? 'active' : (i < activeStep ? 'completed' : '')}"></span>`;
    }

    cardEl.innerHTML = `
      <div class="onboarding-card-header">
        <div class="onboarding-step-badge">Шаг ${activeStep + 1} из ${total}</div>
        <button type="button" class="onboarding-btn-close" id="onboardingCloseBtn" aria-label="Закрыть обучение">✕</button>
      </div>

      <div class="onboarding-card-content">
        <h3 class="onboarding-step-title">${step.title}</h3>
        <div class="onboarding-step-desc">${step.body}</div>
      </div>

      <div class="onboarding-card-footer">
        <div class="onboarding-dots-row">${dotsHtml}</div>
        <div class="onboarding-actions-row">
          <button type="button" class="onboarding-btn onboarding-btn-skip" id="onboardingSkipBtn">Пропустить</button>
          <div class="onboarding-actions-nav">
            ${!isFirst ? '<button type="button" class="onboarding-btn onboarding-btn-prev" id="onboardingPrevBtn">◀ Назад</button>' : ''}
            <button type="button" class="onboarding-btn onboarding-btn-next ${isLast ? 'onboarding-btn-finish' : ''}" id="onboardingNextBtn">
              ${isLast ? 'Завершить 🎉' : 'Далее →'}
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('onboardingCloseBtn')?.addEventListener('click', () => stop(true));
    document.getElementById('onboardingSkipBtn')?.addEventListener('click', () => stop(true));
    document.getElementById('onboardingPrevBtn')?.addEventListener('click', prev);
    document.getElementById('onboardingNextBtn')?.addEventListener('click', next);
  }

  function reposition() {
    if (!isRunning || !overlayEl || !spotlightEl || !cardEl) return;

    const step = STEPS[activeStep];
    const targetEl = step.getTarget ? step.getTarget() : null;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    if (!targetEl || targetEl.offsetParent === null) {
      spotlightEl.style.display = 'none';
      cardEl.style.top = '50%';
      cardEl.style.left = '50%';
      cardEl.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    const sTop = Math.max(0, rect.top - pad);
    const sLeft = Math.max(0, rect.left - pad);
    const sWidth = Math.min(screenW, rect.width + pad * 2);
    const sHeight = Math.min(screenH, rect.height + pad * 2);

    spotlightEl.style.display = 'block';
    spotlightEl.style.top = `${Math.round(sTop)}px`;
    spotlightEl.style.left = `${Math.round(sLeft)}px`;
    spotlightEl.style.width = `${Math.round(sWidth)}px`;
    spotlightEl.style.height = `${Math.round(sHeight)}px`;

    cardEl.style.transform = 'none';
    const cardRect = cardEl.getBoundingClientRect();
    const cardW = cardRect.width || 340;
    const cardH = cardRect.height || 220;

    const spaceAbove = sTop - 12;
    const spaceBelow = screenH - (sTop + sHeight + 12);

    let topPos;
    if (step.preferredPosition === 'top') {
      if (spaceAbove >= cardH || spaceAbove >= spaceBelow) {
        topPos = Math.max(12, sTop - cardH - 12);
      } else {
        topPos = Math.min(screenH - cardH - 12, sTop + sHeight + 12);
      }
    } else {
      if (spaceBelow >= cardH || spaceBelow >= spaceAbove) {
        topPos = Math.min(screenH - cardH - 12, sTop + sHeight + 12);
      } else {
        topPos = Math.max(12, sTop - cardH - 12);
      }
    }

    let leftPos = sLeft + (sWidth / 2) - (cardW / 2);
    const margin = 12;
    leftPos = Math.max(margin, Math.min(screenW - cardW - margin, leftPos));

    cardEl.style.top = `${Math.round(topPos)}px`;
    cardEl.style.left = `${Math.round(leftPos)}px`;
  }

  function showStep(index) {
    if (index < 0 || index >= STEPS.length) return;
    activeStep = index;

    const step = STEPS[activeStep];
    const targetEl = step.getTarget ? step.getTarget() : null;

    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      try {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } catch (_) {}
    }

    renderCard();

    setTimeout(() => {
      reposition();
    }, 120);
  }

  function start(force = false) {
    if (isRunning) return;
    if (!force && !shouldAutoStart()) return;

    createDom();

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');

    const scheduleView = document.getElementById('scheduleView');
    const teacherView = document.getElementById('teacherView');
    const classroomView = document.getElementById('classroomView');
    const statsView = document.getElementById('statsView');
    const englishView = document.getElementById('englishView');

    if (scheduleView) scheduleView.style.display = 'block';
    if (teacherView) teacherView.style.display = 'none';
    if (classroomView) classroomView.style.display = 'none';
    if (statsView) statsView.style.display = 'none';
    if (englishView) englishView.style.display = 'none';

    isRunning = true;
    overlayEl.classList.add('active');
    document.body.classList.add('onboarding-running');

    showStep(0);
  }

  function next() {
    if (!isRunning) return;
    if (activeStep < STEPS.length - 1) {
      showStep(activeStep + 1);
    } else {
      stop(false);
    }
  }

  function prev() {
    if (!isRunning) return;
    if (activeStep > 0) {
      showStep(activeStep - 1);
    }
  }

  function stop(skipped = false) {
    if (!isRunning) return;
    isRunning = false;

    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch (_) {}

    if (overlayEl) {
      overlayEl.classList.remove('active');
    }
    document.body.classList.remove('onboarding-running');
  }

  window.Onboarding = {
    start: start,
    next: next,
    prev: prev,
    stop: stop,
    shouldAutoStart: shouldAutoStart,
    get isRunning() { return isRunning; },
    get currentStep() { return activeStep; }
  };

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (shouldAutoStart()) {
        start();
      }
    }, 1000);
  });

})();
