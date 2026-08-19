import { useState, useEffect, useMemo } from "react"
import { C } from "./reportUtils.js"

// The 6 new timing columns this tab exists to surface -- guaranteed
// present regardless of what the backend's df otherwise contains (the
// endpoint computes these itself, so they should always be there, but
// this is a defensive floor in case that ever changes).
const TIMING_COLUMNS = [
  'video_created_time', 'encode_manifest_updated_time', 'overall_content_processing_time',
  'encode_index_video_created_time', 'encode_media_cmfv_updated_time', 'video_processing_time',
]

// Normalizes a key for comparison -- lowercase, strip spaces/underscores
// entirely. "content_id", "Content ID", "contentid" all normalize to the
// same string. Needed because build_df_from_db_sources renames SOME
// columns from snake_case to "Title Case With Spaces" (confirmed:
// content_key -> 'Content Key') but not others -- this makes lookups
// work regardless of which convention any given column actually uses.
function normalizeKey(k) { return k.toLowerCase().replace(/[\s_]/g, '') }

// Internal boolean flags used only to compute the Summary tab's
// aggregate counts (published/archived/purged/draft x airing/manual x
// L2V breakdowns) -- not meaningful as a per-row data column here, so
// excluded regardless of what casing/spacing convention the backend
// happens to use for any of them.
const EXCLUDED_COLUMNS = [
  'is_airing', 'is_no_video', 'is_published', 'is_archived', 'is_purged', 'is_draft',
  'is_manual', 'is_manual_total', 'is_l2v', 'is_l2v_published', 'is_l2v_archived',
  'is_l2v_purged', 'is_l2v_draft', 'is_manual_archived', 'is_manual_purged', 'is_manual_draft',
].map(normalizeKey)

function getVal(row, targetKey) {
  if (row[targetKey] !== undefined) return row[targetKey]
  const normTarget = normalizeKey(targetKey)
  for (const k of Object.keys(row)) {
    if (normalizeKey(k) === normTarget) return row[k]
  }
  return undefined
}

// Turns a raw column name into a readable label -- if it already looks
// like "Content ID" (has a space or a capital letter), leave it alone;
// otherwise treat it as snake_case and title-case it with spaces.
function formatLabel(key) {
  if (/[\sA-Z]/.test(key)) return key
  return key.split('_').map(w => w === 'id' ? 'ID' : w === 'cmfv' ? 'CMFV' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const STATUS_VALUES = ['published', 'draft', 'archived', 'purged']
function normalizeStatus(raw) {
  const v = String(raw ?? '').trim().toLowerCase()
  return STATUS_VALUES.includes(v) ? v : 'unknown'
}
const STATUS_COLOR = { published: '#1E7E34', draft: '#B8860B', archived: '#922B21', purged: '#4D4D4D', unknown: '#5a6a8a' }

function csvEscape(val) {
  const s = String(val ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export default function ContentListTab({ apiBase, jobId }) {
  const [rows, setRows] = useState(null)
  const [allColumns, setAllColumns] = useState([])   // every real column from the backend, in order
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedCols, setSelectedCols] = useState([])
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [filterText, setFilterText] = useState('')

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
      .then(data => {
        if (cancelled) return
        setRows(data.rows)
        // Full column set from the backend, PLUS the 6 timing columns as
        // a guaranteed floor -- "show ALL columns from the report by
        // default, plus these" is exactly what this default selection
        // needs to be, not a curated subset.
        const cols = [...new Set([...(data.columns || []), ...TIMING_COLUMNS])]
          .filter(c => !EXCLUDED_COLUMNS.includes(normalizeKey(c)))
        setAllColumns(cols)
        setSelectedCols(cols)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [apiBase, jobId])

  const filteredRows = useMemo(() => {
    if (!rows) return []
    if (!filterText.trim()) return rows
    const needle = filterText.trim().toLowerCase()
    return rows.filter(r => selectedCols.some(col => String(getVal(r, col) ?? '').toLowerCase().includes(needle)))
  }, [rows, filterText, selectedCols])

  const downloadCsv = () => {
    const header = selectedCols.map(formatLabel)
    const lines = [header.map(csvEscape).join(',')]
    for (const r of filteredRows) {
      lines.push(selectedCols.map(key => csvEscape(getVal(r, key) ?? '')).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `content-list-${jobId}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

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
        <span style={{ fontSize: 12, color: C.muted }}>{filteredRows.length} of {rows.length} rows -- all statuses combined</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button onClick={downloadCsv} style={btnStyle(false)}>⬇ Download CSV</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowColumnPicker(v => !v)} style={btnStyle(selectedCols.length !== allColumns.length)}>
              {selectedCols.length} of {allColumns.length} columns shown ▾
            </button>
            {showColumnPicker && (
              <div style={{
                position: 'absolute', top: '110%', right: 0, zIndex: 50, width: 300, maxHeight: 340, overflowY: 'auto',
                background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', marginBottom: 8 }}>Columns</div>
                {allColumns.map(key => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedCols.includes(key)}
                      onChange={e => setSelectedCols(prev => e.target.checked ? [...prev, key] : prev.filter(k => k !== key))}
                    />
                    {formatLabel(key)}
                    {TIMING_COLUMNS.includes(key) && <span style={{ fontSize: 10, color: C.blue, marginLeft: 4 }}>(new)</span>}
                  </label>
                ))}
                <div style={{ display: 'flex', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                  <button onClick={() => setSelectedCols(allColumns)} style={{ fontSize: 11, color: C.blue, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Select all</button>
                  <button onClick={() => setSelectedCols([])} style={{ fontSize: 11, color: C.muted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 10, border: `1px solid ${C.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {selectedCols.map(key => (
                <th key={key} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: `1px solid ${C.border}`, background: C.bg, whiteSpace: 'nowrap' }}>
                  {formatLabel(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r, i) => {
              const status = normalizeStatus(getVal(r, 'vod_cms_status'))
              return (
                <tr key={i}>
                  {selectedCols.map((key, ci) => {
                    const val = getVal(r, key)
                    return (
                      <td key={key} style={{ padding: '7px 12px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap', color: val == null ? '#cbd5e1' : C.text }}>
                        {ci === 0 && <span title={status} style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[status], marginRight: 7 }} />}
                        {val ?? '—'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
