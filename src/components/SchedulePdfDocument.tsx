import { Document, Page, View, Text, StyleSheet, Svg, Path, Polygon } from '@react-pdf/renderer'
import type { ScheduleDependency, ScheduleHealth, ScheduleTask } from '@/types'
import { SCHEDULE_HEALTH_LABELS } from '@/types'
import { diffDays, durationDays, taskBaselineVarianceDays } from '@/lib/scheduleEngine'
import { buildDayCells, buildMonthGroups, type DayCell } from '@/components/gantt/ganttGeometry'

// A4 landscape is 841.89 x 595.28pt; content width after the page's 28pt
// horizontal padding on each side. Fixed because dependency lines need real
// pt coordinates (SVG path data isn't percentage-based like View widths),
// and this document is always rendered at this page size.
const PAGE_CONTENT_WIDTH_PT = 841.89 - 28 * 2
const CHART_NAME_COL_WIDTH_PT = PAGE_CONTENT_WIDTH_PT * 0.22
const CHART_COL_WIDTH_PT = PAGE_CONTENT_WIDTH_PT * 0.78
// Chart-page rows get an explicit height (rather than the content-driven
// auto height Page 1's rows use) so every row's vertical position is known
// in advance — required to draw dependency lines, which need to reach an
// exact y for a task that may be several modules down the page.
const CHART_ROW_HEIGHT = 24
const MODULE_TITLE_BLOCK_HEIGHT = 26

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 90,
    paddingHorizontal: 28,
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: '#0F172A',
  },
  // Page 2 reserves extra top space for the fixed title + date-axis block
  // (see chartPageHeader below) that repeats below the report header on
  // every page the chart spills onto.
  pageWithAxis: { paddingTop: 134 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#CBD5E1',
  },
  headerTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#0F172A' },
  headerDate: { fontSize: 8, color: '#64748B', marginTop: 2 },
  footer: { position: 'absolute', bottom: 16, right: 28, textAlign: 'right', fontSize: 8, color: '#64748B' },
  projectBlock: { marginBottom: 14 },
  projectName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: '#0F172A' },
  projectMeta: { fontSize: 9, color: '#334155', marginTop: 3 },
  projectMetaLabel: { fontFamily: 'Helvetica-Bold', color: '#475569' },
  pageKicker: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0E7C86', textTransform: 'uppercase', marginBottom: 2 },
  statRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 4, padding: 8 },
  statLabel: { fontSize: 7, color: '#64748B', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginTop: 2 },
  moduleTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#0F766E',
    marginTop: 10,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  table: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' },
  tHeadRow: { flexDirection: 'row', backgroundColor: '#F1F5F9' },
  tRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E2E8F0', alignItems: 'center' },
  // Same as tRow, but a fixed height instead of content-driven — see
  // CHART_ROW_HEIGHT above for why the chart page's rows need one.
  chartRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#E2E8F0', alignItems: 'center', height: CHART_ROW_HEIGHT },
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#475569', padding: 4, textTransform: 'uppercase' },
  td: { fontSize: 7.5, padding: 4, color: '#0F172A' },
  colCode: { width: '8%' },
  colNameText: { width: '24%' },
  colDate: { width: '12%' },
  colDur: { width: '9%', textAlign: 'center' },
  colPct: { width: '9%', textAlign: 'center' },
  colVariance: { width: '11%', textAlign: 'center' },
  colCritical: { width: '12%', textAlign: 'center' },
  colNameChart: { width: '22%' },
  colBarChart: { width: '78%', paddingVertical: 5 },
  critical: { color: '#DC2626', fontFamily: 'Helvetica-Bold' },
  delayedVariance: { color: '#DC2626', fontFamily: 'Helvetica-Bold' },
  // Fixed, page-repeating title + date axis for the chart page — title on
  // top, axis below it, so it reads as one continuous picture rather than a
  // header repeated per module (top: 56 sits right below the fixed report
  // header, which occupies the same 56pt the page style reserves via
  // paddingTop).
  chartPageHeader: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
  },
  // The "Activity" label and the month/date columns are siblings in one row
  // so they start at the same top edge, instead of "Activity" trailing
  // behind a taller two-row axis block.
  axisRow: { flexDirection: 'row', marginTop: 8, borderBottomWidth: 1, borderBottomColor: '#CBD5E1' },
  axisNameCol: { width: '22%' },
  axisNameLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#475569', textTransform: 'uppercase' },
  axisChartCol: { width: '78%' },
  axisMonthRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  axisMonthCell: {
    fontSize: 7,
    fontFamily: 'Helvetica-Bold',
    color: '#0F172A',
    textTransform: 'uppercase',
    paddingVertical: 2,
    paddingLeft: 2,
    borderLeftWidth: 1,
    borderLeftColor: '#E2E8F0',
  },
  axisTickRow: { flexDirection: 'row' },
  axisTickCell: { fontSize: 6.5, color: '#64748B', textAlign: 'center', paddingTop: 1, paddingBottom: 2 },
  chartLegend: { fontSize: 7.5, fontStyle: 'italic', color: '#64748B', marginBottom: 6 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 9, height: 9, borderRadius: 2 },
  legendDiamond: { width: 7, height: 7, transform: 'rotate(45deg)' },
  legendLine: { width: 12, height: 0, borderTopWidth: 1.5 },
  legendLabel: { fontSize: 7, color: '#334155' },
  healthOnTrack: { color: '#059669', fontFamily: 'Helvetica-Bold' },
  healthWatch: { color: '#D97706', fontFamily: 'Helvetica-Bold' },
  healthAtRisk: { color: '#DC2626', fontFamily: 'Helvetica-Bold' },
  barTrack: { height: 10, position: 'relative' },
  baselineBar: { position: 'absolute', top: 11, height: 2, borderRadius: 1, backgroundColor: '#CBD5E1' },
  barFill: { position: 'absolute', top: 0, height: 10, borderRadius: 2, borderWidth: 0.5, borderColor: '#0E7C86' },
  barProgress: { position: 'absolute', top: 0, left: 0, height: 10, borderRadius: 2, backgroundColor: '#0E7C86' },
  milestoneMarker: {
    position: 'absolute',
    top: 1,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    transform: 'rotate(45deg)',
  },
  endRule: { marginTop: 20, borderTopWidth: 1, borderTopColor: '#0F172A' },
  endText: { marginTop: 6, textAlign: 'right', fontSize: 9, fontFamily: 'Helvetica-BoldOblique', color: '#334155' },
  // bottom: 58, not 24 — the page footer ("(n) of (n)") sits at bottom: 16,
  // and 24 put barely 8pt between the two, enough to visibly overlap.
  signatureBlock: { position: 'absolute', left: 28, bottom: 58, width: 200 },
  signatureBlockRight: { position: 'absolute', right: 28, bottom: 58, width: 200, alignItems: 'flex-end' },
  sigLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginBottom: 4 },
  sigSpace: { height: 34 },
  sigLine: { width: 180, borderTopWidth: 1, borderTopColor: '#0F172A' },
  sigName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginTop: 4 },
  sigDesignation: { fontSize: 8, color: '#475569', marginTop: 1 },
})

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.max(0, Math.min(100, (numerator / denominator) * 100)) : 0
}

