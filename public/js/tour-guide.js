/**
 * MOCD MUSIC / Santa Chela - Interactive Onboarding Tour Engine (v2)
 * Guía interactiva paso a paso con SVG Cutout Mask (agujero 100% transparente),
 * marco de neón animado con resplandor cyan-púrpura, tooltip con muesca/flecha y persistencia LocalStorage.
 * Soporta modo Administrador/DJ y modo Cliente en mesas.
 */

(function (window, document) {
  'use strict';

  class OnboardingTour {
    constructor(options = {}) {
      this.storageKey = options.storageKey || 'mocd_tour_completed_v2';
      this.steps = options.steps || [];
      this.currentStep = 0;
      this.active = false;
      this.svgEl = null;
      this.maskHoleEl = null;
      this.spotlightEl = null;
      this.popoverEl = null;
      this.notchEl = null;
      this.lastTargetEl = null;
      this.onComplete = options.onComplete || null;
      this.autoStartDelay = options.autoStartDelay || 1200;

      this.handleKeyDown = this.handleKeyDown.bind(this);
      this.handleResize = this.handleResize.bind(this);
    }

    init() {
      const hasCompleted = localStorage.getItem(this.storageKey);
      if (!hasCompleted && this.steps.length > 0) {
        setTimeout(() => {
          this.start(false);
        }, this.autoStartDelay);
      }
    }

    start(force = false) {
      if (this.active) return;
      if (!force && localStorage.getItem(this.storageKey)) return;

      this.currentStep = 0;
      this.active = true;
      window.mocdCurrentTour = this;
      this.createDom();
      this.showStep(this.currentStep);

      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('resize', this.handleResize);
      window.addEventListener('scroll', this.handleResize, true);
    }

    createDom() {
      this.destroyDom();

      // 1. Inyectar Estilos Globales del Tour
      if (!document.getElementById('mocdTourStyles')) {
        const style = document.createElement('style');
        style.id = 'mocdTourStyles';
        style.innerHTML = `
          .mocd-tour-svg {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            z-index: 999980;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.35s ease;
          }
          .mocd-tour-svg.visible {
            opacity: 1;
          }
          .mocd-tour-backdrop {
            pointer-events: auto;
            fill: rgba(3, 7, 18, 0.84);
          }
          #mocdMaskHole {
            transition: x 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                        y 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                        width 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                        height 0.35s cubic-bezier(0.16, 1, 0.3, 1),
                        rx 0.35s ease,
                        ry 0.35s ease;
          }
          .mocd-tour-spotlight {
            position: fixed;
            z-index: 999988;
            border-radius: 16px;
            border: 2.5px solid #00e5ff;
            background: transparent;
            box-shadow: 0 0 25px rgba(0, 229, 255, 0.7), 0 0 50px rgba(139, 92, 246, 0.35), inset 0 0 10px rgba(0, 229, 255, 0.2);
            pointer-events: none;
            transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            animation: mocdSpotlightGlow 2.5s infinite alternate ease-in-out;
          }
          @keyframes mocdSpotlightGlow {
            0% {
              border-color: #00e5ff;
              box-shadow: 0 0 20px rgba(0, 229, 255, 0.75), 0 0 45px rgba(0, 229, 255, 0.3), inset 0 0 10px rgba(0, 229, 255, 0.2);
            }
            100% {
              border-color: #c084fc;
              box-shadow: 0 0 28px rgba(192, 132, 252, 0.85), 0 0 55px rgba(168, 85, 247, 0.4), inset 0 0 14px rgba(168, 85, 247, 0.25);
            }
          }
          .mocd-tour-target-active {
            filter: drop-shadow(0 0 12px rgba(0, 229, 255, 0.35)) !important;
          }
          .mocd-tour-target-active input::placeholder,
          .mocd-tour-target-active::placeholder {
            color: rgba(255, 255, 255, 0.85) !important;
          }
          .mocd-tour-popover {
            position: fixed;
            z-index: 999995;
            width: min(390px, calc(100vw - 28px));
            background: linear-gradient(145deg, #10162a 0%, #090d18 100%);
            border: 1px solid rgba(0, 229, 255, 0.45);
            border-radius: 20px;
            padding: 18px 20px;
            color: #ffffff;
            box-shadow: 0 24px 65px rgba(0, 0, 0, 0.95), 0 0 35px rgba(0, 229, 255, 0.20);
            font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
            opacity: 0;
            transform: scale(0.96) translateY(6px);
            transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .mocd-tour-popover.visible {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
          /* Muesca / Flecha Indicadora de Alta Fidelidad */
          .mocd-tour-notch {
            position: absolute;
            width: 14px;
            height: 14px;
            background: #10162a;
            border: 1px solid rgba(0, 229, 255, 0.45);
            transform: rotate(45deg);
            z-index: -1;
          }
          .mocd-tour-notch.top {
            top: -7px;
            border-bottom: none;
            border-right: none;
          }
          .mocd-tour-notch.bottom {
            bottom: -7px;
            border-top: none;
            border-left: none;
          }
          .mocd-tour-notch.left {
            left: -7px;
            border-top: none;
            border-right: none;
          }
          .mocd-tour-notch.right {
            right: -7px;
            border-bottom: none;
            border-left: none;
          }
          .mocd-tour-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            padding: 3px 9px;
            border-radius: 9999px;
            background: rgba(0, 229, 255, 0.12);
            color: #38bdf8;
            border: 1px solid rgba(0, 229, 255, 0.35);
          }
          .mocd-tour-btn-primary {
            background: linear-gradient(135deg, #00d4ff 0%, #6366f1 55%, #8b5cf6 100%);
            color: #000000;
            font-weight: 800;
            font-size: 12.5px;
            padding: 8.5px 17px;
            border-radius: 12px;
            border: none;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s ease;
            box-shadow: 0 4px 15px rgba(0, 212, 255, 0.35);
          }
          .mocd-tour-btn-primary:hover {
            filter: brightness(1.12);
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(0, 212, 255, 0.45);
          }
          .mocd-tour-btn-primary:active {
            transform: translateY(0);
          }
          .mocd-tour-btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
            font-weight: 700;
            font-size: 12px;
            padding: 8px 13px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            cursor: pointer;
            transition: all 0.2s ease;
          }
          .mocd-tour-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.14);
            color: #ffffff;
          }
          .mocd-tour-btn-skip {
            background: transparent;
            color: #94a3b8;
            font-size: 11.5px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            padding: 4px 6px;
            text-decoration: underline;
            text-underline-offset: 3px;
            transition: color 0.2s ease;
          }
          .mocd-tour-btn-skip:hover {
            color: #ffffff;
          }
        `;
        document.head.appendChild(style);
      }

      // 2. Crear SVG Overlay con Mask Cutout (recorte 100% transparente)
      const svgNS = 'http://www.w3.org/2000/svg';
      this.svgEl = document.createElementNS(svgNS, 'svg');
      this.svgEl.id = 'mocdTourSvg';
      this.svgEl.setAttribute('class', 'mocd-tour-svg');
      this.svgEl.setAttribute('width', '100%');
      this.svgEl.setAttribute('height', '100%');

      const defs = document.createElementNS(svgNS, 'defs');
      const mask = document.createElementNS(svgNS, 'mask');
      mask.id = 'mocdSpotlightMask';
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '0');
      mask.setAttribute('y', '0');
      mask.setAttribute('width', '100%');
      mask.setAttribute('height', '100%');

      // Base blanca (hace visible el fondo oscuro en todo el viewport)
      const whiteRect = document.createElementNS(svgNS, 'rect');
      whiteRect.setAttribute('x', '0');
      whiteRect.setAttribute('y', '0');
      whiteRect.setAttribute('width', '100%');
      whiteRect.setAttribute('height', '100%');
      whiteRect.setAttribute('fill', '#ffffff');
      mask.appendChild(whiteRect);

      // Agujero negro (crea el recorte 100% transparente en el elemento resaltado)
      this.maskHoleEl = document.createElementNS(svgNS, 'rect');
      this.maskHoleEl.id = 'mocdMaskHole';
      this.maskHoleEl.setAttribute('fill', '#000000');
      this.maskHoleEl.setAttribute('x', '0');
      this.maskHoleEl.setAttribute('y', '0');
      this.maskHoleEl.setAttribute('width', '0');
      this.maskHoleEl.setAttribute('height', '0');
      this.maskHoleEl.setAttribute('rx', '16');
      this.maskHoleEl.setAttribute('ry', '16');
      mask.appendChild(this.maskHoleEl);
      defs.appendChild(mask);
      this.svgEl.appendChild(defs);

      // Rectángulo de fondo oscuro con la máscara aplicada
      const backdrop = document.createElementNS(svgNS, 'rect');
      backdrop.setAttribute('class', 'mocd-tour-backdrop');
      backdrop.setAttribute('x', '0');
      backdrop.setAttribute('y', '0');
      backdrop.setAttribute('width', '100%');
      backdrop.setAttribute('height', '100%');
      backdrop.setAttribute('mask', 'url(#mocdSpotlightMask)');
      this.svgEl.appendChild(backdrop);

      // 3. Spotlight Div (borde neón animado con box-shadow flotante)
      this.spotlightEl = document.createElement('div');
      this.spotlightEl.id = 'mocdTourSpotlight';
      this.spotlightEl.className = 'mocd-tour-spotlight';

      // 4. Popover Card y Muesca
      this.popoverEl = document.createElement('div');
      this.popoverEl.id = 'mocdTourPopover';
      this.popoverEl.className = 'mocd-tour-popover';

      this.notchEl = document.createElement('div');
      this.notchEl.className = 'mocd-tour-notch';
      this.popoverEl.appendChild(this.notchEl);

      document.body.appendChild(this.svgEl);
      document.body.appendChild(this.spotlightEl);
      document.body.appendChild(this.popoverEl);

      requestAnimationFrame(() => {
        if (this.svgEl) this.svgEl.classList.add('visible');
      });
    }

    showStep(index) {
      if (index < 0 || index >= this.steps.length) {
        this.complete();
        return;
      }

      this.currentStep = index;
      const step = this.steps[index];

      let targetEl = null;
      if (typeof step.target === 'function') {
        targetEl = step.target();
      } else if (typeof step.target === 'string') {
        targetEl = document.querySelector(step.target);
      }

      if (!targetEl) {
        console.warn('[OnboardingTour] Target no encontrado:', step.target);
        if (index + 1 < this.steps.length) {
          this.showStep(index + 1);
        } else {
          this.complete();
        }
        return;
      }

      if (typeof step.beforeShow === 'function') {
        try {
          step.beforeShow(targetEl);
        } catch (e) {
          console.error(e);
        }
      }

      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

      // Permite que el scroll suave se asiente antes de fijar las coordenadas finales
      setTimeout(() => {
        this.positionSpotlightAndPopover(targetEl, step);
      }, 220);
    }

    positionSpotlightAndPopover(targetEl, step) {
      if (!this.active || !this.spotlightEl || !this.popoverEl) return;

      const rect = targetEl.getBoundingClientRect();
      const padding = step.padding !== undefined ? step.padding : 8;
      const radius = step.borderRadius !== undefined ? step.borderRadius : 16;

      const spotTop = Math.max(0, rect.top - padding);
      const spotLeft = Math.max(0, rect.left - padding);
      const spotWidth = rect.width + padding * 2;
      const spotHeight = rect.height + padding * 2;

      // 1. Actualizar el agujero del SVG Mask (100% transparente)
      if (this.maskHoleEl) {
        this.maskHoleEl.setAttribute('x', spotLeft);
        this.maskHoleEl.setAttribute('y', spotTop);
        this.maskHoleEl.setAttribute('width', spotWidth);
        this.maskHoleEl.setAttribute('height', spotHeight);
        this.maskHoleEl.setAttribute('rx', radius);
        this.maskHoleEl.setAttribute('ry', radius);
        this.maskHoleEl.style.x = `${spotLeft}px`;
        this.maskHoleEl.style.y = `${spotTop}px`;
        this.maskHoleEl.style.width = `${spotWidth}px`;
        this.maskHoleEl.style.height = `${spotHeight}px`;
        this.maskHoleEl.style.rx = `${radius}px`;
        this.maskHoleEl.style.ry = `${radius}px`;
      }

      // 2. Actualizar el marco Neón animado
      this.spotlightEl.style.top = `${spotTop}px`;
      this.spotlightEl.style.left = `${spotLeft}px`;
      this.spotlightEl.style.width = `${spotWidth}px`;
      this.spotlightEl.style.height = `${spotHeight}px`;
      this.spotlightEl.style.borderRadius = `${radius}px`;

      // 3. Elevar temporalmente el elemento activo para máxima nitidez y contraste
      if (this.lastTargetEl && this.lastTargetEl !== targetEl) {
        this.lastTargetEl.classList.remove('mocd-tour-target-active');
        if (this.lastTargetEl.dataset.tourOrigPos !== undefined) {
          this.lastTargetEl.style.position = this.lastTargetEl.dataset.tourOrigPos;
          delete this.lastTargetEl.dataset.tourOrigPos;
        }
        if (this.lastTargetEl.dataset.tourOrigZ !== undefined) {
          this.lastTargetEl.style.zIndex = this.lastTargetEl.dataset.tourOrigZ;
          delete this.lastTargetEl.dataset.tourOrigZ;
        }
      }

      targetEl.dataset.tourOrigPos = targetEl.style.position || '';
      targetEl.dataset.tourOrigZ = targetEl.style.zIndex || '';
      const compPos = window.getComputedStyle(targetEl).position;
      if (compPos === 'static') {
        targetEl.style.position = 'relative';
      }
      targetEl.style.zIndex = '999986';
      targetEl.classList.add('mocd-tour-target-active');
      this.lastTargetEl = targetEl;

      const totalSteps = this.steps.length;
      const isFirst = this.currentStep === 0;
      const isLast = this.currentStep === totalSteps - 1;

      this.popoverEl.innerHTML = `
        <div class="mocd-tour-notch" id="mocdTourNotch"></div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px;">
          <span class="mocd-tour-badge">
            <span style="width: 6px; height: 6px; border-radius: 9999px; background: #00e5ff; display: inline-block;"></span>
            <span>Paso ${this.currentStep + 1} de ${totalSteps}</span>
          </span>
          <button type="button" class="mocd-tour-btn-skip" onclick="window.mocdCurrentTour.complete()" title="Cerrar y no volver a mostrar">
            ✕ Omitir
          </button>
        </div>

        <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
          <div style="font-size: 22px; line-height: 1; shrink-0;">${step.icon || '✨'}</div>
          <div>
            <h3 style="margin: 0; font-size: 14.5px; font-weight: 800; color: #ffffff; letter-spacing: -0.01em;">
              ${step.title}
            </h3>
          </div>
        </div>

        <p style="margin: 0 0 16px 0; font-size: 12.5px; line-height: 1.5; color: #cbd5e1; font-weight: 400;">
          ${step.description}
        </p>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px;">
          <div>
            ${
              !isFirst
                ? `<button type="button" class="mocd-tour-btn-secondary" onclick="window.mocdCurrentTour.prev()">◀ Anterior</button>`
                : `<span style="font-size: 11px; color: #64748b; font-weight: 600;">Primer ingreso</span>`
            }
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="mocd-tour-btn-primary" onclick="window.mocdCurrentTour.next()">
              <span>${isLast ? '¡Comenzar! 🚀' : 'Siguiente ▶'}</span>
            </button>
          </div>
        </div>
      `;

      this.notchEl = this.popoverEl.querySelector('#mocdTourNotch');
      this.calculatePopoverPosition(spotTop, spotLeft, spotWidth, spotHeight, step.placement || 'auto');
      this.popoverEl.classList.add('visible');
    }

    calculatePopoverPosition(sTop, sLeft, sWidth, sHeight, preferredPlacement) {
      const popover = this.popoverEl;
      const notch = this.notchEl;
      const popRect = popover.getBoundingClientRect();
      const pWidth = popRect.width || 360;
      const pHeight = popRect.height || 170;
      const winW = window.innerWidth;
      const winH = window.innerHeight;
      const margin = 14;

      let placement = preferredPlacement;

      if (placement === 'auto' || placement === 'bottom') {
        const spaceBelow = winH - (sTop + sHeight);
        const spaceAbove = sTop;
        if (placement === 'bottom' && spaceBelow < pHeight + margin + 10 && spaceAbove >= pHeight + margin + 10) {
          placement = 'top';
        } else if (placement === 'top' && spaceAbove < pHeight + margin + 10 && spaceBelow >= pHeight + margin + 10) {
          placement = 'bottom';
        } else if (placement === 'auto') {
          if (spaceBelow >= pHeight + margin + 10) {
            placement = 'bottom';
          } else if (spaceAbove >= pHeight + margin + 10) {
            placement = 'top';
          } else {
            placement = winW > 768 && sLeft > pWidth + margin ? 'left' : 'bottom';
          }
        }
      }

      let top = 0;
      let left = 0;
      notch.className = 'mocd-tour-notch';

      if (placement === 'bottom') {
        top = sTop + sHeight + margin;
        left = sLeft + sWidth / 2 - pWidth / 2;
        notch.classList.add('top');
        const notchLeft = Math.max(22, Math.min(pWidth - 22, sLeft + sWidth / 2 - left));
        notch.style.left = `${notchLeft}px`;
        notch.style.top = `-7px`;
        notch.style.bottom = '';
        notch.style.right = '';
      } else if (placement === 'top') {
        top = sTop - pHeight - margin;
        left = sLeft + sWidth / 2 - pWidth / 2;
        notch.classList.add('bottom');
        const notchLeft = Math.max(22, Math.min(pWidth - 22, sLeft + sWidth / 2 - left));
        notch.style.left = `${notchLeft}px`;
        notch.style.bottom = `-7px`;
        notch.style.top = '';
        notch.style.right = '';
      } else if (placement === 'left') {
        top = sTop + sHeight / 2 - pHeight / 2;
        left = sLeft - pWidth - margin;
        notch.classList.add('right');
        notch.style.right = `-7px`;
        notch.style.top = `${pHeight / 2 - 7}px`;
        notch.style.left = '';
        notch.style.bottom = '';
      } else {
        top = sTop + sHeight / 2 - pHeight / 2;
        left = sLeft + sWidth + margin;
        notch.classList.add('left');
        notch.style.left = `-7px`;
        notch.style.top = `${pHeight / 2 - 7}px`;
        notch.style.right = '';
        notch.style.bottom = '';
      }

      left = Math.max(12, Math.min(winW - pWidth - 12, left));
      top = Math.max(12, Math.min(winH - pHeight - 12, top));

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
    }

    next() {
      if (this.currentStep + 1 < this.steps.length) {
        this.showStep(this.currentStep + 1);
      } else {
        this.complete();
      }
    }

    prev() {
      if (this.currentStep > 0) {
        this.showStep(this.currentStep - 1);
      }
    }

    complete() {
      localStorage.setItem(this.storageKey, 'true');
      this.active = false;

      if (this.svgEl) {
        this.svgEl.classList.remove('visible');
      }
      if (this.popoverEl) {
        this.popoverEl.classList.remove('visible');
      }
      if (this.spotlightEl) {
        this.spotlightEl.style.opacity = '0';
      }

      setTimeout(() => {
        this.destroyDom();
      }, 350);

      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('resize', this.handleResize);
      window.removeEventListener('scroll', this.handleResize, true);

      if (typeof this.onComplete === 'function') {
        this.onComplete();
      }
    }

    destroyDom() {
      if (this.lastTargetEl) {
        this.lastTargetEl.classList.remove('mocd-tour-target-active');
        if (this.lastTargetEl.dataset.tourOrigPos !== undefined) {
          this.lastTargetEl.style.position = this.lastTargetEl.dataset.tourOrigPos;
          delete this.lastTargetEl.dataset.tourOrigPos;
        }
        if (this.lastTargetEl.dataset.tourOrigZ !== undefined) {
          this.lastTargetEl.style.zIndex = this.lastTargetEl.dataset.tourOrigZ;
          delete this.lastTargetEl.dataset.tourOrigZ;
        }
        this.lastTargetEl = null;
      }
      if (this.svgEl && this.svgEl.parentNode) {
        this.svgEl.parentNode.removeChild(this.svgEl);
      }
      if (this.spotlightEl && this.spotlightEl.parentNode) {
        this.spotlightEl.parentNode.removeChild(this.spotlightEl);
      }
      if (this.popoverEl && this.popoverEl.parentNode) {
        this.popoverEl.parentNode.removeChild(this.popoverEl);
      }
      this.svgEl = null;
      this.maskHoleEl = null;
      this.spotlightEl = null;
      this.popoverEl = null;
      this.notchEl = null;
    }

    handleKeyDown(e) {
      if (!this.active) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.complete();
      }
    }

    handleResize() {
      if (!this.active || this.currentStep >= this.steps.length) return;
      const step = this.steps[this.currentStep];
      let targetEl = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
      if (targetEl) {
        this.positionSpotlightAndPopover(targetEl, step);
      }
    }
  }

  // =========================================================
  // TOURS PRECONFIGURADOS: ADMIN (DJ) Y CLIENTE (MESAS)
  // =========================================================

  // 1. TOUR PARA LA CONSOLA DJ / ADMIN
  function initAdminTour() {
    const adminSteps = [
      {
        target: '#adminNowPlayingDeck',
        icon: '📻',
        title: 'Consola DJ y Reproductor en Vivo',
        description: 'Aquí ves el tema sonando en la pantalla del bar. Puedes pausar, adelantar canciones, regular el volumen maestro y ver la duración en tiempo real.',
        placement: 'bottom'
      },
      {
        target: '#adminLiveShowButtons',
        icon: '📸',
        title: 'Shows en TV: Ruleta 3D y Fotos Polaroid',
        description: 'Activa la Ruleta 3D para rifas de tragos en vivo o abre la Santa Chela Cam para aprobar las fotos y selfies que los clientes envían desde sus mesas.',
        placement: 'bottom'
      },
      {
        target: '#adminSearchInput',
        icon: '🔍',
        title: 'Buscador Manual del DJ',
        description: '¿Quieres programar un tema de inmediato? Búscalo por nombre, artista o pega un enlace de YouTube para añadirlo a la tanda con un solo toque.',
        placement: 'bottom'
      },
      {
        target: '#adminQueueSection',
        icon: '📋',
        title: 'Cola de Pedidos por Código QR',
        description: 'Cada canción solicitada por los clientes desde sus mesas llega a esta lista. Puedes reorganizarlas arrastrándolas o eliminarlas si lo deseas.',
        placement: 'top'
      },
      {
        target: () => {
          if (window.innerWidth < 1024) {
            const btnMenu = document.querySelector('button[onclick="toggleSidebarMobile()"]');
            return btnMenu || document.querySelector('#tabBtnPlaylists');
          }
          return document.querySelector('#tabBtnPlaylists');
        },
        icon: '📂',
        title: 'Listas Maestras y DJ Inteligente con IA',
        description: 'Configura las playlists base de tu bar (Salsa, Crossover, Rock) y activa el DJ con Inteligencia Artificial para que la fiesta nunca se quede en silencio.',
        placement: 'bottom'
      },
      {
        target: '#btnMicMode',
        icon: '🎙️',
        title: 'Modo Micrófono y Pantalla Completa',
        description: 'Atenúa la música automáticamente para hablar por el micrófono y pon la pantalla del televisor en modo Pantalla Completa desde tu teléfono.',
        placement: 'bottom'
      }
    ];

    window.adminTourInstance = new OnboardingTour({
      storageKey: 'mocd_admin_tour_completed_v2',
      steps: adminSteps,
      autoStartDelay: 1500
    });

    window.startAdminTour = function (force = true) {
      if (window.adminTourInstance) {
        window.adminTourInstance.start(force);
      }
    };

    window.adminTourInstance.init();
  }

  // 2. TOUR PARA LA VISTA DEL CLIENTE EN LAS MESAS
  function initClientTour() {
    const clientSteps = [
      {
        target: '#tableBadgeContainer',
        icon: '📍',
        title: '¡Mesa Conectada en Vivo!',
        description: 'Tu mesa está vinculada automáticamente al escanear el código QR. Todas las canciones y dedicatorias que envíes saldrán con el número de tu mesa en las pantallas.',
        placement: 'bottom'
      },
      {
        target: '#clientNowPlayingSection',
        icon: '🎵',
        title: 'Sonando Ahora en los Televisores',
        description: 'Aquí puedes ver qué canción y qué video musical oficial se está reproduciendo en este momento en las pantallas del bar.',
        placement: 'bottom'
      },
      {
        target: '#searchInput',
        icon: '🔎',
        title: 'Pide tu Canción Favorita',
        description: 'Escribe el nombre de tu canción o artista favorito. Nuestro sistema inteligente busca solo canciones originales y las añade a la tanda del bar.',
        placement: 'bottom'
      },
      {
        target: '#suggestionsSection',
        icon: '🔥',
        title: 'Éxitos en 1 Solo Clic',
        description: '¿No sabes qué pedir? Toca cualquiera de nuestros clásicos para pedirlo al instante sin tener que escribir.',
        placement: 'bottom'
      },
      {
        target: '#clientQueueSection',
        icon: '📋',
        title: 'Próximas Canciones en Cola',
        description: 'Revisa la lista en vivo para saber exactamente en qué orden y cuándo sonará la canción pedida por tu mesa.',
        placement: 'top'
      }
    ];

    window.clientTourInstance = new OnboardingTour({
      storageKey: 'mocd_client_tour_completed_v2',
      steps: clientSteps,
      autoStartDelay: 1400
    });

    window.startClientTour = function (force = true) {
      if (window.clientTourInstance) {
        window.clientTourInstance.start(force);
      }
    };

    window.clientTourInstance.init();
  }

  window.OnboardingTour = OnboardingTour;
  window.initAdminTour = initAdminTour;
  window.initClientTour = initClientTour;
})(window, document);
