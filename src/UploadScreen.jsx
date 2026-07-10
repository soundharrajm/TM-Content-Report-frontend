import { C } from "./reportUtils.js"

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function UploadScreen({
  projectId, setProjectId, projects, projectsError,
  inputMode, setInputMode,
  selectedYear, setSelectedYear, selectedMonths, toggleMonth,
  generateFromDb,
  drag, setDrag, onDrop, processFile,
  apiBase, setApiBase, showApi, setShowApi,
  error,
}) {
  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{textAlign:'center',maxWidth:520,width:'100%',padding:'0 20px'}}>
        <div style={{fontSize:52,marginBottom:12}}>📡</div>
        <h1 style={{fontSize:24,fontWeight:800,color:C.navy,marginBottom:6}}>Content Reports</h1>
        <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Upload content-report.xlsx to generate the publishing dashboard</p>

        {/* Project selector — each project has its own separate DB config for duration lookups */}
        <div style={{marginBottom:16,textAlign:'left'}}>
          <label style={{fontSize:12,fontWeight:600,color:C.navy,display:'block',marginBottom:6}}>Project</label>
          <select
            value={projectId}
            onChange={e=>setProjectId(e.target.value)}
            style={{width:'100%',padding:'10px 12px',borderRadius:10,border:`1.5px solid ${C.border}`,
              background:C.card,color:C.navy,fontSize:14,fontWeight:600,outline:'none',boxSizing:'border-box'}}
          >
            {projects.length === 0 && <option value="default">default</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {projectsError && (
            <p style={{fontSize:11,color:C.red||'#c0392b',marginTop:4}}>⚠️ {projectsError} — using "default"</p>
          )}
        </div>

        {/* Input mode toggle: upload a file, or query the DB directly for selected months */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          <button onClick={()=>setInputMode('upload')} style={{flex:1,padding:'9px 12px',borderRadius:10,
            border:`1.5px solid ${inputMode==='upload'?C.blue:C.border}`,
            background:inputMode==='upload'?'#EAF1FB':C.card,color:inputMode==='upload'?C.blue:C.muted,
            fontWeight:700,fontSize:13,cursor:'pointer'}}>📂 Upload File</button>
          <button onClick={()=>setInputMode('months')} style={{flex:1,padding:'9px 12px',borderRadius:10,
            border:`1.5px solid ${inputMode==='months'?C.blue:C.border}`,
            background:inputMode==='months'?'#EAF1FB':C.card,color:inputMode==='months'?C.blue:C.muted,
            fontWeight:700,fontSize:13,cursor:'pointer'}}>📅 Select Months</button>
        </div>

        {inputMode === 'months' ? (
          <div style={{textAlign:'left',marginBottom:16,background:C.card,border:`1.5px solid ${C.border}`,borderRadius:12,padding:16}}>
            <label style={{fontSize:12,fontWeight:600,color:C.navy,display:'block',marginBottom:6}}>Year</label>
            <input type="number" value={selectedYear} onChange={e=>setSelectedYear(parseInt(e.target.value)||selectedYear)}
              style={{width:'100%',padding:'9px 12px',borderRadius:8,border:`1.5px solid ${C.border}`,
                background:C.bg,color:C.navy,fontSize:14,fontWeight:600,outline:'none',boxSizing:'border-box',marginBottom:14}} />

            <label style={{fontSize:12,fontWeight:600,color:C.navy,display:'block',marginBottom:6}}>Months</label>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:14}}>
              {MONTH_NAMES.map((name,i)=>{
                const m = i+1, active = selectedMonths.includes(m)
                return (
                  <button key={m} onClick={()=>toggleMonth(m)} style={{padding:'8px 4px',borderRadius:8,
                    border:`1.5px solid ${active?C.blue:C.border}`,background:active?C.blue:C.bg,
                    color:active?'#fff':C.muted,fontWeight:700,fontSize:12,cursor:'pointer'}}>{name}</button>
                )
              })}
            </div>

            <button onClick={()=>generateFromDb()} disabled={!selectedMonths.length}
              style={{width:'100%',padding:'12px',borderRadius:10,border:'none',
                background:selectedMonths.length?C.blue:'#ccc',color:'#fff',fontWeight:700,fontSize:14,
                cursor:selectedMonths.length?'pointer':'not-allowed'}}>
              ⚡ Generate Report ({selectedMonths.length} month{selectedMonths.length===1?'':'s'} selected)
            </button>
          </div>
        ) : (
        <>
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
        </>
        )}

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
}
