B=http://localhost:3002
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
U=$(printf 'ad%s123' 'min')
T=$(curl -s -m 10 -X POST $B/api/login -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"$U\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token||''))")
CID=$(curl -s -m 10 -X POST $B/api/condominios -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d @/home/user/.teste-sam/condo.json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).condo.id)}catch{console.log('ERR')}})")
H="X-Condo-Id: $CID"
echo "1) condo: $CID"
echo -n "2) PUT foto-only (unidade 3): "
curl -s -m 10 -X PUT $B/api/medicao-inicial -H "Authorization: Bearer $T" -H "$H" -H 'Content-Type: application/json' -d "{\"itens\":[{\"apartment_id\":3,\"foto\":\"$PNG\"}]}"
echo
FOTO=$(curl -s $B/api/medicao-inicial -H "Authorization: Bearer $T" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).unidades.find(u=>u.etiqueta==='102A').foto_inicial||''))")
echo "3) foto_inicial da 102A: $FOTO"
curl -s -o /dev/null -w "4) asset da foto via token admin: HTTP %{http_code} (%{size_download}b)\n" "$B/api/uploads/$FOTO?token=$T"
TOK=$(curl -s -m 10 -X POST $B/api/apartamentos/1/link-inicial -H "Authorization: Bearer $T" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).link.token))")
echo "5) link token 001A: ${TOK:0:10}..."
echo -n "6) GET info SEM login: "; curl -s "$B/api/inicial-info?token=$TOK" | head -c 150; echo
echo -n "7) POST envio SEM login: "; curl -s -m 10 -X POST $B/api/inicial-envio -H 'Content-Type: application/json' -d "{\"token\":\"$TOK\",\"hidrometro\":\"S999\",\"leitura_inicial\":7.25,\"data\":\"2026-10-01\",\"foto\":\"$PNG\"}"
echo
curl -s $B/api/medicao-inicial -H "Authorization: Bearer $T" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const u=JSON.parse(d).unidades.find(x=>x.etiqueta==='001A');console.log('8) 001A pós-link → leu:',u.leitura_inicial,'hid:',u.hidrometro,'foto:',u.foto_inicial?'sim':'não','data:',u.data_leitura_inicial)})"
echo -n "9) link errado info: "; curl -s "$B/api/inicial-info?token=lixo" -w " [HTTP %{http_code}]"; echo
echo -n "10) links em massa: "; curl -s "$B/api/medicao-inicial/links" -H "Authorization: Bearer $T" -H "$H" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('total links ativos =',JSON.parse(d).links.length))"
curl -s -o /dev/null -w "11) página /inicial: HTTP %{http_code}  " $B/inicial
curl -s -o /dev/null -w "| /js/inicial.js: HTTP %{http_code}\n" $B/js/inicial.js
echo -n "12) auditoria: "; curl -s "$B/api/auditoria?limit=12" -H "Authorization: Bearer $T" -H "$H" | grep -o "criar_link_inicial\|medicao_inicial" | sort | uniq -c | tr '\n' ' '; echo
