import { C } from "./reportUtils.js"

export default function KpiCard({label,value,sub,color,hours}){
  return (
    <div style={{background:C.card,borderRadius:10,padding:'16px 18px',border:`1px solid ${C.border}`,borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:'.08em',fontWeight:700,marginBottom:5}}>{label}</div>
      <div style={{fontSize:26,fontWeight:800,color,fontFamily:'Georgia,serif',lineHeight:1}}>{value}</div>
      {hours!==undefined&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>⏱ {hours}h</div>}
      {sub&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>{sub}</div>}
    </div>
  )
}
