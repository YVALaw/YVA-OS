import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type DragEvent, type ReactNode, type SetStateAction } from 'react'
import { daysUntil } from '../utils/dates'

export function protoCurrency(value: number, decimals = 0): string {
  return `$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function protoDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function protoDateShort(value?: string): string {
  if (!value) return '—'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Whole calendar days until `value`; 0 when absent or unparseable. */
export function daysFromToday(value?: string): number {
  return daysUntil(value) ?? 0
}

export function dueLabel(value?: string): string {
  if (!value) return '—'
  const diff = daysFromToday(value)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff < 7) return `In ${diff}d`
  return protoDateShort(value)
}

export function colorFromString(value: string, palette?: string[]): string {
  const colors = palette || ['#22d3ee', '#60a5fa', '#c084fc', '#fb923c', '#10b981', '#f87171']
  const key = value || '?'
  let total = 0
  for (let i = 0; i < key.length; i += 1) total += key.charCodeAt(i)
  return colors[total % colors.length]
}

export function initials(name?: string): string {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

export function Avatar({
  name,
  color,
  size = 'md',
}: {
  name?: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <div
      className={`proto-avatar proto-avatar-${size}`}
      style={{ background: `linear-gradient(135deg, ${color || colorFromString(name || '?')} 0%, rgba(255,255,255,0.14) 180%)` }}
    >
      {initials(name)}
    </div>
  )
}

export function StatusChip({
  status,
  filled = false,
}: {
  status?: string
  filled?: boolean
}) {
  const normalized = String(status || 'draft').toLowerCase()
  return (
    <span className={`proto-chip proto-chip-${normalized}${filled ? ' proto-chip-fill' : ''}`}>
      <span className="proto-chip-dot" />
      {normalized.toUpperCase()}
    </span>
  )
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="proto-tabs">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          className={`proto-tab${option.id === value ? ' active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; count?: number }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="proto-filter-chips">
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          className={`proto-filter-chip${option.id === value ? ' active' : ''}`}
          onClick={() => onChange(option.id)}
        >
          <span>{option.label}</span>
          {typeof option.count === 'number' ? <span className="proto-filter-chip-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
  minWidth = 220,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minWidth?: number
}) {
  return (
    <label className="proto-search" style={{ minWidth }}>
      <ProtoIcon name="search" size={13} style={{ color: 'var(--muted)' }} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 720,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  width?: number
  footer?: ReactNode
  children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="proto-modal-scrim" onClick={onClose}>
      <div className="proto-modal-panel" style={{ width }} onClick={(event) => event.stopPropagation()}>
        <div className="proto-modal-head">
          <div>
            <div className="proto-modal-title">{title}</div>
            {subtitle ? <div className="proto-modal-subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="proto-btn proto-btn-ghost proto-btn-icon" onClick={onClose}>
            <ProtoIcon name="close" size={14} />
          </button>
        </div>
        <div className="proto-modal-body">{children}</div>
        {footer ? <div className="proto-modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  onClose,
  width = 640,
  children,
}: {
  open: boolean
  onClose: () => void
  width?: number
  children?: ReactNode
}) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="proto-drawer-scrim" onClick={onClose} />
      <div className="proto-drawer-panel" style={{ width }}>
        {children}
      </div>
    </>
  )
}

export function Sparkline({
  data,
  color = '#22d3ee',
  width = 70,
  height = 22,
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
}) {
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const step = width / Math.max(data.length - 1, 1)
  const d = data
    .map((value, index) => {
      const x = index * step
      const y = height - (((value - min) / range) * (height - 4) + 2)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="proto-spark">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function BarChart({
  data,
  accentMonth,
  height = 200,
}: {
  data: { label: string; fullLabel?: string; billed: number; collected: number; netEarnings?: number }[]
  accentMonth?: string
  height?: number
}) {
  const max = Math.max(...data.flatMap(item => [item.billed, item.collected]), 1)
  return (
    <div
      className="proto-bar-chart"
      style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)`, height }}
    >
      {data.map(item => {
        const billedHeight = (item.billed / max) * 100
        const collectedHeight = (item.collected / max) * 100
        const current = item.label === accentMonth
        const netEarnings = item.netEarnings ?? item.billed - item.collected
        const collectionRate = item.billed > 0 ? Math.round((item.collected / item.billed) * 100) : 0
        return (
          <div key={item.label} className="proto-bar-chart-col" tabIndex={0} aria-label={`${item.fullLabel || item.label}: ${protoCurrency(item.billed)} billed, ${protoCurrency(item.collected)} collected, ${protoCurrency(netEarnings)} net earnings`}>
            <div className={`proto-bar-chart-value${current ? ' current' : ''}`}>{protoCurrency(item.billed / 1000, 1)}k</div>
            <div className="proto-bar-chart-bars">
              <div
                className={`proto-bar-chart-bar${current ? ' current' : ''}`}
                style={{ height: `${billedHeight}%` }}
              />
              <div className="proto-bar-chart-bar muted" style={{ height: `${collectedHeight}%` }} />
            </div>
            <div className={`proto-bar-chart-label${current ? ' current' : ''}`}>{item.label.toUpperCase()}</div>
            <div className="proto-bar-chart-tooltip" role="tooltip">
              <div className="proto-bar-chart-tooltip-title">{item.fullLabel || item.label}</div>
              <div className="proto-bar-chart-tooltip-row"><span>Billed</span><strong>{protoCurrency(item.billed)}</strong></div>
              <div className="proto-bar-chart-tooltip-row"><span>Collected</span><strong>{protoCurrency(item.collected)}</strong></div>
              <div className="proto-bar-chart-tooltip-row"><span>Net earnings</span><strong>{protoCurrency(netEarnings)}</strong></div>
              <div className="proto-bar-chart-tooltip-note">{collectionRate}% collected</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export type ProtoIconName =
  | 'plus'
  | 'download'
  | 'search'
  | 'close'
  | 'chevronD'
  | 'chevronR'
  | 'chevronL'
  | 'more'
  | 'send'
  | 'edit'
  | 'mail'
  | 'check'
  | 'phone'
  | 'trash'
  | 'zap'
  | 'eye'
  | 'arrowR'
  | 'building'
  | 'team'
  | 'invoice'
  | 'expense'
  | 'bell'
  | 'shield'
  | 'database'
  | 'warn'

export function ProtoIcon({
  name,
  size = 14,
  style,
}: {
  name: ProtoIconName
  size?: number
  style?: CSSProperties
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  }

  switch (name) {
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'download':
      return <svg {...common}><path d="M12 4v10" /><path d="m8 10 4 4 4-4" /><path d="M5 19h14" /></svg>
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="6" /><path d="m20 20-3.5-3.5" /></svg>
    case 'close':
      return <svg {...common}><path d="M6 6l12 12M18 6 6 18" /></svg>
    case 'chevronD':
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>
    case 'chevronR':
      return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>
    case 'chevronL':
      return <svg {...common}><path d="m15 6-6 6 6 6" /></svg>
    case 'more':
      return <svg {...common}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>
    case 'send':
      return <svg {...common}><path d="m4 12 15-7-4 14-3-6-8-1Z" /></svg>
    case 'edit':
      return <svg {...common}><path d="M12 20h9" /><path d="m16.5 3.5 4 4L8 20l-4 1 1-4Z" /></svg>
    case 'mail':
      return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
    case 'check':
      return <svg {...common}><path d="m5 12 4 4 10-10" /></svg>
    case 'phone':
      return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.4 19.4 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.4 2.7a2 2 0 0 1-.6 1.8L7.2 9.8a16 16 0 0 0 7 7l1.6-1.7a2 2 0 0 1 1.8-.6l2.7.4A2 2 0 0 1 22 16.9Z" /></svg>
    case 'trash':
      return <svg {...common}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
    case 'zap':
      return <svg {...common}><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
    case 'eye':
      return <svg {...common}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'arrowR':
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
    case 'building':
      return <svg {...common}><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" /><path d="M3 21h18" /><path d="M8 7h1M12 7h1M8 11h1M12 11h1M8 15h1M12 15h1" /></svg>
    case 'team':
      return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
    case 'invoice':
      return <svg {...common}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 7h6M9 11h6M9 15h3" /></svg>
    case 'expense':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 6v12M16 9a3 3 0 0 0-3-2h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a3 3 0 0 1-3-2" /></svg>
    case 'bell':
      return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>
    case 'shield':
      return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>
    case 'database':
      return <svg {...common}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>
    case 'warn':
      return <svg {...common}><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5M12 17h.01" /></svg>
    default:
      return null
  }
}

export type KanbanDnd<T extends { id: string }> = {
  dragging: string | null
  dragOver: string | null
  onItemDragStart: (item: T, sourceColumnId?: string | null) => (event: DragEvent<HTMLElement>) => void
  onItemDragEnd: () => void
  onColumnDragOver: (columnId: string) => (event: DragEvent<HTMLElement>) => void
  onColumnDragLeave: (columnId: string) => (event: DragEvent<HTMLElement>) => void
  onColumnDrop: (columnId: string) => (event: DragEvent<HTMLElement>) => void
}

export function useKanbanDnd<T extends { id: string }>(
  items: T[],
  setItems: Dispatch<SetStateAction<T[]>>,
  applyMove: (item: T, newColumnId: string, sourceColumnId?: string | null) => T,
): KanbanDnd<T> {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const sourceColumnRef = useRef<string | null>(null)

  return {
    dragging,
    dragOver,
    onItemDragStart: (item: T, sourceColumnId?: string | null) => (event: DragEvent<HTMLElement>) => {
      setDragging(item.id)
      sourceColumnRef.current = sourceColumnId || null
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item.id)
    },
    onItemDragEnd: () => {
      setDragging(null)
      setDragOver(null)
      sourceColumnRef.current = null
    },
    onColumnDragOver: (columnId: string) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOver !== columnId) setDragOver(columnId)
    },
    onColumnDragLeave: (columnId: string) => (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      if (dragOver === columnId) setDragOver(null)
    },
    onColumnDrop: (columnId: string) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      const id = event.dataTransfer.getData('text/plain') || dragging
      if (!id) return
      const sourceColumnId = sourceColumnRef.current
      if (sourceColumnId === columnId) {
        setDragging(null)
        setDragOver(null)
        sourceColumnRef.current = null
        return
      }
      setItems(current => current.map(item => item.id === id ? applyMove(item, columnId, sourceColumnId) : item))
      setDragging(null)
      setDragOver(null)
      sourceColumnRef.current = null
    },
  }
}

export function KanbanColumn<T extends { id: string }>({
  column,
  dnd,
  accent,
  headerRight,
  children,
}: {
  column: { id: string; label: string; items?: unknown[] }
  dnd: KanbanDnd<T>
  accent?: string
  headerRight?: ReactNode
  children?: ReactNode
}) {
  const isOver = dnd.dragOver === column.id
  return (
    <div
      className="kanban-col"
      onDragOver={dnd.onColumnDragOver(column.id)}
      onDragLeave={dnd.onColumnDragLeave(column.id)}
      onDrop={dnd.onColumnDrop(column.id)}
      style={{
        ['--kanban-accent' as never]: accent || 'var(--gold)',
        background: isOver ? 'var(--surf2)' : 'var(--surface)',
        outline: isOver ? '1px dashed var(--gold)' : 'none',
        outlineOffset: -1,
        transition: 'background .12s ease',
      }}
    >
      <div className="kanban-col-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--kanban-accent)' }} />
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--kanban-accent)' }}>{column.label}</span>
          <span className="proto-mono" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--surf2)', color: 'var(--muted)', borderRadius: 3, fontWeight: 700 }}>{column.items?.length || 0}</span>
        </div>
        {headerRight || null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', flex: 1, minHeight: 100 }}>
        {children}
        {(column.items?.length || 0) === 0 && !children ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--dim)', border: '1px dashed var(--border)', borderRadius: 6 }}>Drop here</div>
        ) : null}
      </div>
    </div>
  )
}

export function KanbanItem<T extends { id: string }>({
  item,
  dnd,
  accent,
  sourceColumnId,
  onClick,
  children,
}: {
  item: T
  dnd: KanbanDnd<T>
  accent?: string
  sourceColumnId?: string
  onClick?: () => void
  children?: ReactNode
}) {
  const isDragging = dnd.dragging === item.id
  return (
    <div
      className="kanban-card"
      draggable
      onDragStart={dnd.onItemDragStart(item, sourceColumnId)}
      onDragEnd={dnd.onItemDragEnd}
      onClick={onClick}
      style={{
        borderLeftColor: accent,
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
    >
      {children}
    </div>
  )
}
