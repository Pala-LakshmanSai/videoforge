import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
const k = await loadSujalRunPodApiKeyFromKeychain();
for (let i=0;i<40;i++){
  const j = await (await fetch("https://rest.runpod.io/v1/pods/8q3eq3fu46ontz",{headers:{Authorization:`Bearer ${k}`}})).json() as any;
  if (j.runtime && Object.keys(j.runtime).length) { console.log("RUNTIME", JSON.stringify(j.runtime).slice(0,200)); break; }
  if (i%5===0) console.log(i, j.desiredStatus);
  await new Promise(r=>setTimeout(r,30000));
}
