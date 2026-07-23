import { C, round } from "./reportUtils.js"

export default function DateWiseTab({
  date_cols, datewise, METRICS, GRP_COLOR, GRP_BG,
}) {
  return (
    <>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13,color:C.muted}}>{date_cols.length} days · {date_cols[0]} to {date_cols[date_cols.length-1]}</div>
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
            {METRICS.map(({metric,label,group,tooltip},ri)=>{
              const row  = datewise.find(r=>r.Metric===metric)||{}
              const vals = date_cols.map(dc=>row[dc]||0)
              const total= round(vals.reduce((a,b)=>a+b,0))
              const gc   = GRP_COLOR[group]
              const bg   = ri%2===0?GRP_BG[group]:'#fff'
              return (
                <tr key={metric} style={{background:bg,borderBottom:`1px solid ${C.border}`}}>
                  <td title={tooltip} style={{padding:'9px 14px',fontWeight:700,color:gc,position:'sticky',left:0,background:bg,borderRight:`2px solid ${C.border}`,cursor:tooltip?'help':'default'}}>{label||metric}</td>
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
  )
}
