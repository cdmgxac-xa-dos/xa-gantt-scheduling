import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ScheduleTask } from '@/types'
import { diffDays, durationDays } from '@/lib/scheduleEngine'

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 90,
    paddingHorizontal: 28,
    fontSize: 8,
    fontFamily: 'Helvetica',
    color: '#0F172A',
  },
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
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#475569', padding: 4, textTransform: 'uppercase' },
  td: { fontSize: 7.5, padding: 4, color: '#0F172A' },
  colNameText: { width: '32%' },
  colDate: { width: '14%' },
  colDur: { width: '12%', textAlign: 'center' },
  colPct: { width: '12%', textAlign: 'center' },
  colCritical: { width: '16%', textAlign: 'center' },
  colNameChart: { width: '22%' },
  colBarChart: { width: '78%', paddingVertical: 6 },
  critical: { color: '#DC2626', fontFamily: 'Helvetica-Bold' },
  barTrack: { height: 10, position: 'relative' },
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
  signatureBlock: { position: 'absolute', left: 28, bottom: 24, width: 200 },
  signatureBlockRight: { position: 'absolute', right: 28, bottom: 24, width: 200, alignItems: 'flex-end' },
  sigLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginBottom: 4 },
  sigSpace: { height: 34 },
  sigLine: { width: 180, borderTopWidth: 1, borderTopColor: '#0F172A' },
  sigName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginTop: 4 },
  sigDesignation: { fontSize: 8, color: '#475569', marginTop: 1 },
})

function pct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.max(0, Math.min(100, (numerator / denominator) * 100)) : 0
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

function TextRow({ task, isCritical }: { task: ScheduleTask; isCritical: boolean }) {
  const duration = durationDays(task)
  return (
    <View style={styles.tRow}>
      <Text style={[styles.td, styles.colNameText]}>{task.name}</Text>
      <Text style={[styles.td, styles.colDate]}>{task.start_date}</Text>
      <Text style={[styles.td, styles.colDate]}>{task.end_date}</Text>
      <Text style={[styles.td, styles.colDur]}>{task.is_milestone ? '—' : `${duration}d`}</Text>
      <Text style={[styles.td, styles.colPct]}>{task.percent_complete}%</Text>
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

  return (
    <View style={styles.tRow}>
      <Text style={[styles.td, styles.colNameChart]}>{task.name}</Text>
      <View style={[styles.td, styles.colBarChart]}>
        <View style={styles.barTrack}>
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

export function SchedulePdfDocument({
  generatedDate,
  projectName,
  projectLocation,
  scopeOfWork,
  preparedByName,
  preparedByDesignation,
  approvedByName,
  approvedByTitle,
  moduleGroups,
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
  preparedByName: string | null
  preparedByDesignation: string | null
  approvedByName: string | null
  approvedByTitle: string | null
  moduleGroups: { module: string; tasks: ScheduleTask[] }[]
  rangeStart: string
  totalDays: number
  criticalIds: Set<string>
  totalTasks: number
  milestoneCount: number
  overallPercent: number
}) {
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

        {moduleGroups.map((group) => (
          <View key={group.module} wrap={false}>
            <Text style={styles.moduleTitle}>
              {group.module} ({group.tasks.length})
            </Text>
            <View style={styles.table}>
              <View style={styles.tHeadRow}>
                <Text style={[styles.th, styles.colNameText]}>Task</Text>
                <Text style={[styles.th, styles.colDate]}>Start</Text>
                <Text style={[styles.th, styles.colDate]}>Finish</Text>
                <Text style={[styles.th, styles.colDur]}>Duration</Text>
                <Text style={[styles.th, styles.colPct]}>Complete</Text>
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
          isn't squeezed next to five other columns. */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        <ReportHeader generatedDate={generatedDate} />
        <ReportFooter />

        <View style={styles.projectBlock}>
          <Text style={styles.pageKicker}>Gantt Timeline</Text>
          <Text style={styles.projectName}>{projectName}</Text>
        </View>

        {moduleGroups.map((group) => (
          <View key={group.module} wrap={false}>
            <Text style={styles.moduleTitle}>
              {group.module} ({group.tasks.length})
            </Text>
            <View style={styles.table}>
              <View style={styles.tHeadRow}>
                <Text style={[styles.th, styles.colNameChart]}>Task</Text>
                <Text style={[styles.th, styles.colBarChart]}>Timeline (milestones marked, red = critical path)</Text>
              </View>
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
