import { execFileSync } from 'node:child_process';
const repository=process.argv[2]??'matrixji/reqtype';
if(!/^[\w.-]+\/[\w.-]+$/.test(repository))throw new Error('仓库名称须为 owner/repository');
function api(endpoint:string,method='GET',value?:unknown){return JSON.parse(execFileSync('gh',['api',`repos/${repository}/${endpoint}`,'--method',method,...value===undefined?[]:['--input','-']],{encoding:'utf8',...value===undefined?{}:{input:JSON.stringify(value)}}));}
const checks=api('commits/main/check-runs').check_runs,check=checks.find((entry:{name:string})=>entry.name==='CI required');
if(!check)throw new Error('请先完成一次 CI，使 CI required 检查登记到仓库');
api('branches/main/protection','PUT',{required_status_checks:{strict:true,checks:[{context:'CI required',app_id:check.app.id}]},enforce_admins:true,required_pull_request_reviews:{dismiss_stale_reviews:true,require_code_owner_reviews:false,required_approving_review_count:0},restrictions:null,required_linear_history:true,allow_force_pushes:false,allow_deletions:false,required_conversation_resolution:true});
const name='ReqType immutable release tags',rules={name,target:'tag',enforcement:'active',bypass_actors:[],conditions:{ref_name:{include:['refs/tags/v*'],exclude:[]}},rules:[{type:'update'},{type:'deletion'}]};
const existing=api('rulesets').find((entry:{name:string})=>entry.name===name);
api(existing?`rulesets/${existing.id}`:'rulesets',existing?'PUT':'POST',rules);
console.log('已启用 main 的 PR／CI 门禁及版本 tag 不可改写规则');
