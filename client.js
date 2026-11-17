/**
 * Client half of the OpenCode Go status bar.
 *
 * Renders into the single root-scoped `shell.bottom` slot — the full-width row
 * under the three columns — right-aligned so the columns keep their size. The
 * bar polls the plugin's own Host route, which owns the account key and the
 * upstream call; nothing here talks to opencode.ai or sees a secret.
 *
 * Each window pill opens a detail popover modelled on the host's own
 * `TurnUsagePanel`: a body portal, `role="dialog"`, Escape and outside-click
 * dismissal, and the host menu surface tokens for its chrome.
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** `react-dom` is part of the browser module table; without it the pills
     *  keep their `title` tooltip and simply do not open a panel. */
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }

    const NS = 'opencodeGoUsage'
    const STATE_URL = 'opencode-go-usage/api/state'
    const REFRESH_URL = 'opencode-go-usage/api/refresh'
    const POLL_MS = 30000
    const PANEL_GAP = 8
    const PANEL_MARGIN = 12
    const WINDOWS = [
      { key: 'rolling', label: 'fiveHours' },
      { key: 'weekly', label: 'week' },
      { key: 'monthly', label: 'month' },
    ]

    const DICTIONARIES = {
      en: {
        brand: 'OpenCode Go',
        fiveHours: '5h',
        week: 'wk',
        month: 'mo',
        loading: 'reading usage…',
        refresh: 'Refresh now',
        details: 'Allowance details',
        resetsIn: 'resets in',
        resetsAt: 'resets at',
        now: 'now',
        used: 'Used',
        limit: 'Window',
        resets: 'Resets',
        left: 'Time left',
        status: 'Status',
        keySource: 'Key',
        checked: 'Checked',
        statusOk: 'within limit',
        statusLimited: 'limit reached',
        keyStore: 'DSH credential store',
        keyEnv: 'environment variable',
        keyUnknown: 'unavailable',
        lastError: 'Last poll',
        noKey: 'no OpenCode Go key',
        noKeyHint:
          'Store OPENCODE_GO_API_KEY in Settings › Models, or export it before launching the Harness.',
        unreachable: 'usage unavailable',
        limited: 'limit reached',
        dayShort: 'd',
        hourShort: 'h',
        minuteShort: 'm',
        updated: 'Updated',
        accountHint: 'OpenCode Go allowance toward the 5-hour, weekly and monthly limits',
      },
      ru: {
        brand: 'OpenCode Go',
        fiveHours: '5ч',
        week: 'нед',
        month: 'мес',
        loading: 'читаю расход…',
        refresh: 'Обновить',
        details: 'Подробности лимита',
        resetsIn: 'сброс через',
        resetsAt: 'сброс',
        now: 'сейчас',
        used: 'Израсходовано',
        limit: 'Окно',
        resets: 'Сброс',
        left: 'Осталось',
        status: 'Статус',
        keySource: 'Ключ',
        checked: 'Проверено',
        statusOk: 'в норме',
        statusLimited: 'лимит достигнут',
        keyStore: 'хранилище DSH',
        keyEnv: 'переменная окружения',
        keyUnknown: 'недоступно',
        lastError: 'Последний опрос',
        noKey: 'нет ключа OpenCode Go',
        noKeyHint:
          'Укажите OPENCODE_GO_API_KEY в Настройки › Модели или задайте переменную окружения перед запуском.',
        unreachable: 'данные недоступны',
        limited: 'лимит достигнут',
        dayShort: 'д',
        hourShort: 'ч',
        minuteShort: 'м',
        updated: 'Обновлено',
        accountHint: 'Расход лимитов OpenCode Go за 5 часов, неделю и месяц',
      },
    }

    const CSS = `
      .ogu-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        width: 100%;
        min-height: 28px;
        padding: 0 10px 0 12px;
        box-sizing: border-box;
        background: var(--dsw-alias-bg-base);
        border-top: 1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.18));
        color: var(--dsw-alias-label-secondary);
        font-size: 11.5px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
      }
      .ogu-brand {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        color: var(--dsw-alias-label-secondary);
        letter-spacing: 0.01em;
        padding-right: 2px;
      }
      .ogu-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: 0 0 auto;
        background: var(--dsw-alias-brand-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent);
      }
      .ogu-dot.ogu-idle { background: var(--dsw-alias-state-idle-primary); box-shadow: none; }
      .ogu-dot.ogu-warn { background: var(--dsw-alias-state-warn-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent); }
      .ogu-dot.ogu-danger { background: var(--dsw-alias-state-error-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); }
      .ogu-win {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border-radius: 999px;
        white-space: nowrap;
        cursor: pointer;
        color: inherit;
        background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.08));
        transition: background 120ms ease;
      }
      .ogu-win:hover { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.14)); }
      .ogu-win:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .ogu-win[aria-expanded="true"] { background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.16)); }
      .ogu-k { color: var(--dsw-alias-label-secondary); }
      .ogu-track {
        display: block;
        width: 30px;
        height: 4px;
        border-radius: 999px;
        overflow: hidden;
        flex: 0 0 auto;
        background: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28));
      }
      .ogu-fill {
        display: block;
        height: 100%;
        min-width: 2px;
        border-radius: 999px;
        background: var(--dsw-alias-brand-primary);
        transition: width 400ms ease;
      }
      .ogu-fill.ogu-warn { background: var(--dsw-alias-state-warn-primary); }
      .ogu-fill.ogu-danger { background: var(--dsw-alias-state-error-primary); }
      .ogu-v {
        color: var(--dsw-alias-label-primary);
        font-weight: 650;
        min-width: 24px;
        text-align: right;
      }
      .ogu-v.ogu-warn { color: var(--dsw-alias-state-warn-primary); }
      .ogu-v.ogu-danger { color: var(--dsw-alias-state-error-primary); }
      .ogu-r {
        color: var(--dsw-alias-label-secondary);
        opacity: 0.62;
        font-size: 10.5px;
        letter-spacing: 0.01em;
      }
      .ogu-msg {
        max-width: 62ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding: 0 2px;
      }
      .ogu-msg.ogu-danger { color: var(--dsw-alias-state-error-primary); }
      .ogu-btn {
        all: unset;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        cursor: pointer;
        color: var(--dsw-alias-label-secondary);
        flex: 0 0 auto;
        transition: background 120ms ease, color 120ms ease;
      }
      .ogu-btn:hover {
        background: var(--dsw-alias-bg-layer-1, rgba(127, 127, 127, 0.12));
        color: var(--dsw-alias-label-primary);
      }
      .ogu-btn:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .ogu-btn[data-busy] { opacity: 0.4; cursor: progress; }
      .ogu-bar.ogu-stale .ogu-win { opacity: 0.62; }
      .ogu-bar.ogu-stale .ogu-brand { opacity: 0.72; }

      .ogu-panel {
        position: fixed;
        z-index: 1100;
        box-sizing: border-box;
        width: max-content;
        min-width: min(280px, calc(100vw - 24px));
        max-width: min(420px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        padding: 14px 16px 12px;
        overflow: hidden auto;
        border-radius: var(--dsw-radius-lg, 10px);
        background: var(--dsw-specific-menu, var(--dsw-alias-bg-overlay, #fff));
        box-shadow: var(--dsw-elevation-prominent, 0 8px 26px rgba(0, 0, 0, 0.22));
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 18px;
        font-variant-numeric: tabular-nums;
      }
      .ogu-panel-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 8px;
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .ogu-panel-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ogu-panel-value { font-weight: 650; }
      .ogu-panel-value.ogu-warn { color: var(--dsw-alias-state-warn-primary); }
      .ogu-panel-value.ogu-danger { color: var(--dsw-alias-state-error-primary); }
      .ogu-panel-track {
        display: block;
        height: 6px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.28));
        margin-bottom: 12px;
      }
      .ogu-panel-fill {
        display: block;
        height: 100%;
        min-width: 2px;
        border-radius: 999px;
        background: var(--dsw-alias-brand-primary);
      }
      .ogu-panel-fill.ogu-warn { background: var(--dsw-alias-state-warn-primary); }
      .ogu-panel-fill.ogu-danger { background: var(--dsw-alias-state-error-primary); }
      .ogu-rows {
        display: grid;
        grid-template-columns: minmax(84px, auto) minmax(0, 1fr);
        gap: 6px 16px;
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.78;
      }
      .ogu-rows dt, .ogu-rows dd { min-width: 0; margin: 0; }
      .ogu-rows dd {
        color: var(--dsw-alias-label-primary);
        text-align: right;
        opacity: 1;
        overflow-wrap: anywhere;
      }
      .ogu-rows dd.ogu-warn { color: var(--dsw-alias-state-warn-primary); }
      .ogu-rows dd.ogu-danger { color: var(--dsw-alias-state-error-primary); }
    `

    const routeUrl = (path) => new URL(path, document.baseURI).toString()

    /** Severity of one window, from its reported status and share used. */
    const severityOf = (entry) => {
      const percent = percentOf(entry)
      if (entry?.status === 'rate-limited' || percent >= 90) return 'danger'
      if (percent >= 70) return 'warn'
      return 'ok'
    }

    const percentOf = (entry) => {
      const value = Number(entry?.percent)
      if (!Number.isFinite(value)) return 0
      return Math.min(100, Math.max(0, Math.round(value)))
    }

    /** "3ч 20м" until the window resets; empty when unknown. */
    const remaining = (t, iso) => {
      const target = Date.parse(String(iso ?? ''))
      if (!Number.isFinite(target)) return ''
      const ms = target - Date.now()
      if (ms <= 0) return t('now')
      const minutes = Math.round(ms / 60000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const rest = minutes % 60
      const parts = []
      if (days > 0) parts.push(`${days}${t('dayShort')}`)
      if (hours > 0 && parts.length < 2) parts.push(`${hours}${t('hourShort')}`)
      if (parts.length < 2 && rest > 0) parts.push(`${rest}${t('minuteShort')}`)
      return parts.join(' ')
    }

    const clock = (iso) => {
      const target = Date.parse(String(iso ?? ''))
      if (!Number.isFinite(target)) return ''
      return new Date(target).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    /** Place the panel above its pill, right edges aligned, kept on screen. */
    const placePanel = (anchor, width, height) => {
      const maxLeft = window.innerWidth - width - PANEL_MARGIN
      let left = anchor.right - width
      left = Math.max(PANEL_MARGIN, Math.min(left, Math.max(PANEL_MARGIN, maxLeft)))
      let top = anchor.top - PANEL_GAP - height
      if (top < PANEL_MARGIN) top = Math.min(anchor.bottom + PANEL_GAP, window.innerHeight - height - PANEL_MARGIN)
      return { left: `${Math.round(left)}px`, top: `${Math.round(Math.max(PANEL_MARGIN, top))}px` }
    }

    function WindowPanel(props) {
      const { t, label, entry, percent, level, source, fetchedAt, error, anchor, onClose } = props
      const panelRef = React.useRef(null)
      const [pos, setPos] = React.useState(undefined)

      React.useLayoutEffect(() => {
        const node = panelRef.current
        if (node === null) return
        const rect = node.getBoundingClientRect()
        setPos(placePanel(anchor, rect.width, rect.height))
      }, [anchor])

      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose()
        }
        const onPointerDown = (event) => {
          const node = panelRef.current
          if (node !== null && event.target instanceof Node && node.contains(event.target)) return
          onClose()
        }
        const onViewport = () => onClose()
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('resize', onViewport)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
          window.removeEventListener('resize', onViewport)
        }
      }, [onClose])

      const suffix = level === 'ok' ? '' : ` ogu-${level}`
      const left = remaining(t, entry?.resetsAt)
      const limitLabel = `${t(label)}`
      const sourceText =
        source === 'store' ? t('keyStore') : source === 'env' ? t('keyEnv') : t('keyUnknown')
      const statusText = entry?.status === 'rate-limited' ? t('statusLimited') : t('statusOk')
      const checked = new Date(Number(fetchedAt) || Date.now()).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })

      const row = (key, name, value, extra) =>
        h(
          React.Fragment,
          { key },
          h('dt', null, name),
          h('dd', { className: extra }, value),
        )

      const panel = h(
        'div',
        {
          ref: panelRef,
          className: 'ogu-panel',
          role: 'dialog',
          'aria-label': `${t('brand')} · ${limitLabel}`,
          style: pos === undefined ? { left: 0, top: 0, visibility: 'hidden' } : pos,
        },
        h(
          'div',
          { className: 'ogu-panel-head' },
          h('span', { className: 'ogu-panel-title' }, `${t('brand')} · ${limitLabel}`),
          h('span', { className: `ogu-panel-value${suffix}` }, `${percent}%`),
        ),
        h(
          'span',
          { className: 'ogu-panel-track' },
          h('span', { className: `ogu-panel-fill${suffix}`, style: { width: `${percent}%` } }),
        ),
        h(
          'dl',
          { className: 'ogu-rows' },
          row('used', t('used'), `${percent}%`, suffix === '' ? undefined : `ogu-${level}`),
          row('resets', t('resets'), clock(entry?.resetsAt) || '—'),
          row('left', t('left'), left || '—'),
          row('status', t('status'), statusText, entry?.status === 'rate-limited' ? 'ogu-danger' : undefined),
          row('key', t('keySource'), sourceText),
          row('checked', t('checked'), checked),
          error === undefined ? null : row('error', t('lastError'), error.message, 'ogu-danger'),
        ),
      )

      return createPortal === undefined ? panel : createPortal(panel, document.body)
    }

    function StatusBar(props) {
      const { ctx } = props
      const [state, setState] = React.useState({ phase: 'loading' })
      const [busy, setBusy] = React.useState(false)
      const [opened, setOpened] = React.useState(undefined)

      React.useEffect(() => {
        const dispose = ctx.locale.subscribe(() => setState((current) => ({ ...current })))
        return () => {
          dispose()
        }
      }, [ctx])

      const t = ctx.locale.bind(NS)

      React.useEffect(() => {
        const controller = new AbortController()
        let disposed = false
        const pull = async () => {
          try {
            const response = await fetch(routeUrl(STATE_URL), {
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            })
            const body = await response.json()
            if (!disposed) setState({ phase: 'ready', body })
          } catch (error) {
            if (disposed || controller.signal.aborted) return
            setState({
              phase: 'ready',
              body: {
                ok: false,
                error: {
                  code: 'transport',
                  message: error instanceof Error ? error.message : String(error),
                },
              },
            })
          }
        }
        void pull()
        const timer = setInterval(() => void pull(), POLL_MS)
        return () => {
          disposed = true
          controller.abort()
          clearInterval(timer)
        }
      }, [])

      const refresh = React.useCallback(async () => {
        setBusy(true)
        try {
          const response = await fetch(routeUrl(REFRESH_URL), {
            method: 'POST',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const body = await response.json()
          setState({ phase: 'ready', body })
        } catch (error) {
          setState({
            phase: 'ready',
            body: {
              ok: false,
              error: {
                code: 'transport',
                message: error instanceof Error ? error.message : String(error),
              },
            },
          })
        } finally {
          setBusy(false)
        }
      }, [])

      const body = state.phase === 'loading' ? undefined : state.body
      const usage = body?.usage
      const error = body?.error
      const stale = body?.stale === true
      const worst =
        usage === undefined
          ? 'idle'
          : stale
            ? 'warn'
            : WINDOWS.reduce((level, window) => {
                const next = severityOf(usage[window.key])
                const rank = { ok: 0, warn: 1, danger: 2 }
                return rank[next] > rank[level] ? next : level
              }, 'ok')

      const stamp = usage
        ? `${t('updated')} ${new Date(Number(body.fetchedAt) || Date.now()).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        : undefined

      let summary
      if (state.phase === 'loading') {
        summary = h('span', { className: 'ogu-msg' }, t('loading'))
      } else if (usage === undefined) {
        const code = error?.code
        const message = code === 'no-key' ? t('noKey') : `${t('unreachable')}: ${error?.message ?? ''}`
        summary = h(
          'span',
          {
            className: `ogu-msg${code === 'no-key' ? '' : ' ogu-danger'}`,
            title: code === 'no-key' ? t('noKeyHint') : error?.message,
          },
          message,
        )
      } else {
        summary = WINDOWS.map((window) => {
          const entry = usage[window.key]
          const percent = percentOf(entry)
          const level = severityOf(entry)
          const left = remaining(t, entry?.resetsAt)
          const suffix = level === 'ok' ? '' : ` ogu-${level}`
          const open = opened?.key === window.key
          return h(
            'button',
            {
              type: 'button',
              key: window.key,
              className: 'ogu-win',
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              'aria-label': `${t('brand')} ${t(window.label)}: ${percent}%`,
              title: `${t(window.label)}: ${percent}%${left === '' ? '' : ` · ${t('resetsIn')} ${left}`}`,
              onClick: (event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setOpened(open ? undefined : { key: window.key, anchor: rect })
              },
            },
            h('span', { className: 'ogu-k' }, t(window.label)),
            h(
              'span',
              { className: 'ogu-track' },
              h('span', { className: `ogu-fill${suffix}`, style: { width: `${percent}%` } }),
            ),
            h('span', { className: `ogu-v${suffix}` }, `${percent}%`),
            left === '' ? null : h('span', { className: 'ogu-r' }, left),
          )
        })
      }

      const active = opened === undefined ? undefined : WINDOWS.find((window) => window.key === opened.key)

      return h(
        'div',
        { className: `ogu-bar${stale ? ' ogu-stale' : ''}` },
        h('style', null, CSS),
        h(
          'span',
          { className: 'ogu-brand', title: usage ? stamp : t('accountHint') },
          h('span', { className: `ogu-dot${worst === 'ok' ? '' : ` ogu-${worst}`}` }),
          t('brand'),
        ),
        summary,
        h(
          'button',
          {
            type: 'button',
            className: 'ogu-btn',
            title: t('refresh'),
            'aria-label': t('refresh'),
            'data-busy': busy ? '' : undefined,
            disabled: busy,
            onClick: () => void refresh(),
          },
          h(
            'svg',
            { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
            h('path', {
              d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5H11',
              stroke: 'currentColor',
              strokeWidth: 1.4,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
          ),
        ),
        usage !== undefined && active !== undefined
          ? h(WindowPanel, {
              key: active.key,
              t,
              label: active.label,
              entry: usage[active.key],
              percent: percentOf(usage[active.key]),
              level: severityOf(usage[active.key]),
              source: body.source,
              fetchedAt: body.fetchedAt,
              error,
              anchor: opened.anchor,
              onClose: () => setOpened(undefined),
            })
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposeEn = ctx.locale.register(NS, 'en', DICTIONARIES.en)
          const disposeRu = ctx.locale.register(NS, 'ru', DICTIONARIES.ru)
          return () => {
            disposeRu()
            disposeEn()
          }
        }, 'opencode-go-usage: dictionaries')

        ctx.slots.inject('shell.bottom', () =>
          ctx.slots.register({ name: 'shell.bottom', locale: NS }, () => h(StatusBar, { ctx })),
        )
      },
    }
  },
})
