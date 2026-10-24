export const RELEASE = '2026-10-24-express';
const SEEN_KEY = 'painel-puff:release-seen';

function deadline(promise, milliseconds=15000) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('A conexão demorou. Tente novamente quando a internet estiver estável.')),milliseconds);})]).finally(()=>clearTimeout(timer));
}

export function setupResilience({busy,openForm,recover}) {
  const $=selector=>document.querySelector(selector);
  let registration, seen=false, reloadPending=false;
  try{seen=localStorage.getItem(SEEN_KEY)===RELEASE;}catch{}
  $('#app-version').textContent='Versão · 24/10/2026';
  const message=text=>{$('#repair-status').textContent=text;};
  const safe=()=>{
    if(busy()){message('Há uma operação em andamento. Aguarde ou use “Sair e conferir depois” no formulário antes de atualizar o app.');return false;}
    if(openForm()){message('Salve ou feche o formulário aberto antes de atualizar o app.');return false;}
    return true;
  };
  $('#repair-open').addEventListener('click',()=>{$('#repair-panel').hidden=!$('#repair-panel').hidden;});
  $('#repair-close').addEventListener('click',()=>{$('#repair-panel').hidden=true;});
  $('#repair-check').addEventListener('click',async()=>{
    if(!safe())return;
    const button=$('#repair-check');button.disabled=true;message('Conferindo a conexão e a tentativa pendente…');
    try{await recover();message($('#connection-status').textContent);}catch(error){message(error.message);}finally{button.disabled=false;}
  });
  $('#release-dismiss').addEventListener('click',()=>{seen=true;$('#release-note').hidden=true;try{localStorage.setItem(SEEN_KEY,RELEASE);}catch{}});
  $('#release-open').addEventListener('click',()=>{$('#release-note').hidden=false;$('#release-note').scrollIntoView({block:'center',behavior:'auto'});});
  const showUpdate=()=>{if(registration?.waiting)$('#app-update').hidden=false;};
  $('#app-update').addEventListener('click',async()=>{
    $('#repair-panel').hidden=false;if(!safe())return;
    const button=$('#app-update');button.disabled=true;
    try{
      if(reloadPending){location.reload();return;}
      if(!registration?.waiting){await deadline(registration?.update());showUpdate();return;}
      message('Aplicando a versão nova. Seus registros locais serão mantidos.');
      let listener;
      const changed=new Promise(resolve=>{listener=()=>resolve();navigator.serviceWorker.addEventListener('controllerchange',listener,{once:true});});
      try{registration.waiting.postMessage({type:'SKIP_WAITING'});await deadline(changed);reloadPending=true;if(safe())location.reload();}
      finally{navigator.serviceWorker.removeEventListener('controllerchange',listener);}
    }catch(error){message(error.message);}finally{button.disabled=false;}
  });
  $('#repair-reload').addEventListener('click',async()=>{
    if(!safe())return;
    const button=$('#repair-reload');button.disabled=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      message('Verificando os arquivos do app antes de recarregar…');
      const url=new URL('index.html',location.href);url.searchParams.set('puff-update',Date.now());
      const response=await fetch(url,{cache:'reload',signal:controller.signal});
      if(!response.ok||!(await response.text()).includes('name="puff-release"'))throw new Error('Não foi possível obter o painel atualizado. Confira a conexão e tente novamente.');
      if(!safe())return;
      if('serviceWorker' in navigator){
        const current=await deadline(navigator.serviceWorker.getRegistration());
        if(current?.scope===new URL('./',location.href).href)await deadline(current.unregister());
      }
      if('caches' in globalThis)await deadline(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^puff-v\d+-/.test(key)).map(key=>caches.delete(key)))));
      // Never clear localStorage: pending operations, access key and note drafts must survive.
      if(safe())location.replace(url.href);
    }catch(error){message(error.name==='AbortError'?'A internet não respondeu. Nada foi apagado; tente novamente.':error.message);}finally{clearTimeout(timer);button.disabled=false;}
  });
  if('serviceWorker' in navigator&& !['localhost','127.0.0.1'].includes(location.hostname)){
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{
      registration=reg;showUpdate();
      reg.addEventListener('updatefound',()=>{reg.installing?.addEventListener('statechange',showUpdate);});
      void deadline(reg.update()).then(showUpdate).catch(()=>{});
    }).catch(()=>{});
  }
  return {ready(){
    // Recovery bypasses the HTTP cache once; restore the offline-capable URL after a successful load.
    try{const url=new URL(location.href);if(url.searchParams.has('puff-update')){url.searchParams.delete('puff-update');history.replaceState(history.state,'',url.href);}}catch{}
    if(!seen)$('#release-note').hidden=false;
  }};
}
