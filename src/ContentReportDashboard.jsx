import { useState, useCallback, useRef, useEffect } from "react"
import * as XLSX from "xlsx"
import { API_BASE, C, CONTENT_TYPES, round, normalizeRow, parseLocally } from "./reportUtils.js"
import UploadScreen from "./UploadScreen.jsx"
import SummaryTab from "./SummaryTab.jsx"
import DateWiseTab from "./DateWiseTab.jsx"
import MonthWiseTab from "./MonthWiseTab.jsx"

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
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('default')
  const [projectsError, setProjectsError] = useState(null)
  const [inputMode, setInputMode] = useState('upload')   // 'upload' | 'months'
  const [selectedMonths, setSelectedMonths] = useState([new Date().getMonth() + 1])
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())

  // Tracks whichever polling interval is currently active, persisted across
  // renders and re-invocations — without this, clicking "Generate Report"
  // a second time while a previous job is still being polled would start a
  // SECOND overlapping interval, with both racing to update the same
  // `data` state with results from two different job_ids.
  const activePollRef = useRef(null)
  const activeDownloadPollRef = useRef(null)
  const safetyTimeoutRef = useRef(null)
  const clearActivePoll = () => {
    if (activePollRef.current) clearInterval(activePollRef.current)
    if (activeDownloadPollRef.current) clearInterval(activeDownloadPollRef.current)
    if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current)
    activePollRef.current = null
    activeDownloadPollRef.current = null
    safetyTimeoutRef.current = null
  }

  // Schedules (or reschedules, cancelling any previous one) the overall
  // safety timeout for a poll loop. Used first with a generous default the
  // moment polling starts, then re-called with a size-aware value once the
  // real batch count is known (see pollJobStatus) — a 10-batch job and a
  // 500-batch job have no business sharing the same timeout.
  const scheduleSafetyTimeout = (pollIntervalId, timeoutMs, message) => {
    if (safetyTimeoutRef.current) clearTimeout(safetyTimeoutRef.current)
    safetyTimeoutRef.current = setTimeout(() => {
      if (activePollRef.current === pollIntervalId) {
        clearInterval(pollIntervalId)
        activePollRef.current = null
        setLoading(false)
        setError(prevErr => prevErr || message)
      }
    }, timeoutMs)
  }

  const toggleMonth = (m) => setSelectedMonths(prev =>
    prev.includes(m) ? prev.filter(x=>x!==m) : [...prev, m].sort((a,b)=>a-b))

  // Load available projects (each with its own DB config) for the dropdown
  useEffect(() => {
    fetch(`${apiBase}/projects`, {headers:{'ngrok-skip-browser-warning':'1'}})
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json() })
      .then(json => {
        setProjects(json.projects || [])
        if (json.projects?.length && !json.projects.some(p => p.id === projectId)) {
          setProjectId(json.projects[0].id)
        }
        setProjectsError(null)
      })
      .catch(e => setProjectsError(`Could not load projects: ${e.message}`))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  const uploadToBackend = async (file) => {
    const form = new FormData()
    form.append('file', file)
    form.append('include_archived_purged', includeArchivedPurged ? 'true' : 'false')
    form.append('project_id', projectId)
    const res = await fetch(`${apiBase}/generate`, {method:'POST', body:form, headers:{'ngrok-skip-browser-warning':'1'}})
    if (!res.ok) throw new Error(`Backend error: ${res.status}`)
    return res.json()
  }

  // DB-direct jobs report status='done' immediately (the numbers are ready
  // synchronously), but the styled Excel file is still built in the
  // background — download_ready flips to true separately, later. Without
  // this, handleDownload() would never see download_ready become true and
  // would always fall back to the plain, unstyled browser-side Excel export.
  //
  // maxAttempts/interval sized for genuinely large reports: the backend
  // writes full per-cell styling across up to 8 separate raw-data sheets
  // (L2V Data, Manual Data, Manual Archived, etc.) via openpyxl, which for
  // a report with thousands of published/archived/purged rows can easily
  // take well past the original 20-second window this used to allow —
  // after which download_ready would get stuck false in `data` state
  // *permanently*, silently downgrading every subsequent download click to
  // the plain 2-sheet client-side fallback with zero warning. 150 attempts
  // at 2s = 5 minutes, matching the same "large reports legitimately take a
  // while" philosophy as pollJobStatus's 4-minute stall-detection above.
  const pollUntilDownloadReady = useCallback((job_id, maxAttempts = 150) => {
    let attempts = 0
    const intervalRef = { current: null }
    const check = async () => {
      // If a newer poll (new report, or "Try Again"/"New File") has since
      // taken over activeDownloadPollRef, this one is stale — stop touching
      // shared state instead of racing a currently-active job's data with
      // a leftover Excel-ready check from a previous one.
      if (activeDownloadPollRef.current !== intervalRef.current) {
        clearInterval(intervalRef.current)
        return
      }
      attempts++
      try {
        const res = await fetch(`${apiBase}/status/${job_id}`, {headers:{'ngrok-skip-browser-warning':'1'}})
        if (res.ok) {
          const job = await res.json()
          setData(prev => prev ? { ...prev, download_ready: job.download_ready } : prev)
          if (job.download_ready) {
            console.log(`[Report] job=${job_id} Excel ready on backend`)
            clearInterval(intervalRef.current)
            if (activeDownloadPollRef.current === intervalRef.current) activeDownloadPollRef.current = null
          }
        }
      } catch (e) { /* keep trying until maxAttempts */ }
      if (attempts >= maxAttempts) {
        console.warn(`[Report] job=${job_id} styled Excel still not ready after ${maxAttempts * 2}s — `
          + 'giving up on background polling. handleDownload() will do one more live check before falling back.')
        clearInterval(intervalRef.current)
        if (activeDownloadPollRef.current === intervalRef.current) activeDownloadPollRef.current = null
      }
    }
    intervalRef.current = setInterval(check, 2000)
    activeDownloadPollRef.current = intervalRef.current
    check()
  }, [apiBase])

  const pollJobStatus = useCallback(async (job_id, intervalRef) => {
    try {
      const res = await fetch(`${apiBase}/status/${job_id}`, {headers:{'ngrok-skip-browser-warning':'1'}})
      if (!res.ok) {
        // A 404 unambiguously means the job is gone (e.g. backend restart)
        // — no amount of retrying fixes that, so stop immediately. Every
        // OTHER failure (500, network blip, ngrok hiccup, etc.) must NOT
        // give up after just a few tries: a large multi-month job can run
        // 190+ Couchbase batches over several minutes, and a handful of
        // transient poll failures during that time is normal, not a sign
        // the job died. Giving up early here previously caused the UI to
        // show a stuck progress percentage while the backend went on to
        // finish the report successfully in the background — the user
        // would never see the completed result. Only the 5-15 minute
        // overall safety timeout below should ever stop this for real.
        if (res.status === 404) {
          clearInterval(intervalRef.current)
          setLoading(false)
          setError('Report job not found on the backend — it may have been lost on a server restart. Please try again.')
        }
        return
      }
      const job = await res.json()
      console.log(`[Report] poll job=${job_id} status=${job.status} duration_source=${job.duration_source}`)

      // ── Stall detection — replaces any fixed overall timeout ────────────
      // Instead of guessing how long the whole job "should" take (impossible:
      // 1 month might be 40 batches, 6 months might be 300), track whether
      // progress is MOVING. As long as batches keep completing — however many
      // there are — polling never gives up. Only if progress stays frozen at
      // the same value for a full 4 minutes (with retries+backoff, even a
      // struggling batch resolves or fails well within that) do we conclude
      // the backend is genuinely stuck. This scales automatically with any
      // batch count, which is exactly what a fixed timeout can't do.
      const STALL_LIMIT_MS = 4 * 60 * 1000
      if (intervalRef.lastProgress === undefined || job.progress !== intervalRef.lastProgress) {
        intervalRef.lastProgress = job.progress
        intervalRef.lastProgressAt = Date.now()
      } else if (job.status === 'fetching' && Date.now() - intervalRef.lastProgressAt > STALL_LIMIT_MS) {
        clearInterval(intervalRef.current)
        setLoading(false)
        setError(`Report generation appears stuck — progress has been frozen at ${job.progress}% `
          + (job.batches_total ? `(batch ${job.batches_done}/${job.batches_total}) ` : '')
          + 'for over 4 minutes. The backend may have hit a problem; check server logs or try again.')
        return
      }

      // Update data with latest summary (includes hours once MySQL done)
      setData(prev => prev ? {
        ...prev,
        summary:         job.summary,
        datewise:        job.datewise,
        date_cols:       job.date_cols,
        duration_source: job.duration_source,
        download_ready:  job.download_ready,
        status:          job.status,
        progress:        job.progress,
        batches_done:    job.batches_done,
        batches_total:   job.batches_total,
      } : prev)

      // Stop polling when done or error
      if (job.status === 'done' || job.status === 'error') {
        clearInterval(intervalRef.current)
        setLoading(false)
        if (job.status === 'done') {
          console.log(`[Report] job=${job_id} complete — hours updated`)
          // The numbers are ready, but the styled Excel file is built
          // separately in the background (see _build_excel_async on the
          // backend) — poll until it's actually ready to download, rather
          // than assuming it already is. Scale the wait window to the
          // actual job size (batches_total) rather than a fixed cap —
          // multi-month reports have more Couchbase batches AND now two
          // extra MySQL lookups per pipeline run (metadata + encode-index
          // info), so a report covering several months can genuinely take
          // longer to build than the fixed 5-minute window this used to
          // have, which is exactly what caused the silent unstyled
          // client-side fallback for multi-month reports.
          const scaledMaxAttempts = Math.max(150, Math.ceil((job.batches_total || 0) * 3))
          pollUntilDownloadReady(job_id, scaledMaxAttempts)
        } else {
          // The backend fetch genuinely failed (e.g. no content found for
          // the selected months, or a Couchbase/MySQL connection error).
          // Without this, the dashboard would just sit there showing
          // placeholder zeros forever with zero indication anything went
          // wrong — `error` state only renders on the upload screen, which
          // isn't shown anymore once `data` exists, so this needs its own
          // path (see the in-dashboard error banner below).
          console.error(`[Report] job=${job_id} failed: ${job.error}`)
          setError(job.error || 'Report generation failed on the backend.')
        }
      }
    } catch(e) {
      // Network-level failure (fetch itself threw) — same reasoning as the
      // non-404 case above: don't give up after a few tries, just log it
      // and let the next tick try again. Only the overall safety timeout
      // should end this.
      console.warn(`[Report] poll for job=${job_id} failed (will keep retrying): ${e.message}`)
    }
  }, [apiBase, pollUntilDownloadReady])

  // Matches build_summary()'s exact backend shape, all zeroed — used so the
  // dashboard can render immediately after clicking Generate Report, rather
  // than showing a separate blank loading screen while MySQL/Couchbase run
  // in the background. Real numbers overwrite this via polling once ready.
  const buildPlaceholderSummary = () => ({
    total_content: 0, total_hours: 0,
    by_type: {}, by_type_hours: {},
    manual_content: 0, manual_hours: 0,
    manual_published_content: 0, manual_published_hours: 0,
    manual_archived_content: 0, manual_archived_hours: 0,
    manual_purged_content: 0, manual_purged_hours: 0,
    manual_draft_content: 0, manual_draft_hours: 0,
    l2v_content: 0, l2v_hours: 0,
    l2v_published_content: 0, l2v_published_hours: 0,
    l2v_archived_content: 0, l2v_archived_hours: 0,
    l2v_purged_content: 0, l2v_purged_hours: 0,
    l2v_draft_content: 0, l2v_draft_hours: 0,
    archived_content: 0, archived_hours: 0,
    purged_content: 0, purged_hours: 0,
    draft_content: 0, draft_hours: 0,
  })

  const generateFromDb = useCallback(async () => {
    clearActivePoll()  // stop any previous job's polling before starting a new one
    setError(null); setLoading(true); setData(null)
    setLoadingMsg('Querying database...')
    await new Promise(resolve => setTimeout(resolve, 50))
    const pollRef = { current: null }

    try {
      const res = await fetch(`${apiBase}/generate-from-db`, {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'ngrok-skip-browser-warning':'1'},
        body: JSON.stringify({
          project_id: projectId,
          months: selectedMonths,
          year: selectedYear,
          include_archived_purged: includeArchivedPurged,
        }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(()=>({detail: `Backend error: ${res.status}`}))
        throw new Error(errBody.detail || `Backend error: ${res.status}`)
      }
      const result = await res.json()
      console.log(`[Report] DB fetch started — job=${result.job_id} status=${result.status}`)
      // Populate with placeholder zeros immediately so the dashboard shell
      // renders right away — real numbers come in via polling below and
      // overwrite these once MySQL/Couchbase finish.
      setData({
        ...result,
        status: result.status,
        progress: 0,
        summary: buildPlaceholderSummary(),
        datewise: [],
        date_cols: [],
        duration_source: 'mysql_direct',
      })
      setLoading(false)

      // The initial POST now returns almost instantly (status='fetching') —
      // the actual MySQL + Couchbase work happens in the background and can
      // take a while for several months' worth of content. Poll the same
      // way the file-upload path already does, instead of assuming the
      // numbers are ready right away. This is what actually fixes the
      // multi-month timeout — the browser was previously waiting on one
      // single very long request instead of getting an immediate response
      // and polling for progress.
      setLoadingMsg('Querying MySQL and Couchbase for selected months...')
      pollRef.current = setInterval(
        () => pollJobStatus(result.job_id, pollRef),
        2000
      )
      activePollRef.current = pollRef.current  // track so a later click can clear it
      // NOTE: no fixed overall timeout here anymore — pollJobStatus's stall
      // detection replaces it. A fixed limit (60s, 5min, 20min...) is always
      // wrong for someone: too short abandons healthy large jobs (observed
      // in production at 5 min with 190 batches), too long leaves genuinely
      // stuck small jobs spinning. Stall detection ("give up only if
      // progress hasn't MOVED in 4 minutes") scales with any job size
      // automatically, which is exactly what "based on the batches,
      // increase the timeout automatically" needs.
    } catch(err) {
      setError(err.message)
      setLoading(false)
    }
  }, [apiBase, projectId, selectedMonths, selectedYear, includeArchivedPurged, pollJobStatus])

  const processFile = useCallback(async(file) => {
    clearActivePoll()  // stop any previous job's polling before starting a new one
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
          activePollRef.current = pollRef.current
          // Safety timeout after 60s
          setTimeout(() => {
            if (activePollRef.current === pollRef.current) {
              clearInterval(pollRef.current)
              activePollRef.current = null
              setLoading(false)
            }
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

  const handleDownload = async ({ monthWise = false } = {}) => {
    setDlLoading(true)
    try {
      // Background polling (pollUntilDownloadReady) may have given up before
      // the backend actually finished, or the user may simply be clicking
      // this well after that poll's window closed. Rather than trusting a
      // possibly-stale `data.download_ready` flag, do one live check right
      // now — this catches the common case where the styled Excel finished
      // on the backend a while ago but nothing was left polling to notice.
      let downloadReady = data?.download_ready
      let jobIdForCheck = data?.job_id
      if (!downloadReady && jobIdForCheck) {
        try {
          const res = await fetch(`${apiBase}/status/${jobIdForCheck}`, {headers:{'ngrok-skip-browser-warning':'1'}})
          if (res.ok) {
            const job = await res.json()
            downloadReady = job.download_ready
            if (downloadReady) setData(prev => prev ? { ...prev, download_ready: true } : prev)
          }
        } catch (e) { /* live check failed — fall through to the flag we already had */ }
      }

      if (downloadReady) {
        // Backend has the Excel ready — stream it directly (rebuilt server-side
        // if include_archived_purged or month_wise differ from the cached version)
        const res = await fetch(`${apiBase}/download?include_archived_purged=${includeArchivedPurged}&month_wise=${monthWise}`, {headers:{'ngrok-skip-browser-warning':'1'}})
        if (!res.ok) throw new Error('Download failed')
        const blob = await res.blob()
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        // Read the actual filename the backend computed (project-label-based)
        // from Content-Disposition — fetch()+blob() does NOT use this header
        // automatically the way a direct browser navigation would, so it has
        // to be parsed out manually or every download falls back to a fixed name.
        const cd = res.headers.get('Content-Disposition') || ''
        const match = cd.match(/filename="?([^";]+)"?/)
        a.download = match ? match[1] : `Content_Report_${new Date().toISOString().split('T')[0]}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      } else {
        // Genuinely still not ready even after a live check — this is now a
        // real, informed fallback rather than a silent quality downgrade.
        // The plain client-side export below is missing per-cell styling
        // and the Manual/L2V/Archived/Purged/Draft raw-data sheets the real
        // backend report has; the user should know that's what they're
        // getting and why, rather than discovering it after the fact.
        console.warn('[Report] Styled backend Excel not ready — using plain client-side fallback export. '
          + 'This file will be missing colors and the Manual/L2V/Archived/Purged/Draft detail sheets.')
        window.alert(
          'The full styled report is still being prepared on the server (this can take a few minutes '
          + 'for large date ranges). Downloading a simplified version now instead — it has the same '
          + 'numbers, but without formatting or the detailed Manual/L2V/Archived/Purged/Draft sheets. '
          + 'Wait a bit and click Download again for the complete report.'
        )
        // Backend not available — generate Excel locally from parsed data
        const { summary, datewise, date_cols } = data
        const wb = XLSX.utils.book_new()
        const reportTypes = Object.keys(summary?.by_type || {}).length ? Object.keys(summary.by_type) : CONTENT_TYPES
        const metrics = ['Total Published Content','Total Published Hours',
          ...reportTypes,'Manual Content','Manual Hours','Manual Published Content','Manual Published Hours',
          ...(includeArchivedPurged ? ['Manual Archived Content','Manual Archived Hours','Manual Purged Content','Manual Purged Hours','Manual Draft Content','Manual Draft Hours'] : []),
          'L2V Content','L2V Hours',
          'L2V Published Content','L2V Published Hours',
          ...(includeArchivedPurged ? ['L2V Archived Content','L2V Archived Hours','L2V Purged Content','L2V Purged Hours','L2V Draft Content','L2V Draft Hours'] : []),
          ...(includeArchivedPurged ? ['Archived Content','Archived Hours','Purged Content','Purged Hours','Draft Content','Draft Hours'] : [])]

        const s = [
          ['TM Content Publishing Summary',''],['',''],
          ...(includeArchivedPurged ? [
            ['TOTAL (ALL STATUSES)',''],
            // All-status totals: Published + Archived + Purged + Draft combined.
            // Only shown when includeArchivedPurged is on, same as the backend's
            // build_excel() -- these values incorporate archived/purged/draft
            // data, so showing them while hiding that breakdown would be
            // inconsistent.
            ['Total Contents', (summary.total_content||0) + (summary.archived_content||0) + (summary.purged_content||0) + (summary.draft_content||0)],
            ['Total Hours',    Math.round(((summary.total_hours||0) + (summary.archived_hours||0) + (summary.purged_hours||0) + (summary.draft_hours||0)) * 100) / 100],
            ['',''],
          ] : []),
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
            ['DRAFT',''],
            ['Total Draft Content', summary.draft_content||0],
            ['Total Draft Hours',   summary.draft_hours||0],['',''],
          ] : []),
          ['BY CONTENT TYPE',''],
          ...reportTypes.flatMap(ct=>[
            [`  ${ct} — Content`, summary?.by_type?.[ct]||0],
            [`  ${ct} — Hours`,   summary.by_type_hours?.[ct]||0],
          ]),['',''],
          ['MANUAL INGESTION',''],
          ['Total Manual Ingest Content', summary.manual_content],
          ['Total Manual Ingest Hours',   summary.manual_hours],
          ['Manual Ingestion Published Content', summary.manual_published_content||0],
          ['Manual Ingestion Published Hours',   summary.manual_published_hours||0],
          ...(includeArchivedPurged ? [
            ['Manual Ingestion Archived Content',  summary.manual_archived_content||0],
            ['Manual Ingestion Archived Hours',    summary.manual_archived_hours||0],
            ['Manual Ingestion Purged Content',    summary.manual_purged_content||0],
            ['Manual Ingestion Purged Hours',      summary.manual_purged_hours||0],
            ['Manual Ingestion Draft Content',     summary.manual_draft_content||0],
            ['Manual Ingestion Draft Hours',       summary.manual_draft_hours||0],
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
            ['L2V Draft Content',     summary.l2v_draft_content||0],
            ['L2V Draft Hours',       summary.l2v_draft_hours||0],
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
    <UploadScreen
      projectId={projectId} setProjectId={setProjectId} projects={projects} projectsError={projectsError}
      inputMode={inputMode} setInputMode={setInputMode}
      selectedYear={selectedYear} setSelectedYear={setSelectedYear} selectedMonths={selectedMonths} toggleMonth={toggleMonth}
      generateFromDb={generateFromDb}
      drag={drag} setDrag={setDrag} onDrop={onDrop} processFile={processFile}
      apiBase={apiBase} setApiBase={setApiBase} showApi={showApi} setShowApi={setShowApi}
      error={error}
    />
  )

  // Show loading spinner overlay on top of data when fetching MySQL
  const fetchingDuration = loading && data !== null && !!data?.summary

  // Full screen loading when no data yet — covers BOTH the original case
  // (data is still null) AND the DB-direct flow's in-between state, where
  // data is already set to a lightweight {job_id, status:'fetching'}
  // placeholder before the background MySQL/Couchbase fetch has populated
  // summary/datewise. Without the `!data?.summary` check here, this guard
  // never fires for that in-between state and falls through to the
  // dashboard render below, which then crashes trying to read summary.by_type.
  if (loading && !data?.summary) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{textAlign:'center',maxWidth:400}}>
        <div style={{fontSize:44,marginBottom:16,animation:'pulse 1.5s ease-in-out infinite'}}>📊</div>
        <div style={{fontSize:16,fontWeight:700,color:C.navy,marginBottom:8}}>{loadingMsg}</div>
        <div style={{width:200,height:4,background:'#E0E7FF',borderRadius:4,margin:'16px auto',overflow:'hidden'}}>
          <div style={{height:'100%',background:C.blue,borderRadius:4,animation:'progress 2s ease-in-out infinite'}}/>
        </div>
      </div>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes progress { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )

  if (!data) return null
  const {summary,datewise,date_cols,monthwise,month_cols,duration_source,has_local_duration} = data
  // The DB-direct flow now returns an immediate lightweight response
  // ({job_id, status:'fetching'}) before the background MySQL/Couchbase
  // fetch completes — summary/datewise/date_cols don't exist yet at that
  // point, even though `data` itself is already set. Show nothing (the
  // loading UI elsewhere already covers this) rather than crash trying to
  // render a dashboard for data that hasn't arrived.
  if (!summary || !datewise) return null
  const allReportTypes = Object.keys(summary?.by_type || {}).length ? Object.keys(summary.by_type) : CONTENT_TYPES
  // Hide a content type entirely (in both Summary and Date-wise) if it has
  // zero content AND zero hours for the whole report period — a type that
  // never appears shouldn't clutter the view with an all-dash row/card.
  const reportTypes = allReportTypes.filter(ct =>
    (summary?.by_type?.[ct] || 0) > 0 || (summary?.by_type_hours?.[ct] || 0) > 0)
  const METRICS_RAW = [
    {metric:'Total Contents',group:'overall'},
    {metric:'Total Hours',  group:'overall'},
    {metric:'Total Published Content',group:'overall'},
    {metric:'Total Published Hours',  group:'overall'},
    {metric:'Archived Content',group:'archived'},{metric:'Archived Hours',group:'archived'},
    {metric:'Purged Content',group:'purged'},{metric:'Purged Hours',group:'purged'},
    {metric:'Draft Content',group:'draft'},{metric:'Draft Hours',group:'draft'},
    ...reportTypes.map(ct=>({metric:ct,group:'type'})),
    {metric:'Manual Content',group:'manual',label:'Total Manual Ingest Content'},{metric:'Manual Hours',group:'manual',label:'Total Manual Ingest Hours'},
    {metric:'Manual Published Content',group:'manual'},{metric:'Manual Published Hours',group:'manual'},
    {metric:'Manual Archived Content',group:'manual'},{metric:'Manual Archived Hours',group:'manual'},
    {metric:'Manual Purged Content',group:'manual'},{metric:'Manual Purged Hours',group:'manual'},
    {metric:'Manual Draft Content',group:'manual'},{metric:'Manual Draft Hours',group:'manual'},
    {metric:'L2V Content',group:'l2v',label:'Total L2V Ingest Content'},{metric:'L2V Hours',group:'l2v',label:'Total L2V Ingest Hours'},
    {metric:'L2V Published Content',group:'l2v'},{metric:'L2V Published Hours',group:'l2v'},
    {metric:'L2V Archived Content',group:'l2v'},{metric:'L2V Archived Hours',group:'l2v'},
    {metric:'L2V Purged Content',group:'l2v'},{metric:'L2V Purged Hours',group:'l2v'},
    {metric:'L2V Draft Content',group:'l2v'},{metric:'L2V Draft Hours',group:'l2v'},
    {metric:'DVB Content',group:'dvb'},{metric:'DVB Hours',group:'dvb'},
  ]
  // Hide any Date-wise row entirely empty across the whole period (all dashes) —
  // except the headline Total Published rows, which stay visible even at 0
  // so the report clearly communicates "nothing published" rather than the
  // whole overall section silently vanishing.
  const ALWAYS_SHOW = new Set(['Total Published Content', 'Total Published Hours'])
  const METRICS = METRICS_RAW.filter(({metric}) => {
    if (ALWAYS_SHOW.has(metric)) return true
    const row = datewise.find(r=>r.Metric===metric) || {}
    const total = date_cols.reduce((s,dc)=>s+(row[dc]||0), 0)
    return total > 0
  })
  const GRP_COLOR={overall:C.blue,type:C.teal,manual:C.amber,l2v:C.purple,dvb:'#0E6655',archived:C.archived,purged:C.purged,draft:C.draft}
  const GRP_BG   ={overall:'#EAF1FB',type:'#EEF8EE',manual:'#FFF9EC',l2v:'#F5F0FF',dvb:'#E8F8F5',archived:'#FDEDEC',purged:'#ECECEC',draft:'#FCF3CF'}
  const currentProjectLabel = projects.find(p => p.id === (data.project_id || projectId))?.label || projectId

  return (
    <div style={{minHeight:'100vh',background:C.bg,fontFamily:'system-ui,sans-serif'}}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      {/* Header */}
      <div style={{background:C.navy,color:'#fff',padding:'14px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:17,fontWeight:800}}>📡 {currentProjectLabel} Content Publishing Report</div>
          <div style={{fontSize:12,opacity:0.7,marginTop:2}}>
            {date_cols.length ? `${date_cols[0]} – ${date_cols[date_cols.length-1]}` : 'Loading dates…'} &nbsp;·&nbsp;
            {summary.total_content} published &nbsp;·&nbsp;
            {summary.total_hours}h total &nbsp;·&nbsp;
            <span style={{
              background: (duration_source==='mysql'||duration_source==='mysql_direct')?'rgba(16,185,129,0.3)':
                          duration_source==='local_file'?'rgba(59,130,246,0.3)':'rgba(245,158,11,0.3)',
              borderRadius:4, padding:'1px 7px', fontSize:11
            }}>
              {(duration_source==='mysql'||duration_source==='mysql_direct')?'⚡ Duration from MySQL':
               duration_source==='local_file_seconds'?'📂 Duration from file (sec→hrs)':
               duration_source==='local_file'?'📂 Duration from file':
               '⚠ Duration unavailable'}
            </span>
            {data.status === 'fetching' && (
              <span style={{display:'inline-flex', alignItems:'center', gap:6, marginLeft:8}}>
                <span style={{
                  background:'rgba(255,255,255,0.15)', borderRadius:4,
                  padding:'1px 7px', fontSize:11,
                  animation:'pulse 1.5s ease-in-out infinite',
                }}>
                  ⏳ Fetching from MySQL/Couchbase — {data.progress ?? 0}%
                  {data.batches_total ? ` (batch ${data.batches_done}/${data.batches_total})` : ''}
                </span>
                <span style={{width:80, height:5, background:'rgba(255,255,255,0.2)', borderRadius:4, overflow:'hidden', display:'inline-block'}}>
                  <span style={{
                    display:'block', height:'100%', width:`${data.progress ?? 0}%`,
                    background:'#6ee7b7', borderRadius:4, transition:'width 0.4s ease',
                  }}/>
                </span>
              </span>
            )}
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
            Include Archived, Purged &amp; Draft
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

      {/* Report generation error — visible even once the dashboard has
          rendered, unlike the top-level `error` state which only showed on
          the upload screen before. Covers both an explicit fetch failure
          (setError from polling/timeouts) and the backend reporting the
          job itself as failed (data.status==='error'). */}
      {(error || data.status === 'error') && (
        <div style={{background:'#FDECEA',borderBottom:'1px solid #F5B7B1',padding:'10px 24px',fontSize:13,color:'#922B21',display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'}}>
          <span>⚠ <strong>Report generation failed:</strong> {error || data.error || 'Unknown error on the backend.'}</span>
          <button onClick={()=>{clearActivePoll();setData(null);setError(null)}}
            style={{padding:'4px 12px',borderRadius:6,border:'1px solid #922B21',background:'transparent',color:'#922B21',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
            Try Again
          </button>
        </div>
      )}

      {/* Duration source banner */}
      {!has_local_duration && duration_source==='none' && (
        <div style={{background:'#FFFBEC',borderBottom:'1px solid #F0D060',padding:'8px 24px',fontSize:12,color:'#7B5700',display:'flex',alignItems:'center',gap:8}}>
          ⚠ <strong>Duration data not available.</strong> Run backend with MySQL access for accurate hours, or add <code>_duration_hrs</code> column to Excel.
        </div>
      )}

      {/* Tabs */}
      <div style={{background:'#fff',borderBottom:`1px solid ${C.border}`,padding:'0 24px',display:'flex'}}>
        {[
          ['summary','📋 Summary'],
          ['datewise','📅 Date-wise'],
          // Only shown when the report actually spans more than one
          // calendar month -- for a single month, build_monthwise() would
          // just produce one column, identical to the Total column, adding
          // no value over the Date-wise tab that's already there.
          ...(month_cols && month_cols.length > 1 ? [['monthwise','🗓️ Month-wise']] : []),
        ].map(([id,label])=>(
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
        {tab==='summary' && (
          <SummaryTab summary={summary} includeArchivedPurged={includeArchivedPurged} reportTypes={reportTypes} />
        )}

        {tab==='datewise' && (
          <DateWiseTab
            date_cols={date_cols} datewise={datewise} METRICS={METRICS} GRP_COLOR={GRP_COLOR} GRP_BG={GRP_BG}
            includeArchivedPurged={includeArchivedPurged} setIncludeArchivedPurged={setIncludeArchivedPurged}
            handleDownload={handleDownload} dlLoading={dlLoading}
          />
        )}

        {tab==='monthwise' && month_cols && month_cols.length > 1 && (
          <MonthWiseTab
            month_cols={month_cols} monthwise={monthwise} METRICS={METRICS} GRP_COLOR={GRP_COLOR} GRP_BG={GRP_BG}
            includeArchivedPurged={includeArchivedPurged} setIncludeArchivedPurged={setIncludeArchivedPurged}
            handleDownload={handleDownload} dlLoading={dlLoading}
          />
        )}
      </div>
    </div>
  )
}
