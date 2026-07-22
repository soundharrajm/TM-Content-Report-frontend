import { C } from "./reportUtils.js"
import KpiCard from "./KpiCard.jsx"
import SecHdr from "./SecHdr.jsx"

export default function SummaryTab({ summary, includeArchivedPurged, reportTypes }) {
  return (
    <>
      {/* Always shown regardless of includeArchivedPurged, matching the
          backend's build_excel() -- Total Contents/Hours represent the full
          all-status total. Note: when the toggle is off, this value still
          includes archived/purged/draft internally even though those
          individual breakdown sections below stay hidden -- by design. */}
      <SecHdr color={C.navy}>Total (All Statuses)</SecHdr>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
        <KpiCard label="Total Contents" value={summary.all_content||0} color={C.navy}
          sub="Published + Archived + Purged + Draft"/>
        <KpiCard label="Total Hours"    value={`${summary.all_hours||0}h`} color={C.navy}
          sub="Published + Archived + Purged + Draft"/>
      </div>

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

          <SecHdr color={C.draft}>Total Draft</SecHdr>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:12}}>
            <KpiCard label="Total Draft Content" value={summary.draft_content||0} color={C.draft}/>
            <KpiCard label="Total Draft Hours"   value={`${summary.draft_hours||0}h`} color={C.draft}/>
          </div>
        </>
      )}

      <SecHdr color={C.teal}>By Content Type</SecHdr>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
        {reportTypes.map((ct,i)=>{
          const colors=[C.teal,C.blue,C.purple,C.amber,'#2980B9',C.green]
          return <KpiCard key={ct} label={ct} value={summary.by_type[ct]||0}
            hours={summary.by_type_hours?.[ct]||0} color={colors[i % colors.length]}/>
        })}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginTop:4}}>
        <div>
          <SecHdr color={C.amber}>Manual Ingestion</SecHdr>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <KpiCard label="Total Manual Ingest Content" value={summary.manual_content} color={C.amber}/>
            <KpiCard label="Total Manual Ingest Hours" value={`${summary.manual_hours}h`} color={C.amber}/>
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
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                <KpiCard label="Draft — Content" value={summary.manual_draft_content||0} color={C.amber}/>
                <KpiCard label="Draft — Hours" value={`${summary.manual_draft_hours||0}h`} color={C.amber}/>
              </div>
            </>
          )}
        </div>
        <div>
          <SecHdr color={C.purple}>L2V (Live-to-VOD)</SecHdr>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <KpiCard label="Total L2V Ingest Content" value={summary.l2v_content} color={C.purple}/>
            <KpiCard label="Total L2V Ingest Hours" value={`${summary.l2v_hours}h`} color={C.purple}/>
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
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:8}}>
                <KpiCard label="Draft — Content" value={summary.l2v_draft_content||0} color={C.purple}/>
                <KpiCard label="Draft — Hours" value={`${summary.l2v_draft_hours||0}h`} color={C.purple}/>
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
              ...reportTypes.map(ct=>({label:`  ${ct}`,ct,group:'type'})),
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
  )
}
