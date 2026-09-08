// Use the Firebase CLI's existing authenticated transport. Never print credentials.
const { selectAccount, setActiveAccount } = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { getAuthDomains, updateAuthDomains, findUser } = require('firebase-tools/lib/gcp/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const project='gamba-league',email=process.argv[2];
async function main(){
 if(!email)throw Error('Supply the signed-in Firebase project owner email.');
 const options={project,nonInteractive:true};setActiveAccount(options,selectAccount(email,process.cwd()));await requireAuth(options);
 const domains=await getAuthDomains(project);const desired=[...new Set([...domains,'localhost','gamba-league.doc-pillsbury.chatgpt.site'])];
 if(desired.length!==domains.length)await updateAuthDomains(project,desired);
 console.log('Google sign-in domains configured.');
 let uid;try {const user=await findUser(project,email);uid=user.uid;}catch(e){if(!String(e.message).includes('No users found'))throw e;}
 const client=new Client({urlPrefix:'https://firestore.googleapis.com',auth:true});
 const path='/v1/projects/'+project+'/databases/(default)/documents/config/league';let existing;
 try{existing=(await client.get(path)).body;}catch(e){if(e.status!==404&&e.context?.response?.statusCode!==404&&!String(e.message).includes('404'))throw e;}
 if(!existing){await client.post('/v1/projects/'+project+'/databases/(default)/documents/config',{fields:{startDate:{stringValue:'2026-09-09'},commissionerUids:{arrayValue:{values:uid?[{stringValue:uid}]:[]}},autoSettlementEnabled:{booleanValue:false}}},{queryParams:{documentId:'league'}});console.log('Season configured: September 9, 2026.');}
 else if(uid&&!(existing.fields?.commissionerUids?.arrayValue?.values??[]).length){await client.patch(path,{fields:{commissionerUids:{arrayValue:{values:[{stringValue:uid}]}}}},{queryParams:{'updateMask.fieldPaths':'commissionerUids','currentDocument.updateTime':existing.updateTime}});}
 console.log(uid?'Commissioner account is configured or existing commissioner settings were preserved.':'Commissioner pending: sign into the website with this Google account, then run this script again.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