// This react-pdf version has no numberOfLines/line-clamp support, so a long
// task name would otherwise wrap to 2+ lines and grow that row taller than
// CHART_ROW_HEIGHT — breaking the fixed-height assumption DependencyLines
// relies on to know every row's y in advance. 36 chars is a conservative fit
// for the ~22%-wide name column at this font size even with wide characters.
function truncateForChartRow(name: string): string {
  const maxChars = 36
  return name.length > maxChars ? `${name.slice(0, maxChars - 1).trimEnd()}…` : name
}

// The PDF page has a fixed, non-scrolling width, so — unlike the web chart's
// day/week/month zoom picker — the whole project's day range must always fit
// across it at once. These thresholds pick a tick density that stays legible
// at that fixed width: below ~40 days there's room to label every day; up to
// ~120 days only Mondays are labeled to avoid the numbers overlapping; past
// that, day-level ticks would be illegibly cramped even at weekly spacing, so
// the axis switches to labeling each week-of-month (1-5) instead.
const AXIS_MONTH_TIER_MIN_DAYS = 120
const AXIS_DAILY_TICKS_MAX_DAYS = 40

function shouldLabelDay(cell: DayCell, totalDays: number): boolean {
  return totalDays <= AXIS_DAILY_TICKS_MAX_DAYS || cell.weekday === 1
}

