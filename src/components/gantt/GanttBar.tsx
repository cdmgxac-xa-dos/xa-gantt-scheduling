import type { ScheduleTask } from '@/types'
import { moduleColor, ROW_HEIGHT, BAR_VPAD } from './ganttGeometry'

const BAR_HEIGHT = ROW_HEIGHT - BAR_VPAD * 2

export function GanttBar({
  task,
  x,
  width,
  isCritical,
  editable,
  onMoveStart,
  onResizeStart,
  onLinkStart,
  onClick,
}: {
  task: ScheduleTask
  x: number
  width: number
  isCritical: boolean
  editable: boolean
  onMoveStart: (e: React.MouseEvent) => void
  onResizeStart: (e: React.MouseEvent, edge: 'left' | 'right') => void
  onLinkStart: (e: React.MouseEvent) => void
  onClick: () => void
}) {
  const baseColor = isCritical ? '#DC2626' : task.color || moduleColor(task.module)

  if (task.is_milestone) {
    const size = 16
    return (
      <div
        className="absolute flex items-center justify-center"
        style={{ left: x - size / 2, top: (ROW_HEIGHT - size) / 2, width: size, height: size }}
      >
        <div
          onMouseDown={editable ? onMoveStart : undefined}
          onClick={onClick}
          title={`${task.name} — ${task.start_date}`}
          className="h-full w-full rotate-45 border-2 border-white shadow"
          style={{ backgroundColor: baseColor, cursor: editable ? 'grab' : 'pointer' }}
        />
      </div>
    )
  }

  const showInlineLabel = width >= 70

  return (
    <div
      className="group absolute"
      style={{ left: x, top: BAR_VPAD, width: Math.max(width, 6), height: BAR_HEIGHT }}
    >
      <div
        onMouseDown={editable ? onMoveStart : undefined}
        onClick={onClick}
        title={`${task.name}\n${task.start_date} → ${task.end_date} · ${task.percent_complete}% complete${isCritical ? ' · Critical path' : ''}`}
        className="relative h-full w-full overflow-hidden rounded-md border shadow-sm"
        style={{
          backgroundColor: `${baseColor}33`,
          borderColor: baseColor,
          cursor: editable ? 'grab' : 'pointer',
        }}
      >
        <div
          className="h-full"
          style={{ width: `${Math.min(100, Math.max(0, task.percent_complete))}%`, backgroundColor: baseColor }}
        />
        {showInlineLabel && (
          <span className="pointer-events-none absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-white mix-blend-normal">
            <span className="truncate drop-shadow-sm" style={{ color: task.percent_complete > 45 ? '#fff' : '#0F172A' }}>
              {task.name}
            </span>
          </span>
        )}
      </div>

      {!showInlineLabel && (
        <span className="absolute left-[calc(100%+6px)] top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-medium text-brand-ink">
          {task.name}
        </span>
      )}

      {editable && (
        <>
          <div
            onMouseDown={(e) => onResizeStart(e, 'left')}
            className="absolute -left-1 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ backgroundColor: baseColor }}
          />
          <div
            onMouseDown={(e) => onResizeStart(e, 'right')}
            className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ backgroundColor: baseColor }}
          />
          <div
            onMouseDown={onLinkStart}
            title="Drag to link a dependency"
            className="absolute -right-2 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white opacity-0 shadow group-hover:opacity-100"
            style={{ backgroundColor: baseColor }}
          />
        </>
      )}
    </div>
  )
}
