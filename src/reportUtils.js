// ── Shared constants + helpers for the Content Reports dashboard ───────────────

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE
  || 'https://womanless-spent-scale.ngrok-free.dev'

const C = {
  navy:'#1F3864',blue:'#2E75B6',teal:'#0D7377',
  amber:'#BF8F00',purple:'#6B35A0',green:'#1E7E34',
  archived:'#922B21',purged:'#4D4D4D',draft:'#B8860B',
  bg:'#F0F4FA',card:'#FFFFFF',border:'#D0DAF0',
  text:'#1a1a2e',muted:'#5a6a8a',
}
const CONTENT_TYPES = ['Movie','Event','Trailer','Series','Season','Episode']

// ── Fallback: parse locally if backend unavailable ─────────────────────────
const CT_MAP = {tvepisode:'Episode',movie:'Movie',trailer:'Trailer',event:'Event',tvseries:'Series',tvseason:'Season'}
const round = (v,dp=2) => Math.round(v*10**dp)/10**dp

function formatDateCol(iso) {
  const d = new Date(iso+'T00:00:00')
  return `${d.getDate()}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}`
}

// ── Column normalization — case & separator insensitive ────────────────────────
const normKey = s => String(s).trim().toLowerCase().replace(/[\s_-]/g,'')
const CANONICAL_COLUMNS = {
  contentkey:'Content Key', contentid:'Content ID', contenttype:'Content Type',
  externalid:'external_id', vodcmsstatus:'vod_cms_status', status:'status',
  title:'Title', contenttitle:'Title', duration:'duration', durationhrs:'_duration_hrs',
}
// Date column: prefer metadata_created_date over created_date if both are present
const DATE_COLUMN_PRIORITY = ['metadatacreateddate', 'createddate']

function normalizeRow(r) {
  const out = {...r}
  const keys = Object.keys(r)
  const keyNorms = keys.map(k=>({k, n:normKey(k)}))

  // Date column — pick metadata_created_date first, fall back to created_date
  for (const candidate of DATE_COLUMN_PRIORITY) {
    const match = keyNorms.find(({n})=>n===candidate)
    if (match) { out['Created Date'] = r[match.k]; break }
  }

  // Everything else
  keyNorms.forEach(({k,n})=>{
    if (DATE_COLUMN_PRIORITY.includes(n)) return
    const canon = CANONICAL_COLUMNS[n]
    if (canon && !(canon in out)) out[canon] = r[k]
  })
  return out
}

