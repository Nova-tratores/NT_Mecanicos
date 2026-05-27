const API='https://api.rotaexata.com.br';
const loginRes=await fetch(API+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'posvendas.novatratores@gmail.com',password:'MahinDra@2026!'})});
const {token}=await loginRes.json();
const hoje=new Date().toISOString().split('T')[0];
const where=encodeURIComponent(JSON.stringify({adesao_id:83023,dt_posicao:{$gte:hoje+'T00:00:00.000-03:00',$lte:hoje+'T23:59:59.999-03:00'}}));

for(let p=5; p<=30; p+=5){
  const r=await fetch(API+'/posicoes?where='+where+'&limit=500&page='+p,{headers:{Authorization:token}});
  const d=await r.json();
  const arr=Array.isArray(d.data)?d.data:[];
  const isEmpty = arr.length===0 || (arr.length===1 && typeof arr[0].data==='string');
  if(isEmpty){
    console.log('Page '+p+': vazio');
    const rLast=await fetch(API+'/posicoes?where='+where+'&limit=500&page='+(p-1),{headers:{Authorization:token}});
    const dLast=await rLast.json();
    const arrLast=Array.isArray(dLast.data)?dLast.data:[];
    if(arrLast.length>0){
      const u=arrLast[arrLast.length-1];
      console.log('ULTIMA POSICAO:', u.dt_posicao, 'vel:'+u.velocidade, 'ign:'+u.ignicao, 'lat:'+u.latitude, 'lng:'+u.longitude);
    }
    break;
  }
  const last=arr[arr.length-1];
  console.log('Page '+p+':', arr.length, last.dt_posicao, 'vel:'+last.velocidade);
}
