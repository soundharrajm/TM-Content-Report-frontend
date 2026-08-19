import { useState, useEffect, useMemo } from "react"
import { C } from "./reportUtils.js"

// The six timing columns this tab exists to surface, plus the core
// identifying columns every row needs regardless, and the status field
// itself (vod_cms_status -- confirmed as the actual field name/values
// via reportUtils.js's own local-parsing fallback logic: lowercase
// 'published'/'draft'/'archived'/'purged'). Timing columns are computed
// server-side in content_report_routes.py's /content-list endpoint,
// directly from the raw timestamps already selected in mysql_source.py's
// build_video_index_query.
const ALL_COLUMNS = [
  ['content_id', 'Content ID'],
  ['content_key', 'Content Key'],
  ['content_title', 'Content Title'],
  ['content_type', 'Content Type'],
  ['vod_cms_status', 'Status'],
  ['external_id', 'External ID'],
  ['cp_name', 'CP Name'],
  ['status', 'Encode Status'],
  ['video_file_name', 'Video File Name'],
  ['resolution', 'Resolution'],
  ['duration', 'Duration'],
  ['video_created_time', 'Video Created Time'],
  ['encode_manifest_updated_time', 'Encode Manifest Updated Time'],
  ['overall_content_processing_time', 'Overall Content Processing Time'],
  ['encode_index_video_created_time', 'Encode Index Video Created Time'],
  ['encode_media_cmfv_updated_time', 'Encode Media CMFV Updated Time'],
  ['video_processing_time', 'Video Processing Time'],
]

// Default selection -- the requested 9 columns: 3 identifying + the 6
// timing columns this tab exists for.
const DEFAULT_SELECTED = [
  'content_id', 'content_title', 'content_type',
  'video_created_time', 'encode_manifest_updated_time', 'overall_content_processing_time',
  'encode_index_video_created_time', 'encode_media_cmfv_updated_time', 'video_processing_time',
]

// Fixed display order -- 'unknown' catches anything that's null, empty,
// or genuinely doesn't match one of the four real statuses, so a row
// never silently disappears just because its status value is unexpected.
const STATUS_ORDER = ['published', 'draft', 'archived', 'purged', 'unknown']
const STATUS_LABEL = { published: 'Published', draft: 'Draft', archived: 'Archived', purged: 'Purged', unknown: 'Unknown / Missing Status' }
const STATUS_COLOR = { published: '#1E7E34', draft: '#B8860B', archived: '#922B21', purged: '#4D4D4D', unknown: '#5a6a8a' }

function normalizeStatus(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  return STATUS_ORDER.includes(v) ? v : 'unknown'
}

export default function ContentListTab({ apiBase, jobId }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedCols, setSelectedCols] = useState(DEFAULT_SELECTED)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [filterText, setFilterText] = useState('')
  // All expanded by default -- "include all status" means every group is
  // visible without needing to click anything first; collapsing is just
  // an option for once there's a lot to scroll past.
  const [collapsed, setCollapsed] = useState({})

  useEffect(() => {
    if (!jobId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${apiBase}/content-list/${jobId}`, { headers: { 'ngrok-skip-browser-warning': '1' } })
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.detail || 'Failed to load content list')
        return data
      })
      .then(data => { if (!cancelled) setRows(data.rows) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiBase, jobId])

  const filteredRows = useMemo(() => {
    if (!rows) return []
    if (!filterText.trim()) return rows
    const needle = filterText.trim().toLowerCase()
    return rows.filter(r => selectedCols.some(col => String(r[col] ?? '').toLowerCase().includes(needle)))
  }, [rows, filterText, selectedCols])

  // Groups by status -- ALL statuses included, nothing filtered out by
  // default. A row with a missing/unrecognized status lands in 'unknown'
  // rather than being silently dropped.
  const grouped = useMemo(() => {
    const g = { published: [], draft: [], archived: [], purged: [], unknown: [] }
    for (const r of filteredRows) g[normalizeStatus(r.vod_cms_status)].push(r)
    return g
  }, [filteredRows])

  const btnStyle = (active) => ({
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    border: active ? `1.5px solid ${C.blue}` : `1px solid ${C.border}`,
    background: active ? 'rgba(46,117,182,0.08)' : '#fff',
    color: active ? C.blue : C.muted,
  })

  if (!jobId) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No report generated yet.</div>
  }
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>Loading content list…</div>
  }
  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.archived, fontSize: 13 }}>⚠ {error}</div>
  }
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13 }}>No rows found for this report.</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Filter rows…"
          style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: 'inherit', width: 240 }}
        />
        <span style={{ fontSize: 12, color: C.muted }}>{filteredRows.length} of {rows.length} rows</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button onClick={() => setShowColumnPicker(v => !v)} style={btnStyle(selectedCols.length !== DEFAULT_SELECTED.length)}>
            {selectedCols.length} column{selectedCols.length === 1 ? '' : 's'} shown ▾
          </button>
          {showColumnPicker && (
            <div style={{
              position: 'absolute', top: '110%', right: 0, zIndex: 50, width: 300, maxHeight: 340, overflowY: 'auto',
              background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Columns</div>
              {ALL_COLUMNS.map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(key)}
                    onChange={e => setSelectedCols(prev => e.target.checked ? [...prev, key] : prev.filter(k => k !== key))}
                  />
                  {label}
                </label>
              ))}
              <div style={{ display: 'flex', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                <button onClick={() => setSelectedCols(ALL_COLUMNS.map(([k]) => k))} style={{ fontSize: 11, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Select all</button>
                <button onClick={() => setSelectedCols(DEFAULT_SELECTED)} style={{ fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Reset to default</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {STATUS_ORDER.map(status => {
        const statusRows = grouped[status]
        if (statusRows.length === 0) return null   // nothing to show for THIS status given the current filter -- not the same as excluding the status itself
        const isCollapsed = !!collapsed[status]
        return (
          <div key={status} style={{ marginBottom: 16, background: '#fff', borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
            <div
              onClick={() => setCollapsed(prev => ({ ...prev, [status]: !prev[status] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: C.bg, borderBottom: isCollapsed ? 'none' : `1px solid ${C.border}` }}
            >
              <span style={{ fontSize: 11, color: C.muted, display: 'inline-block', width: 12 }}>{isCollapsed ? '▸' : '▾'}</span>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLOR[status], flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{STATUS_LABEL[status]}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{statusRows.length} row{statusRows.length === 1 ? '' : 's'}</span>
            </div>
            {!isCollapsed && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {selectedCols.map(key => {
                        const label = ALL_COLUMNS.find(([k]) => k === key)?.[1] || key
                        return (
                          <th key={key} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: `1px solid ${C.border}`, background: '#fafbfd', whiteSpace: 'nowrap' }}>
                            {label}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {statusRows.map((r, i) => (
                      <tr key={i}>
                        {selectedCols.map(key => (
                          <td key={key} style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', color: r[key] == null ? '#cbd5e1' : C.text }}>
                            {r[key] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
