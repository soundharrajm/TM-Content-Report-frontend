import { C } from "./reportUtils.js"

export default function SecHdr({children,color}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,margin:'20px 0 10px'}}>
      <div style={{width:4,height:18,background:color,borderRadius:2}}/>
      <span style={{fontSize:12,fontWeight:700,color:C.navy,textTransform:'uppercase',letterSpacing:'.07em'}}>{children}</span>
    </div>
  )
}