/** Groups day cells into week-of-month bands (e.g. "1", "2", "3"...), resetting at each month boundary. */
function buildWeekOfMonthGroups(cells: DayCell[]): { label: string; startIndex: number; span: number }[] {
  const groups: { key: string; label: string; startIndex: number; span: number }[] = []
  for (const cell of cells) {
    const weekOfMonth = Math.ceil(cell.dayOfMonth / 7)
    const key = `${cell.iso.slice(0, 7)}-${weekOfMonth}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.span++
    else groups.push({ key, label: String(weekOfMonth), startIndex: cell.index, span: 1 })
  }
  return groups
}

/** The chart page's single, page-repeating title + date axis — project name
 *  first, then a month band with, below it, either day/Monday ticks or
 *  week-of-month numbers (chosen by project length so the whole range always
 *  fits legibly across the fixed page width), with the "Activity" label
 *  sitting beside the axis rather than trailing behind them. */
function ChartLegend({ hasBaseline, hasDataDate }: { hasBaseline: boolean; hasDataDate: boolean }) {
  return (
    <View style={styles.legendRow}>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: '#0E7C86' }]} />
        <Text style={styles.legendLabel}>Current schedule</Text>
      </View>
      {hasBaseline && (
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: '#CBD5E1' }]} />
          <Text style={styles.legendLabel}>Baseline</Text>
        </View>
      )}
      <View style={styles.legendItem}>
        <View style={[styles.legendDiamond, { backgroundColor: '#0E7C86' }]} />
        <Text style={styles.legendLabel}>Milestone</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: '#DC2626' }]} />
        <Text style={styles.legendLabel}>Critical path</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: '#0E7C86', opacity: 0.4 }]} />
        <Text style={styles.legendLabel}>Progress</Text>
      </View>
      {hasDataDate && (
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { borderTopColor: '#2563EB', borderStyle: 'dashed' }]} />
          <Text style={styles.legendLabel}>Data Date</Text>
        </View>
      )}
    </View>
  )
}

function ChartPageHeader({
  projectName,
  rangeStart,
  totalDays,
  hasBaseline,
  hasDataDate,
}: {
  projectName: string
  rangeStart: string
  totalDays: number
  hasBaseline: boolean
  hasDataDate: boolean
}) {
  const cells = buildDayCells({ startIso: rangeStart, totalDays })
  const monthGroups = buildMonthGroups(cells)
  const useWeekNumbers = totalDays > AXIS_MONTH_TIER_MIN_DAYS
  const weekOfMonthGroups = useWeekNumbers ? buildWeekOfMonthGroups(cells) : []

  return (
    <View style={styles.chartPageHeader} fixed>
      <Text style={styles.pageKicker}>Gantt Timeline</Text>
      <Text style={styles.projectName}>{projectName}</Text>
      <ChartLegend hasBaseline={hasBaseline} hasDataDate={hasDataDate} />

      <View style={styles.axisRow}>
        <View style={styles.axisNameCol}>
          <Text style={styles.axisNameLabel}>Activity</Text>
        </View>
        <View style={styles.axisChartCol}>
          <View style={styles.axisMonthRow}>
            {monthGroups.map((g) => (
              <Text key={`${g.label}-${g.startIndex}`} style={[styles.axisMonthCell, { width: `${pct(g.span, totalDays)}%` }]}>
                {g.label}
              </Text>
            ))}
          </View>
          <View style={styles.axisTickRow}>
            {useWeekNumbers
              ? weekOfMonthGroups.map((g) => (
                  <Text key={`${g.label}-${g.startIndex}`} style={[styles.axisTickCell, { width: `${pct(g.span, totalDays)}%` }]}>
                    {g.label}
                  </Text>
                ))
              : cells.map((c) => (
                  <Text key={c.iso} style={[styles.axisTickCell, { width: `${pct(1, totalDays)}%` }]}>
                    {shouldLabelDay(c, totalDays) ? c.dayOfMonth : ''}
                  </Text>
                ))}
          </View>
        </View>
      </View>
    </View>
  )
}

function ReportHeader({ generatedDate }: { generatedDate: string }) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.headerTitle}>Project Schedule — Gantt Report</Text>
      <Text style={styles.headerDate}>As of {generatedDate}</Text>
    </View>
  )
}

function ReportFooter() {
  return (
    <View style={styles.footer} fixed>
      <Text render={({ pageNumber, totalPages }) => `(${pageNumber}) of (${totalPages})`} />
    </View>
  )
}

function SignatureBlocks({
  preparedByName,
  preparedByDesignation,
  approvedByName,
  approvedByTitle,
}: {
  preparedByName: string | null
  preparedByDesignation: string | null
  approvedByName: string | null
  approvedByTitle: string | null
}) {
  return (
    <>
      <View style={styles.endRule} />
      <Text style={styles.endText}>Nothing follows</Text>

      {/* wrap=false keeps each signature block a single unbroken unit — if it
          doesn't fit in the remaining space on the current page, the whole
          block moves to the next page together rather than splitting across
          two (which is what caused "Prepared by:" to land alone on one page
          and the name/line on the next). */}
      <View style={styles.signatureBlock} wrap={false}>
        <Text style={styles.sigLabel}>Prepared by:</Text>
        <View style={styles.sigSpace} />
        <View style={styles.sigLine} />
        <Text style={styles.sigName}>{preparedByName ?? '—'}</Text>
        {preparedByDesignation && <Text style={styles.sigDesignation}>{preparedByDesignation}</Text>}
      </View>

      {approvedByName && (
        <View style={styles.signatureBlockRight} wrap={false}>
          <Text style={styles.sigLabel}>Approved by:</Text>
          <View style={styles.sigSpace} />
          <View style={styles.sigLine} />
          <Text style={styles.sigName}>{approvedByName}</Text>
          {approvedByTitle && <Text style={styles.sigDesignation}>{approvedByTitle}</Text>}
        </View>
      )}
    </>
  )
}

function formatVariance(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'On Plan'
  return days > 0 ? `+${days}d` : `${days}d`
}

function TextRow({ task, isCritical }: { task: ScheduleTask; isCritical: boolean }) {
  const duration = durationDays(task)
  const variance = taskBaselineVarianceDays(task)
  return (
    <View style={styles.tRow}>
      <Text style={[styles.td, styles.colCode]}>{task.activity_code ?? ''}</Text>
      <Text style={[styles.td, styles.colNameText]}>{task.name}</Text>
      <Text style={[styles.td, styles.colDate]}>{task.start_date}</Text>
      <Text style={[styles.td, styles.colDate]}>{task.end_date}</Text>
      <Text style={[styles.td, styles.colDur]}>{task.is_milestone ? '—' : `${duration}d`}</Text>
      <Text style={[styles.td, styles.colPct]}>{task.percent_complete}%</Text>
      <Text style={[styles.td, styles.colVariance, variance !== null && variance > 0 ? styles.delayedVariance : undefined]}>
        {formatVariance(variance)}
      </Text>
      <Text style={[styles.td, styles.colCritical, isCritical ? styles.critical : undefined]}>
        {isCritical ? 'Critical' : ''}
      </Text>
    </View>
  )
}

function ChartRow({
  task,
  rangeStart,
  totalDays,
  isCritical,
}: {
  task: ScheduleTask
  rangeStart: string
  totalDays: number
  isCritical: boolean
}) {
  const offsetDays = diffDays(rangeStart, task.start_date)
  const duration = durationDays(task)
  const leftPct = pct(offsetDays, totalDays)
  const widthPct = Math.max(pct(duration, totalDays), 1)
  const barColor = isCritical ? '#DC2626' : '#0E7C86'

  const hasBaseline = !task.is_milestone && task.baseline_start && task.baseline_end
  const baselineLeftPct = hasBaseline ? pct(diffDays(rangeStart, task.baseline_start!), totalDays) : 0
  const baselineWidthPct = hasBaseline
    ? Math.max(pct(diffDays(task.baseline_start!, task.baseline_end!) + 1, totalDays), 1)
    : 0

  return (
    <View style={styles.chartRow}>
      <Text style={[styles.td, styles.colNameChart]}>
        {truncateForChartRow(task.activity_code ? `${task.activity_code} ${task.name}` : task.name)}
      </Text>
      <View style={[styles.td, styles.colBarChart]}>
        <View style={styles.barTrack}>
          {hasBaseline && (
            <View style={[styles.baselineBar, { left: `${baselineLeftPct}%`, width: `${baselineWidthPct}%` }]} />
          )}
          {task.is_milestone ? (
            <View style={[styles.milestoneMarker, { left: `${leftPct}%`, backgroundColor: barColor }]} />
          ) : (
            <>
              <View
                style={[
                  styles.barFill,
                  {
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    backgroundColor: isCritical ? '#FEE2E2' : '#ECFEFF',
                    borderColor: barColor,
                  },
                ]}
              />
              <View
                style={[
                  styles.barProgress,
                  {
                    left: `${leftPct}%`,
                    width: `${(widthPct * Math.min(100, Math.max(0, task.percent_complete))) / 100}%`,
                    backgroundColor: barColor,
                  },
                ]}
              />
            </>
          )}
        </View>
      </View>
    </View>
  )
}

/** Total pixel height of the chart page's stacked module tables — shared by
 *  DependencyLines and DataDateLine so both overlays agree on how tall the
 *  page's SVG canvas is. */
function computeChartBodyHeight(moduleGroups: { module: string; tasks: ScheduleTask[] }[]): number {
  let cursorY = 0
  for (const group of moduleGroups) {
    cursorY += MODULE_TITLE_BLOCK_HEIGHT + 1 // title block + table's top border
    cursorY += group.tasks.length * CHART_ROW_HEIGHT
    cursorY += 1 // table's bottom border
  }
  return cursorY
}

/** Data Date vertical marker over the chart's bars — same fixed-geometry
 *  approach as DependencyLines below. */
function DataDateLine({
  moduleGroups,
  dataDate,
  rangeStart,
  totalDays,
}: {
  moduleGroups: { module: string; tasks: ScheduleTask[] }[]
  dataDate: string | null
  rangeStart: string
  totalDays: number
}) {
  if (!dataDate || dataDate < rangeStart) return null
  const totalHeight = computeChartBodyHeight(moduleGroups)
  const x = (pct(diffDays(rangeStart, dataDate), totalDays) / 100) * CHART_COL_WIDTH_PT
  if (x > CHART_COL_WIDTH_PT) return null

  return (
    <Svg
      style={{ position: 'absolute', top: 134, left: 28 + CHART_NAME_COL_WIDTH_PT, width: CHART_COL_WIDTH_PT, height: totalHeight }}
      viewBox={`0 0 ${CHART_COL_WIDTH_PT} ${totalHeight}`}
    >
      <Path d={`M${x},0 L${x},${totalHeight}`} stroke="#2563EB" strokeWidth={1} strokeDasharray="3 2" fill="none" />
    </Svg>
  )
}

/** Predecessor→successor connector lines over the chart's bars — the same
 *  elbow-with-arrowhead the web Gantt draws for dependency links. Every row's
 *  y is known in advance (module title + fixed-height rows, both constants
 *  above), which is what makes drawing a line across module boundaries
 *  possible without access to the PDF renderer's own layout pass. Confined
 *  to whichever page this renders on — a link into a task pushed onto a
 *  later page (an overflowing report) won't be connected, a fixed-page-size
 *  limitation with no photo-realistic alternative in a printed report. */
function DependencyLines({
  moduleGroups,
  dependencies,
  rangeStart,
  totalDays,
}: {
  moduleGroups: { module: string; tasks: ScheduleTask[] }[]
  dependencies: ScheduleDependency[]
  rangeStart: string
  totalDays: number
}) {
  const yById = new Map<string, number>()
  const taskById = new Map<string, ScheduleTask>()
  let cursorY = 0
  for (const group of moduleGroups) {
    cursorY += MODULE_TITLE_BLOCK_HEIGHT + 1 // title block + table's top border
    for (const task of group.tasks) {
      taskById.set(task.id, task)
      yById.set(task.id, cursorY + CHART_ROW_HEIGHT / 2)
      cursorY += CHART_ROW_HEIGHT
    }
    cursorY += 1 // table's bottom border
  }
  const totalHeight = cursorY

  const links = dependencies
    .map((dep) => {
      const predTask = taskById.get(dep.predecessor_id)
      const succTask = taskById.get(dep.successor_id)
      const y1 = yById.get(dep.predecessor_id)
      const y2 = yById.get(dep.successor_id)
      if (!predTask || !succTask || y1 === undefined || y2 === undefined) return null
      const x1 = (pct(diffDays(rangeStart, predTask.end_date) + 1, totalDays) / 100) * CHART_COL_WIDTH_PT
      const x2 = (pct(diffDays(rangeStart, succTask.start_date), totalDays) / 100) * CHART_COL_WIDTH_PT
      const midX = x1 + 10
      return { id: dep.id, x1, y1, midX, x2, y2 }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)

  if (links.length === 0) return null

  return (
    <Svg
      style={{ position: 'absolute', top: 134, left: 28 + CHART_NAME_COL_WIDTH_PT, width: CHART_COL_WIDTH_PT, height: totalHeight }}
      viewBox={`0 0 ${CHART_COL_WIDTH_PT} ${totalHeight}`}
    >
      {links.map((l) => (
        <Path
          key={l.id}
          d={`M${l.x1},${l.y1} L${l.midX},${l.y1} L${l.midX},${l.y2} L${l.x2},${l.y2}`}
          stroke="#94A3B8"
          strokeWidth={1}
          fill="none"
        />
      ))}
      {links.map((l) => (
        <Polygon
          key={`${l.id}-arrow`}
          points={`${l.x2},${l.y2} ${l.x2 - 6},${l.y2 - 3} ${l.x2 - 6},${l.y2 + 3}`}
          fill="#94A3B8"
        />
      ))}
    </Svg>
  )
}

export function SchedulePdfDocument({
  generatedDate,
  projectName,
  projectLocation,
  scopeOfWork,
  revision,
  dataDate,
  targetCompletion,
  forecastFinish,
  targetVarianceDays,
  scheduleHealth,
  preparedByName,
  preparedByDesignation,
  approvedByName,
  approvedByTitle,
  moduleGroups,
  dependencies,
  rangeStart,
  totalDays,
  criticalIds,
  totalTasks,
  milestoneCount,
  overallPercent,
}: {
  generatedDate: string
  projectName: string
  projectLocation: string | null
  scopeOfWork: string | null
  revision: string
  dataDate: string | null
  targetCompletion: string | null
  forecastFinish: string | null
  targetVarianceDays: number | null
  scheduleHealth: ScheduleHealth
  preparedByName: string | null
  preparedByDesignation: string | null
  approvedByName: string | null
  approvedByTitle: string | null
  moduleGroups: { module: string; tasks: ScheduleTask[] }[]
  dependencies: ScheduleDependency[]
  rangeStart: string
  totalDays: number
  criticalIds: Set<string>
  totalTasks: number
  milestoneCount: number
  overallPercent: number
}) {
  const hasBaseline = moduleGroups.some((g) => g.tasks.some((t) => t.baseline_start && t.baseline_end))
  const healthStyle =
    scheduleHealth === 'on_track' ? styles.healthOnTrack : scheduleHealth === 'watch' ? styles.healthWatch : styles.healthAtRisk
  return (
    <Document title="Project Schedule">
      {/* Page 1 — schedule as text: every task's dates, duration, % complete,
          and critical-path flag, with no bar chart competing for space. */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        <ReportHeader generatedDate={generatedDate} />
        <ReportFooter />

        <View style={styles.projectBlock}>
          <Text style={styles.projectName}>{projectName}</Text>
          {projectLocation && (
            <Text style={styles.projectMeta}>
              <Text style={styles.projectMetaLabel}>Location: </Text>
              {projectLocation}
            </Text>
          )}
          {scopeOfWork && (
            <Text style={styles.projectMeta}>
              <Text style={styles.projectMetaLabel}>Scope of Work: </Text>
              {scopeOfWork}
            </Text>
          )}
          <Text style={styles.projectMeta}>
            <Text style={styles.projectMetaLabel}>Revision: </Text>
            {revision}
            {dataDate ? `   ·   Data Date: ${dataDate}` : ''}
            {targetCompletion ? `   ·   Target Completion: ${targetCompletion}` : ''}
          </Text>
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Tasks</Text>
            <Text style={styles.statValue}>{totalTasks}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Milestones</Text>
            <Text style={styles.statValue}>{milestoneCount}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Overall Progress</Text>
            <Text style={styles.statValue}>{Math.round(overallPercent)}%</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Critical Path Tasks</Text>
            <Text style={styles.statValue}>{criticalIds.size}</Text>
          </View>
        </View>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Forecast Finish</Text>
            <Text style={styles.statValue}>{forecastFinish ?? '—'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Target Completion</Text>
            <Text style={styles.statValue}>{targetCompletion ?? '—'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Variance vs. Target</Text>
            <Text style={styles.statValue}>{formatVariance(targetVarianceDays)}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Schedule Health</Text>
            <Text style={[styles.statValue, healthStyle]}>{SCHEDULE_HEALTH_LABELS[scheduleHealth]}</Text>
          </View>
        </View>

        {moduleGroups.map((group) => (
          <View key={group.module} wrap={false}>
            <Text style={styles.moduleTitle}>
              {group.module} ({group.tasks.length})
            </Text>
            <View style={styles.table}>
              <View style={styles.tHeadRow}>
                <Text style={[styles.th, styles.colCode]}>ID</Text>
                <Text style={[styles.th, styles.colNameText]}>Task</Text>
                <Text style={[styles.th, styles.colDate]}>Start</Text>
                <Text style={[styles.th, styles.colDate]}>Finish</Text>
                <Text style={[styles.th, styles.colDur]}>Duration</Text>
                <Text style={[styles.th, styles.colPct]}>Complete</Text>
                <Text style={[styles.th, styles.colVariance]}>Variance</Text>
                <Text style={[styles.th, styles.colCritical]}>Path</Text>
              </View>
              {group.tasks.map((task) => (
                <TextRow key={task.id} task={task} isCritical={criticalIds.has(task.id)} />
              ))}
            </View>
          </View>
        ))}
      </Page>

      {/* Page 2 — the Gantt bar chart, given the full page width now that it
          isn't squeezed next to five other columns. A single date axis spans
          the whole page (and repeats on every continuation page) instead of
          each module repeating its own "Task | Timeline" header, so the
          chart reads as one continuous picture with the start and finish
          dates always visible at a glance. */}
      <Page size="A4" orientation="landscape" style={[styles.page, styles.pageWithAxis]}>
        <ReportHeader generatedDate={generatedDate} />
        <ReportFooter />
        <ChartPageHeader
          projectName={projectName}
          rangeStart={rangeStart}
          totalDays={totalDays}
          hasBaseline={hasBaseline}
          hasDataDate={!!dataDate}
        />

        {moduleGroups.map((group) => (
          <View key={group.module} wrap={false}>
            <Text style={styles.moduleTitle}>
              {group.module} ({group.tasks.length})
            </Text>
            <View style={styles.table}>
              {group.tasks.map((task) => (
                <ChartRow
                  key={task.id}
                  task={task}
                  rangeStart={rangeStart}
                  totalDays={totalDays}
                  isCritical={criticalIds.has(task.id)}
                />
              ))}
            </View>
          </View>
        ))}

        <DataDateLine moduleGroups={moduleGroups} dataDate={dataDate} rangeStart={rangeStart} totalDays={totalDays} />
        <DependencyLines moduleGroups={moduleGroups} dependencies={dependencies} rangeStart={rangeStart} totalDays={totalDays} />

        <SignatureBlocks
          preparedByName={preparedByName}
          preparedByDesignation={preparedByDesignation}
          approvedByName={approvedByName}
          approvedByTitle={approvedByTitle}
        />
      </Page>
    </Document>
  )
}
