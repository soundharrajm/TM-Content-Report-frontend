import { useState, useCallback, useRef, useEffect } from "react"
import * as XLSX from "xlsx"

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE
  || 'https://womanless-spent-scale.ngrok-free.dev'

const C = {
  navy:'#1F3864',blue:'#2E75B6',teal:'#0D7377',
  amber:'#BF8F00',purple:'#6B35A0',green:'#1E7E34',
  archived:'#922B21',purged:'#4D4D4D',
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
  externalid:'external_id', vodcmsstatus:'vod_cms_status',
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
  const df = rows.map(rawRow => {
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
    const isManual = !isAiring && isPub
    const isL2V    = isAiring && (isPub || isArch || isPurged)
    // Duration: _duration_hrs (hours) OR duration (seconds auto-converted)
    const durHrs = isNoVid ? 0
      : r['_duration_hrs']  ? parseFloat(r['_duration_hrs']||0)
      : r['duration']       ? parseFloat(r['duration']||0) / 3600
      : 0
    return {...r, date:dateStr, ct, vcs, isAiring, isPub, isArch, isPurged, isManual, isL2V, durHrs}
  })

  const pub  = df.filter(r=>r.isPub)
  const man  = df.filter(r=>r.isManual)              // manual, published only
  const manTotal = df.filter(r=>!r.isAiring)          // manual, any status — mirrors L2V's total
  const l2v  = df.filter(r=>r.isL2V)
  const l2vPub  = df.filter(r=>r.isAiring && r.isPub)
  const l2vArch = df.filter(r=>r.isAiring && r.isArch)
  const l2vPrg  = df.filter(r=>r.isAiring && r.isPurged)
  const manArch = df.filter(r=>!r.isAiring && r.isArch)
  const manPrg  = df.filter(r=>!r.isAiring && r.isPurged)
  // Total Published = Manual Insertion Published + L2V Published (explicit sum)
  const totalContent = man.length + l2vPub.length
  const totalHours   = round(man.reduce((s,r)=>s+r.durHrs,0) + l2vPub.reduce((s,r)=>s+r.durHrs,0))
  // Total Archived/Purged = Manual + L2V breakdown (explicit sum)
  const archContent = manArch.length + l2vArch.length
  const archHours   = round(manArch.reduce((s,r)=>s+r.durHrs,0) + l2vArch.reduce((s,r)=>s+r.durHrs,0))
  const prgContent  = manPrg.length + l2vPrg.length
  const prgHours    = round(manPrg.reduce((s,r)=>s+r.durHrs,0) + l2vPrg.reduce((s,r)=>s+r.durHrs,0))
  const allDates = [...new Set(df.map(r=>r.date).filter(Boolean))].sort()
  const dateCols  = allDates.map(formatDateCol)

  const metrics = ['Total Published Content','Total Published Hours',
    ...CONTENT_TYPES,'Manual Content','Manual Hours',
    'Manual Published Content','Manual Published Hours',
    'Manual Archived Content','Manual Archived Hours','Manual Purged Content','Manual Purged Hours',
    'L2V Content','L2V Hours',
    'L2V Published Content','L2V Published Hours','L2V Archived Content','L2V Archived Hours',
    'L2V Purged Content','L2V Purged Hours',
    'Archived Content','Archived Hours','Purged Content','Purged Hours']
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
    // Total Published per day = Manual Insertion Published + L2V Published (explicit sum)
    datewise['Total Published Content'][col] = dayMan.length + dayL2VPub.length
    datewise['Total Published Hours'][col]   = round(dayMan.reduce((s,r)=>s+r.durHrs,0) + dayL2VPub.reduce((s,r)=>s+r.durHrs,0))
    CONTENT_TYPES.forEach(ct=>{datewise[ct][col]=dayPub.filter(r=>r.ct===ct).length})
    // Manual Insertion — mirrors L2V's structure: total (any status), then published/archived/purged
    datewise['Manual Content'][col] = dayManTotal.length
    datewise['Manual Hours'][col]   = round(dayManTotal.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Published Content'][col] = dayMan.length
    datewise['Manual Published Hours'][col]   = round(dayMan.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Archived Content'][col] = dayManArch.length
    datewise['Manual Archived Hours'][col]   = round(dayManArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['Manual Purged Content'][col]   = dayManPrg.length
    datewise['Manual Purged Hours'][col]     = round(dayManPrg.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Content'][col]    = dayL2V.length
    datewise['L2V Hours'][col]      = round(dayL2V.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Published Content'][col] = dayL2VPub.length
    datewise['L2V Published Hours'][col]   = round(dayL2VPub.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Archived Content'][col]  = dayL2VArch.length
    datewise['L2V Archived Hours'][col]    = round(dayL2VArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['L2V Purged Content'][col]    = dayL2VPrg.length
    datewise['L2V Purged Hours'][col]      = round(dayL2VPrg.reduce((s,r)=>s+r.durHrs,0))
    // Total Archived/Purged per day = Manual + L2V breakdown (explicit sum)
    datewise['Archived Content'][col] = dayManArch.length + dayL2VArch.length
    datewise['Archived Hours'][col]   = round(dayManArch.reduce((s,r)=>s+r.durHrs,0) + dayL2VArch.reduce((s,r)=>s+r.durHrs,0))
    datewise['Purged Content'][col]   = dayManPrg.length + dayL2VPrg.length
    datewise['Purged Hours'][col]     = round(dayManPrg.reduce((s,r)=>s+r.durHrs,0) + dayL2VPrg.reduce((s,r)=>s+r.durHrs,0))
  })

  const byType      = {}
  const byTypeHours = {}
  CONTENT_TYPES.forEach(ct=>{
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
      l2v_content: l2v.length,   l2v_hours:    round(l2v.reduce((s,r)=>s+r.durHrs,0)),
      l2v_published_content: l2vPub.length,  l2v_published_hours: round(l2vPub.reduce((s,r)=>s+r.durHrs,0)),
      l2v_archived_content:  l2vArch.length, l2v_archived_hours:  round(l2vArch.reduce((s,r)=>s+r.durHrs,0)),
      l2v_purged_content:    l2vPrg.length,  l2v_purged_hours:    round(l2vPrg.reduce((s,r)=>s+r.durHrs,0)),
      archived_content: archContent, archived_hours: archHours,
      purged_content:   prgContent,  purged_hours:   prgHours,
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
function KpiCard({label,value,sub,color,hours}){
  return (
    <div style={{background:C.card,borderRadius:10,padding:'16px 18px',border:`1px solid ${C.border}`,borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:5}}>{label}</div>
      <div style={{fontSize:26,fontWeight:800,color,fontFamily:'Georgia,serif',lineHeight:1}}>{value}</div>
      {hours!==undefined&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>⏱ {hours}h</div>}
      {sub&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>{sub}</div>}
    </div>
  )
}
function SecHdr({children,color}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,margin:'20px 0 10px'}}>
      <div style={{width:4,height:18,background:color,borderRadius:2}}/>
      <span style={{fontSize:12,fontWeight:700,color:C.navy,textTransform:'uppercase',letterSpacing:'.07em'}}>{children}</span>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ContentReportDashboard(){
  const [data,setData]         = useState(null)
  const [loading,setLoading]   = useState(false)
  const [error,setError]       = useState(null)
  const [drag,setDrag]         = useState(false)
  const [tab,setTab]           = useState('summary')
  const [dlLoading,setDlLoading]= useState(false)
  const [loadingMsg,setLoadingMsg] = useState('Processing file...')
  const [apiBase,setApiBase]   = useState(API_BASE)
  const [showApi,setShowApi]   = useState(false)
  const [includeArchivedPurged, setIncludeArchivedPurged] = useState(true)

  const uploadToBackend = async (file) => {
    const form = new FormData()
    form.append('file', file)
    form.append('include_archived_purged', includeArchivedPurged ? 'true' : 'false')
    const res = await fetch(`${apiBase}/generate`, {method:'POST', body:form, headers:{'ngrok-skip-browser-warning':'1'}})
    if (!res.ok) throw new Error(`Backend error: ${res.status}`)
    return res.json()
  }

  const pollJobStatus = useCallback(async (job_id, intervalRef) => {
    try {
      const res = await fetch(`${apiBase}/status/${job_id}`, {headers:{'ngrok-skip-browser-warning':'1'}})
      if (!res.ok) return
      const job = await res.json()
      console.log(`[Report] poll job=${job_id} status=${job.status} duration_source=${job.duration_source}`)

      // Update data with latest summary (includes hours once MySQL done)
      setData(prev => prev ? {
        ...prev,
        summary:         job.summary,
        datewise:        job.datewise,
        date_cols:       job.date_cols,
        duration_source: job.duration_source,
        download_ready:  job.download_ready,
        status:          job.status,
      } : prev)

      // Stop polling when done or error
      if (job.status === 'done' || job.status === 'error') {
        clearInterval(intervalRef.current)
        setLoading(false)
        if (job.status === 'done') {
          console.log(`[Report] job=${job_id} complete — hours updated`)
        }
      }
    } catch(e) {
      clearInterval(intervalRef.current)
      setLoading(false)
    }
  }, [apiBase])

  const processFile = useCallback(async(file) => {
    setError(null); setLoading(true); setData(null)
    const pollRef = { current: null }

    setLoadingMsg('Uploading file...')
    // Give React time to render loading screen before heavy processing
    await new Promise(resolve => setTimeout(resolve, 50))

    try {
      // Try backend first
      try {
        setLoadingMsg('Uploading to backend...')
        console.log('[Report] Uploading to backend...')
        const result = await uploadToBackend(file)
        console.log(`[Report] Parsed — job=${result.job_id} status=${result.status}`)

        // Show initial data immediately (counts without hours)
        setData({...result, status: result.status})
        setLoading(false)

        // If MySQL fetch pending — start polling every 2s
        if (result.status !== 'done' && result.job_id) {
          console.log(`[Report] Starting poll for job=${result.job_id}`)
          setLoadingMsg('Querying MySQL for durations...')
          setLoading(true)
          pollRef.current = setInterval(
            () => pollJobStatus(result.job_id, pollRef),
            2000
          )
          // Safety timeout after 60s
          setTimeout(() => {
            clearInterval(pollRef.current)
            setLoading(false)
          }, 60000)
        }
        return
      } catch(backendErr) {
        console.warn('[Report] Backend unavailable, falling back to local parse:', backendErr.message)
      }

      // Fallback: parse locally (no MySQL duration)
      const reader = new FileReader()
      reader.onload = async e => {
        try {
          setLoadingMsg('Reading file...')
          await new Promise(resolve => setTimeout(resolve, 10))
          const wb   = XLSX.read(e.target.result, {type:'array', dense:true})
          const ws   = wb.Sheets[wb.SheetNames[0]]
          setLoadingMsg('Parsing rows...')
          await new Promise(resolve => setTimeout(resolve, 10))
          const rows = XLSX.utils.sheet_to_json(ws, {raw:false})
          setLoadingMsg('Calculating metrics...')
          await new Promise(resolve => setTimeout(resolve, 10))
          const result = parseLocally(rows)
          setData(result)
          setLoading(false)
        } catch(parseErr) {
          setError('Failed to parse file: ' + parseErr.message)
          setLoading(false)
        }
      }
      reader.onerror = () => { setError('Failed to read file'); setLoading(false) }
      reader.readAsArrayBuffer(file)
      return
    } catch(err) {
      setError(err.message)
      setLoading(false)
    }
  },[apiBase, pollJobStatus])

  const handleDownload = async () => {
    setDlLoading(true)
    try {
      if (data?.download_ready) {
        // Backend has the Excel ready — stream it directly (rebuilt server-side if flag changed)
        const res = await fetch(`${apiBase}/download?include_archived_purged=${includeArchivedPurged}`, {headers:{'ngrok-skip-browser-warning':'1'}})
        if (!res.ok) throw new Error('Download failed')
        const blob = await res.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = `TM_Content_Report_${new Date().toISOString().split('T')[0]}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        // Backend not available — generate Excel locally from parsed data
        const { summary, datewise, date_cols } = data
        const wb = XLSX.utils.book_new()
        const metrics = ['Total Published Content','Total Published Hours',
          ...CONTENT_TYPES,'Manual Content','Manual Hours','Manual Published Content','Manual Published Hours',
          ...(includeArchivedPurged ? ['Manual Archived Content','Manual Archived Hours','Manual Purged Content','Manual Purged Hours'] : []),
          'L2V Content','L2V Hours',
          'L2V Published Content','L2V Published Hours',
          ...(includeArchivedPurged ? ['L2V Archived Content','L2V Archived Hours','L2V Purged Content','L2V Purged Hours'] : []),
          ...(includeArchivedPurged ? ['Archived Content','Archived Hours','Purged Content','Purged Hours'] : [])]

        const s = [
          ['TM Content Publishing Summary',''],['',''],
          ['OVERALL',''],
          ['Total Published Content (All)', summary.total_content],
          ['Total Published Hours (All)',   summary.total_hours],['',''],
          ...(includeArchivedPurged ? [
            ['ARCHIVED',''],
            ['Total Archived Content', summary.archived_content||0],
            ['Total Archived Hours',   summary.archived_hours||0],['',''],
            ['PURGED',''],
            ['Total Purged Content', summary.purged_content||0],
            ['Total Purged Hours',   summary.purged_hours||0],['',''],
          ] : []),
          ['BY CONTENT TYPE',''],
          ...CONTENT_TYPES.flatMap(ct=>[
            [`  ${ct} — Content`, summary.by_type[ct]||0],
            [`  ${ct} — Hours`,   summary.by_type_hours?.[ct]||0],
          ]),['',''],
          ['MANUAL INSERTION',''],
          ['Manual Insertion Total Content', summary.manual_content],
          ['Manual Insertion Total Hours',   summary.manual_hours],
          ['Manual Insertion Published Content', summary.manual_published_content||0],
          ['Manual Insertion Published Hours',   summary.manual_published_hours||0],
          ...(includeArchivedPurged ? [
            ['Manual Insertion Archived Content',  summary.manual_archived_content||0],
            ['Manual Insertion Archived Hours',    summary.manual_archived_hours||0],
            ['Manual Insertion Purged Content',    summary.manual_purged_content||0],
            ['Manual Insertion Purged Hours',      summary.manual_purged_hours||0],
          ] : []),['',''],
          ['L2V (Live-to-VOD)',''],
          ['L2V Total Content', summary.l2v_content],
          ['L2V Total Hours',   summary.l2v_hours],
          ['L2V Published Content', summary.l2v_published_content||0],
          ['L2V Published Hours',   summary.l2v_published_hours||0],
          ...(includeArchivedPurged ? [
            ['L2V Archived Content',  summary.l2v_archived_content||0],
            ['L2V Archived Hours',    summary.l2v_archived_hours||0],
            ['L2V Purged Content',    summary.l2v_purged_content||0],
            ['L2V Purged Hours',      summary.l2v_purged_hours||0],
          ] : []),
        ]
        const ws1 = XLSX.utils.aoa_to_sheet(s)
        ws1['!cols']=[{wch:42},{wch:18}]
        XLSX.utils.book_append_sheet(wb,ws1,'Summary')

        const hdr = ['Metric',...date_cols,'Total']
        const rows = [hdr]
        metrics.forEach(m=>{
          const row = datewise.find(r=>r.Metric===m)||{}
          const vals= date_cols.map(dc=>row[dc]||0)
          rows.push([m,...vals,round(vals.reduce((a,b)=>a+b,0))])
        })
        const ws2 = XLSX.utils.aoa_to_sheet(rows)
        ws2['!cols']=[{wch:28},...date_cols.map(()=>({wch:9})),{wch:10}]
        XLSX.utils.book_append_sheet(wb,ws2,'Date-wise Report')
        XLSX.writeFile(wb,`TM_Content_Report_${new Date().toISOString().split('T')[0]}.xlsx`)
      }
    } catch(err) {
      setError('Download failed: '+err.message)
    }
    setDlLoading(false)
  }

  const onDrop = useCallback(e=>{
    e.preventDefault(); setDrag(false)
    if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0])
  },[processFile])

  // ── Upload screen ─────────────────────────────────────────────────────────
  if(!data&&!loading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{textAlign:'center',maxWidth:520,width:'100%',padding:'0 20px'}}>
        <div style={{fontSize:52,marginBottom:12}}>📡</div>
        <h1 style={{fontSize:24,fontWeight:800,color:C.navy,marginBottom:6}}>TM Content Report</h1>
        <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Upload content-report.xlsx to generate the publishing dashboard</p>

        <div
          onDrop={onDrop}
          onDragOver={e=>{e.preventDefault();setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onClick={()=>document.getElementById('fi').click()}
          style={{border:`2px dashed ${drag?C.blue:C.border}`,borderRadius:14,padding:'36px 24px',
            cursor:'pointer',background:drag?'#EEF4FF':C.card,transition:'all .2s',marginBottom:16}}
        >
          <div style={{fontSize:36,marginBottom:10}}>📂</div>
          <div style={{fontSize:15,fontWeight:600,color:C.navy,marginBottom:4}}>{drag?'Drop to upload':'Drop .xlsx here or click to browse'}</div>
          <div style={{fontSize:12,color:C.muted}}>Supports content-report.xlsx with optional _duration_hrs column</div>
        </div>
        <input id="fi" type="file" accept=".xlsx,.xls" onChange={e=>e.target.files[0]&&processFile(e.target.files[0])} style={{display:'none'}}/>

        {/* API Base Config */}
        <div style={{marginBottom:12}}>
          <button onClick={()=>setShowApi(v=>!v)} style={{fontSize:12,color:C.muted,background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>
            ⚙ Backend URL: {apiBase}
          </button>
          {showApi&&(
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <input value={apiBase} onChange={e=>setApiBase(e.target.value)}
                style={{flex:1,padding:'7px 10px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:13,fontFamily:'monospace'}}/>
              <button onClick={()=>{localStorage.setItem('report_api_base',apiBase);setShowApi(false)}}
                style={{padding:'7px 14px',borderRadius:7,background:C.navy,color:'#fff',border:'none',cursor:'pointer',fontSize:13}}>Save</button>
            </div>
          )}
        </div>

        {error&&<div style={{color:'#C0392B',fontSize:13,background:'#FFF0EE',padding:'10px 14px',borderRadius:8,marginBottom:12}}>⚠ {error}</div>}

        <div style={{padding:'14px 16px',background:'#FFFBEC',border:'1px solid #F0D060',borderRadius:10,fontSize:12,color:'#7B5700',textAlign:'left'}}>
          <strong>📋 Business Rules:</strong>
          <ul style={{margin:'6px 0 0',paddingLeft:18,lineHeight:1.9}}>
            <li>Published = vod_cms_status is <code>published</code></li>
            <li>Archived = vod_cms_status is <code>archived</code></li>
            <li>Purged = vod_cms_status is <code>purged</code></li>
            <li>Manual = non-airing External ID + published</li>
            <li>L2V = External ID starts with <code>airing-</code> (any status: published/archived/purged)</li>
            <li>If file has <code>_duration_hrs</code> → uses it, skips MySQL</li>
            <li>Series/Season duration always = 0</li>
          </ul>
        </div>
      </div>
    </div>
  )

  // Show loading spinner overlay on top of data when fetching MySQL
  const fetchingDuration = loading && data !== null

  // Full screen loading when no data yet
  if (loading && !data) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{textAlign:'center',maxWidth:400}}>
        <div style={{fontSize:44,marginBottom:16,animation:'pulse 1.5s ease-in-out infinite'}}>📊</div>
        <div style={{fontSize:16,fontWeight:700,color:C.navy,marginBottom:8}}>{loadingMsg}</div>
        <div style={{width:200,height:4,background:'#E0E7FF',borderRadius:4,margin:'16px auto',overflow:'hidden'}}>
          <div style={{height:'100%',background:C.blue,borderRadius:4,animation:'progress 2s ease-in-out infinite'}}/>
        </div>
        <div style={{fontSize:12,color:C.muted}}>Please wait — processing your file</div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
        @keyframes progress { 0%{width:0%;margin-left:0} 50%{width:60%;margin-left:20%} 100%{width:0%;margin-left:100%} }
      `}</style>
    </div>
  )

  if (!data) return null
  const {summary,datewise,date_cols,duration_source,has_local_duration} = data
  const METRICS = [
    {metric:'Total Published Content',group:'overall'},
    {metric:'Total Published Hours',  group:'overall'},
    {metric:'Archived Content',group:'archived'},{metric:'Archived Hours',group:'archived'},
    {metric:'Purged Content',group:'purged'},{metric:'Purged Hours',group:'purged'},
    ...CONTENT_TYPES.map(ct=>({metric:ct,group:'type'})),
    {metric:'Manual Content',group:'manual'},{metric:'Manual Hours',group:'manual'},
    {metric:'Manual Published Content',group:'manual'},{metric:'Manual Published Hours',group:'manual'},
    {metric:'Manual Archived Content',group:'manual'},{metric:'Manual Archived Hours',group:'manual'},
    {metric:'Manual Purged Content',group:'manual'},{metric:'Manual Purged Hours',group:'manual'},
    {metric:'L2V Content',group:'l2v'},{metric:'L2V Hours',group:'l2v'},
    {metric:'L2V Published Content',group:'l2v'},{metric:'L2V Published Hours',group:'l2v'},
    {metric:'L2V Archived Content',group:'l2v'},{metric:'L2V Archived Hours',group:'l2v'},
    {metric:'L2V Purged Content',group:'l2v'},{metric:'L2V Purged Hours',group:'l2v'},
    {metric:'DVB Content',group:'dvb'},{metric:'DVB Hours',group:'dvb'},
  ]
  const GRP_COLOR={overall:C.blue,type:C.teal,manual:C.amber,l2v:C.purple,dvb:'#0E6655',archived:C.archived,purged:C.purged}
  const GRP_BG   ={overall:'#EAF1FB',type:'#EEF8EE',manual:'#FFF9EC',l2v:'#F5F0FF',dvb:'#E8F8F5',archived:'#FDEDEC',purged:'#ECECEC'}

  return (
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:'system-ui,sans-serif'}}>
      {/* Header */}
      <div style={{background:C.navy,color:'#fff',padding:'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:17,fontWeight:800}}>📡 TM Content Publishing Report</div>
          <div style={{fontSize:12,opacity:0.7,marginTop:2}}>
            {date_cols[0]} – {date_cols[date_cols.length-1]} &nbsp;·&nbsp;
            {summary.total_content} published &nbsp;·&nbsp;
            {summary.total_hours}h total &nbsp;·&nbsp;
            <span style={{
              background: duration_source==='mysql'?'rgba(16,185,129,0.3)':
                          duration_source==='local_file'?'rgba(59,130,246,0.3)':'rgba(245,158,11,0.3)',
              borderRadius:4, padding:'1px 7px', fontSize:11
            }}>
              {duration_source==='mysql'?'⚡ Duration from MySQL':
               duration_source==='local_file_seconds'?'📂 Duration from file (sec→hrs)':
               duration_source==='local_file'?'📂 Duration from file':
               '⚠ Duration unavailable'}
            </span>
          </div>
        </div>
        <div style={{display:'flex',gap:12,alignItems:'center'}}>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#fff',cursor:'pointer',whiteSpace:'nowrap'}}>
            <input
              type="checkbox"
              checked={includeArchivedPurged}
              onChange={e=>setIncludeArchivedPurged(e.target.checked)}
              style={{width:14,height:14,cursor:'pointer'}}
            />
            Include Archived &amp; Purged
          </label>
          <button onClick={handleDownload} disabled={dlLoading}
            style={{padding:'8px 18px',borderRadius:8,border:'none',background:'#2E75B6',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:dlLoading?0.7:1}}>
            {dlLoading?'⏳ Downloading...':'⬇ Download Excel'}
          </button>
          <button onClick={()=>{setData(null);setError(null)}}
            style={{padding:'8px 14px',borderRadius:8,border:'1px solid rgba(255,255,255,0.3)',background:'transparent',color:'#fff',fontSize:13,cursor:'pointer'}}>
            ↑ New File
          </button>
        </div>
      </div>

      {/* Duration source banner */}
      {!has_local_duration && duration_source==='none' && (
        <div style={{background:'#FFFBEC',borderBottom:'1px solid #F0D060',padding:'8px 24px',fontSize:12,color:'#7B5700',display:'flex',alignItems:'center',gap:8}}>
          ⚠ <strong>Duration data not available.</strong> Run backend with MySQL access for accurate hours, or add <code>_duration_hrs</code> column to Excel.
        </div>
      )}

      {/* Tabs */}
      <div style={{background:'#fff',borderBottom:`1px solid ${C.border}`,padding:'0 24px',display:'flex'}}>
        {[['summary','📋 Summary'],['datewise','📅 Date-wise']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{
            padding:'11px 18px',fontSize:13,fontWeight:tab===id?700:500,
            color:tab===id?C.navy:C.muted,
            borderBottom:tab===id?`3px solid ${C.navy}`:'3px solid transparent',
            background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',
          }}>{label}</button>
        ))}
      </div>

      {/* MySQL fetch overlay */}
      {fetchingDuration && (
        <div style={{background:'#EEF4FF',borderBottom:`1px solid ${C.border}`,padding:'10px 24px',display:'flex',alignItems:'center',gap:10,fontSize:13}}>
          <span style={{fontSize:18,animation:'spin 1s linear infinite',display:'inline-block'}}>⏳</span>
          <span style={{color:C.navy,fontWeight:600}}>Fetching duration from MySQL...</span>
          <span style={{color:C.muted}}>Hours will update automatically when complete</span>
        </div>
      )}

      <div style={{padding:'20px 24px',maxWidth:1400,margin:'0 auto'}}>
        {tab==='summary'&&(
          <>
            <SecHdr color={C.blue}>Overall Published</SecHdr>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
              <KpiCard label="Total Published Content" value={summary.total_content} color={C.blue}/>
              <KpiCard label="Total Published Hours"   value={`${summary.total_hours}h`} color={C.blue} sub="from MySQL duration query"/>
            </div>

            {includeArchivedPurged && (
              <>
                <SecHdr color={C.archived}>Total Archived</SecHdr>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
                  <KpiCard label="Total Archived Content" value={summary.archived_content||0} color={C.archived}/>
                  <KpiCard label="Total Archived Hours"   value={`${summary.archived_hours||0}h`} color={C.archived}/>
                </div>

                <SecHdr color={C.purged}>Total Purged</SecHdr>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
                  <KpiCard label="Total Purged Content" value={summary.purged_content||0} color={C.purged}/>
                  <KpiCard label="Total Purged Hours"   value={`${summary.purged_hours||0}h`} color={C.purged}/>
                </div>
              </>
            )}

            <SecHdr color={C.teal}>By Content Type</SecHdr>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
              {CONTENT_TYPES.map((ct,i)=>{
                const colors=[C.teal,C.blue,C.purple,C.amber,'#2980B9',C.green]
                return <KpiCard key={ct} label={ct} value={summary.by_type[ct]||0}
                  hours={summary.by_type_hours?.[ct]||0} color={colors[i]}/>
              })}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginTop:4}}>
              <div>
                <SecHdr color={C.amber}>Manual Insertion</SecHdr>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <KpiCard label="Total Content" value={summary.manual_content} color={C.amber}/>
                  <KpiCard label="Total Hours" value={`${summary.manual_hours}h`} color={C.amber}/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                  <KpiCard label="Published — Content" value={summary.manual_published_content||0} color={C.amber}/>
                  <KpiCard label="Published — Hours" value={`${summary.manual_published_hours||0}h`} color={C.amber}/>
                </div>
                {includeArchivedPurged && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                      <KpiCard label="Archived — Content" value={summary.manual_archived_content||0} color={C.amber}/>
                      <KpiCard label="Archived — Hours" value={`${summary.manual_archived_hours||0}h`} color={C.amber}/>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                      <KpiCard label="Purged — Content" value={summary.manual_purged_content||0} color={C.amber}/>
                      <KpiCard label="Purged — Hours" value={`${summary.manual_purged_hours||0}h`} color={C.amber}/>
                    </div>
                  </>
                )}
              </div>
              <div>
                <SecHdr color={C.purple}>L2V (Live-to-VOD)</SecHdr>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <KpiCard label="Total Content" value={summary.l2v_content} color={C.purple}/>
                  <KpiCard label="Total Hours" value={`${summary.l2v_hours}h`} color={C.purple}/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                  <KpiCard label="Published — Content" value={summary.l2v_published_content||0} color={C.purple}/>
                  <KpiCard label="Published — Hours" value={`${summary.l2v_published_hours||0}h`} color={C.purple}/>
                </div>
                {includeArchivedPurged && (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                      <KpiCard label="Archived — Content" value={summary.l2v_archived_content||0} color={C.purple}/>
                      <KpiCard label="Archived — Hours" value={`${summary.l2v_archived_hours||0}h`} color={C.purple}/>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                      <KpiCard label="Purged — Content" value={summary.l2v_purged_content||0} color={C.purple}/>
                      <KpiCard label="Purged — Hours" value={`${summary.l2v_purged_hours||0}h`} color={C.purple}/>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Full table */}
            <SecHdr color={'#0E6655'}>DVB Processed</SecHdr>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
              <KpiCard label="DVB Processed Content" value={summary.dvb_content||0} color={'#0E6655'}/>
              <KpiCard label="DVB Processed Hours"   value={`${summary.dvb_hours||0}h`} color={'#0E6655'}/>
            </div>

            <SecHdr color={C.navy}>Full Breakdown</SecHdr>
            <div style={{background:C.card,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:C.navy,color:'#fff'}}>
                    {['Metric','Content','Hours','Manual Content','Manual Hours','L2V Content','L2V Hours'].map(h=>(
                      <th key={h} style={{padding:'10px 14px',textAlign:h==='Metric'?'left':'center',fontWeight:700,fontSize:11}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {label:'Total Published',ct:null,group:'overall'},
                    ...CONTENT_TYPES.map(ct=>({label:`  ${ct}`,ct,group:'type'})),
                  ].map((row,i)=>{
                    const pub_ct = row.ct ? summary.by_type[row.ct]||0 : summary.total_content
                    const hrs_ct = row.ct ? summary.by_type_hours?.[row.ct]||0 : summary.total_hours
                    return (
                      <tr key={i} style={{background:i%2===0?'#F8FAFF':'#fff',borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:'9px 14px',fontWeight:row.ct?400:700,color:C.text,paddingLeft:row.ct?28:14}}>{row.label.trim()}</td>
                        <td style={{padding:'9px 14px',textAlign:'center',fontWeight:700,color:C.navy}}>{pub_ct}</td>
                        <td style={{padding:'9px 14px',textAlign:'center',color:C.teal,fontWeight:600}}>{hrs_ct}h</td>
                        <td style={{padding:'9px 14px',textAlign:'center',color:C.amber,fontWeight:600}}>{row.ct?'—':summary.manual_content}</td>
                        <td style={{padding:'9px 14px',textAlign:'center',color:C.amber,fontWeight:600}}>{row.ct?'—':`${summary.manual_hours}h`}</td>
                        <td style={{padding:'9px 14px',textAlign:'center',color:C.purple,fontWeight:600}}>{row.ct?'—':summary.l2v_content}</td>
                        <td style={{padding:'9px 14px',textAlign:'center',color:C.purple,fontWeight:600}}>{row.ct?'—':`${summary.l2v_hours}h`}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab==='datewise'&&(
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontSize:13,color:C.muted}}>{date_cols.length} days · {date_cols[0]} to {date_cols[date_cols.length-1]}</div>
              <div style={{display:'flex',gap:12,alignItems:'center'}}>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.navy,cursor:'pointer',whiteSpace:'nowrap'}}>
                  <input
                    type="checkbox"
                    checked={includeArchivedPurged}
                    onChange={e=>setIncludeArchivedPurged(e.target.checked)}
                    style={{width:14,height:14,cursor:'pointer'}}
                  />
                  Include Archived &amp; Purged
                </label>
                <button onClick={handleDownload} disabled={dlLoading}
                  style={{padding:'7px 16px',borderRadius:7,border:`1px solid ${C.blue}`,background:'#EEF4FF',color:C.blue,fontSize:12,fontWeight:700,cursor:'pointer'}}>
                  {dlLoading?'⏳':'⬇'} Download Excel
                </button>
              </div>
            </div>
            <div style={{overflowX:'auto',borderRadius:10,border:`1px solid ${C.border}`,background:C.card}}>
              <table style={{borderCollapse:'collapse',fontSize:12,minWidth:'max-content',width:'100%'}}>
                <thead>
                  <tr style={{background:C.navy}}>
                    <th style={{padding:'10px 14px',textAlign:'left',color:'#fff',fontWeight:700,fontSize:12,
                      position:'sticky',left:0,background:C.navy,minWidth:220,borderRight:'1px solid rgba(255,255,255,0.1)'}}>Metric</th>
                    {date_cols.map(dc=>(
                      <th key={dc} style={{padding:'10px 8px',color:'#fff',fontWeight:700,textAlign:'center',minWidth:68}}>{dc}</th>
                    ))}
                    <th style={{padding:'10px 12px',color:'#FFD700',fontWeight:800,textAlign:'center',minWidth:80,background:'#162B50'}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(({metric,label,group},ri)=>{
                    const row  = datewise.find(r=>r.Metric===metric)||{}
                    const vals = date_cols.map(dc=>row[dc]||0)
                    const total= round(vals.reduce((a,b)=>a+b,0))
                    const gc   = GRP_COLOR[group]
                    const bg   = ri%2===0?GRP_BG[group]:'#fff'
                    return (
                      <tr key={metric} style={{background:bg,borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:'9px 14px',fontWeight:700,color:gc,position:'sticky',left:0,background:bg,borderRight:`2px solid ${C.border}`}}>{label||metric}</td>
                        {vals.map((v,ci)=>(
                          <td key={ci} style={{padding:'9px 8px',textAlign:'center',fontWeight:v>0?700:400,color:v>0?gc:'#ccc'}}>{v>0?v:'—'}</td>
                        ))}
                        <td style={{padding:'9px 12px',textAlign:'center',fontWeight:800,color:'#7B3F00',background:'#FFF2CC',borderLeft:`2px solid ${C.border}`}}>
                          {total||'—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