function parseLocally(rows) {
  // ── Exclude rows where processing failed — not counted anywhere in the report ──
  const rowsFiltered = rows.filter(rawRow => {
    const normalized = normalizeRow(rawRow)
    const statusVal  = String(normalized['status']||'').trim().toLowerCase()
    return !statusVal.includes('fail')
  })
  if (rowsFiltered.length !== rows.length) {
    console.log(`[Filter] Excluding ${rows.length - rowsFiltered.length} row(s) with failed processing status`)
  }

  const df = rowsFiltered.map(rawRow => {
    const r = normalizeRow(rawRow)
    const created  = r['Created Date'] ? new Date(r['Created Date']) : null
    const dateStr  = created ? created.toISOString().split('T')[0] : null
    const extId    = String(r['external_id']||'').trim().toLowerCase()
    const isAiring = extId.startsWith('airing-')
    const ct       = CT_MAP[String(r['Content Type']||'').toLowerCase()] || r['Content Type']
    const vcs      = String(r['vod_cms_status']||'').trim().toLowerCase()
    const isNoVid  = ['Series','Season'].includes(ct)
    const isPub    = vcs === 'published'
    const isArch   = vcs === 'archived'
    const isPurged = vcs === 'purged'
    const isDraft  = vcs === 'draft'
    const isManual = !isAiring && isPub
    const isL2V    = isAiring && (isPub || isArch || isPurged || isDraft)
    // Duration: _duration_hrs (hours) OR duration (seconds auto-converted)
    const durHrs = isNoVid ? 0
      : r['_duration_hrs']  ? parseFloat(r['_duration_hrs']||0)
      : r['duration']       ? parseFloat(r['duration']||0) / 3600
      : 0
    return {...r, date:dateStr, ct, vcs, isAiring, isPub, isArch, isPurged, isDraft, isManual, isL2V, durHrs}
  })

  const pub  = df.filter(r=>r.isPub)
  const man  = df.filter(r=>r.isManual)              // manual, published only
  const manTotal = df.filter(r=>!r.isAiring && (r.isPub || r.isArch || r.isPurged || r.isDraft))  // mirrors L2V's l2v filter
  const l2v  = df.filter(r=>r.isL2V)
  const l2vPub  = df.filter(r=>r.isAiring && r.isPub)
  const l2vArch = df.filter(r=>r.isAiring && r.isArch)
  const l2vPrg  = df.filter(r=>r.isAiring && r.isPurged)
  const l2vDraft = df.filter(r=>r.isAiring && r.isDraft)
  const manArch = df.filter(r=>!r.isAiring && r.isArch)
  const manPrg  = df.filter(r=>!r.isAiring && r.isPurged)
  const manDraft = df.filter(r=>!r.isAiring && r.isDraft)
  // Total Published = Manual Insertion Published + L2V Published (explicit sum)
  const totalContent = man.length + l2vPub.length
  const totalHours   = round(man.reduce((s,r)=>s+r.durHrs,0) + l2vPub.reduce((s,r)=>s+r.durHrs,0))
  // Total Archived/Purged = Manual + L2V breakdown (explicit sum)
  const archContent = manArch.length + l2vArch.length
  const archHours   = round(manArch.reduce((s,r)=>s+r.durHrs,0) + l2vArch.reduce((s,r)=>s+r.durHrs,0))
  const prgContent  = manPrg.length + l2vPrg.length
  const prgHours    = round(manPrg.reduce((s,r)=>s+r.durHrs,0) + l2vPrg.reduce((s,r)=>s+r.durHrs,0))
  const draftContent = manDraft.length + l2vDraft.length
  const draftHours    = round(manDraft.reduce((s,r)=>s+r.durHrs,0) + l2vDraft.reduce((s,r)=>s+r.durHrs,0))
  // Known types first (stable order), then any NEW type found in the data
  // that isn't in CT_MAP/CONTENT_TYPES — so it shows up automatically
  // instead of being silently excluded.
  const detectedExtraTypes = [...new Set(df.map(r=>r.ct))]
    .filter(ct => ct && !CONTENT_TYPES.includes(ct)).sort()
  const reportTypes = [...CONTENT_TYPES, ...detectedExtraTypes]
  const allDates = [...new Set(df.map(r=>r.date).filter(Boolean))].sort()
  const dateCols  = allDates.map(formatDateCol)

  const metrics = ['Total Published Content','Total Published Hours',
    ...reportTypes,'Manual Content','Manual Hours',
    'Manual Published Content','Manual Published Hours',
    'Manual Archived Content','Manual Archived Hours','Manual Purged Content','Manual Purged Hours',
    'Manual Draft Content','Manual Draft Hours',
    'L2V Content','L2V Hours',
    'L2V Published Content','L2V Published Hours','L2V Archived Content','L2V Archived Hours',
    'L2V Purged Content','L2V Purged Hours','L2V Draft Content','L2V Draft Hours',
    'Archived Content','Archived Hours','Purged Content','Purged Hours','Draft Content','Draft Hours']
  const datewise = {}
  metrics.forEach(m=>{datewise[m]={}})
  allDates.forEach((d,i)=>{
    const col    = dateCols[i]
    const dayPub  = pub.filter(r=>r.date===d)
    const dayMan  = man.filter(r=>r.date===d)
    const dayManTotal = manTotal.filter(r=>r.date===d)
    const dayL2V  = l2v.filter(r=>r.date===d)
    const dayL2VPub  = l2vPub.filter(r=>r.date===d)
    const dayL2VArch = l2vArch.filter(r=>r.date===d)
    const dayL2VPrg  = l2vPrg.filter(r=>r.date===d)
    const dayManArch = manArch.filter(r=>r.date===d)
    const dayManPrg  = manPrg.filter(r=>r.date===d)
    const dayManDraft = manDraft.filter(r=>r.date===d)
    const dayL2VDraft = l2vDraft.filter(r=>r.date===d)
    // Total Published per day = Manual Insertion Published + L2V Published (explicit sum)
    datewise['Total Published Content'][col] = dayMan.length + dayL2VPub.length
    datewise['Total Published Hours'][col]   = round(dayMan.reduce((s,r)=>s+r.durHrs,0) + dayL2VPub.reduce((s,r)=>s+r.durHrs,0))
    reportTypes.forEach(ct=>{datewise[ct][col]=dayPub.filter(r=>r.ct===ct).length})
    // Manual Insertion — mirrors L2V's structure: total (any status), then published/archived/purged
    datewise['Manual Content'][col] = dayManTotal.length
    datewise['Manual Hours'][col]   = round(dayManTotal.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Published Content'][col] = dayMan.length
    datewise['Manual Published Hours'][col]   = round(dayMan.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Archived Content'][col] = dayManArch.length
    datewise['Manual Archived Hours'][col]   = round(dayManArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Purged Content'][col]   = dayManPrg.length
    datewise['Manual Purged Hours'][col]     = round(dayManPrg.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Draft Content'][col]    = dayManDraft.length
    datewise['Manual Draft Hours'][col]      = round(dayManDraft.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Content'][col]    = dayL2V.length
    datewise['L2V Hours'][col]      = round(dayL2V.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Published Content'][col] = dayL2VPub.length
    datewise['L2V Published Hours'][col]   = round(dayL2VPub.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Archived Content'][col]  = dayL2VArch.length
    datewise['L2V Archived Hours'][col]    = round(dayL2VArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Purged Content'][col]    = dayL2VPrg.length
    datewise['L2V Purged Hours'][col]      = round(dayL2VPrg.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Draft Content'][col]     = dayL2VDraft.length
    datewise['L2V Draft Hours'][col]       = round(dayL2VDraft.reduce((s,r)=>s+r.durHrs,0))
    // Total Archived/Purged/Draft per day = Manual + L2V breakdown (explicit sum)
    datewise['Archived Content'][col] = dayManArch.length + dayL2VArch.length
    datewise['Archived Hours'][col]   = round(dayManArch.reduce((s,r)=>s+r.durHrs,0) + dayL2VArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['Purged Content'][col]   = dayManPrg.length + dayL2VPrg.length
    datewise['Purged Hours'][col]     = round(dayManPrg.reduce((s,r)=>s+r.durHrs,0) + dayL2VPrg.reduce((s,r)=>s+r.durHrs,0))
    datewise['Draft Content'][col]    = dayManDraft.length + dayL2VDraft.length
    datewise['Draft Hours'][col]      = round(dayManDraft.reduce((s,r)=>s+r.durHrs,0) + dayL2VDraft.reduce((s,r)=>s+r.durHrs,0))
  })

  const byType      = {}
  const byTypeHours = {}
  reportTypes.forEach(ct=>{
    byType[ct]      = pub.filter(r=>r.ct===ct).length
    byTypeHours[ct] = round(pub.filter(r=>r.ct===ct).reduce((s,r)=>s+r.durHrs,0))
  })

  return {
    duration_source: df.some(r=>r.durHrs>0) ? (rows[0]?.duration && !rows[0]?._duration_hrs ? 'local_file_seconds' : 'local_file') : 'none',
    has_local_duration: df.some(r=>r.durHrs>0),
    summary: {
      total_content: totalContent, total_hours: totalHours,
      by_type: byType, by_type_hours: byTypeHours,
      manual_content: manTotal.length, manual_hours: round(manTotal.reduce((s,r)=>s+r.durHrs,0)),
      manual_published_content: man.length, manual_published_hours: round(man.reduce((s,r)=>s+r.durHrs,0)),
      manual_archived_content: manArch.length, manual_archived_hours: round(manArch.reduce((s,r)=>s+r.durHrs,0)),
      manual_purged_content:   manPrg.length,  manual_purged_hours:   round(manPrg.reduce((s,r)=>s+r.durHrs,0)),
      manual_draft_content:    manDraft.length, manual_draft_hours:   round(manDraft.reduce((s,r)=>s+r.durHrs,0)),
      l2v_content: l2v.length,   l2v_hours:    round(l2v.reduce((s,r)=>s+r.durHrs,0)),
      l2v_published_content: l2vPub.length,  l2v_published_hours: round(l2vPub.reduce((s,r)=>s+r.durHrs,0)),
      l2v_archived_content:  l2vArch.length, l2v_archived_hours:  round(l2vArch.reduce((s,r)=>s+r.durHrs,0)),
      l2v_purged_content:    l2vPrg.length,  l2v_purged_hours:    round(l2vPrg.reduce((s,r)=>s+r.durHrs,0)),
      l2v_draft_content:     l2vDraft.length, l2v_draft_hours:    round(l2vDraft.reduce((s,r)=>s+r.durHrs,0)),
      archived_content: archContent, archived_hours: archHours,
      purged_content:   prgContent,  purged_hours:   prgHours,
      draft_content:    draftContent, draft_hours:   draftHours,
      dvb_content: 0,  dvb_hours: 0,  // placeholder until DVB logic defined
    },
    datewise: Object.keys(datewise[metrics[0]]).length
      ? metrics.map(m=>({Metric:m,...datewise[m],Total:round(Object.values(datewise[m]).reduce((a,b)=>a+b,0))}))
      : [],
    date_cols: dateCols,
    download_ready: false,
  }
}

// ── Components ────────────────────────────────────────────────────────────────

export { API_BASE, C, CONTENT_TYPES, CT_MAP, round, formatDateCol, normalizeRow, parseLocally, CANONICAL_COLUMNS, DATE_COLUMN_PRIORITY }
