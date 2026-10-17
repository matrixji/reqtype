import { promises as fs } from 'node:fs';
import { defaultAIProfile, validateAIProfile } from '../core/ai';
import { assertFormatVersion, isRecord } from '../core/formats';
import { atomicWrite, digest, readOptional } from './workspace';
import type { AIProfile, AISettings, AISettingsInput } from '../shared/ai-types';

export interface CredentialVault { available():boolean; encrypt(value:string):Uint8Array; decrypt(value:Uint8Array):string }
export class AISettingsStore {
 constructor(private file:string,private vault:CredentialVault){}
 private async document(){
  const bytes=await readOptional(this.file);if(!bytes)return {profile:defaultAIProfile(),version:null,document:{format:'reqtype.ai',version:1,payload:{}} as Record<string,any>};
  const document=JSON.parse(bytes.toString('utf8'));
  if(!isRecord(document)||document.format!=='reqtype.ai')throw new Error('AI 设置格式标识无效');assertFormatVersion('ai',document.version);
  if(!isRecord(document.payload)||document.payload.encryptedKey!==undefined&&(typeof document.payload.encryptedKey!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.payload.encryptedKey)))throw new Error('AI 设置或加密凭据无效');
  return {profile:validateAIProfile(document.payload),version:digest(bytes),document};
 }
 async read():Promise<AISettings>{const state=await this.document();return {...state.profile,hasApiKey:Boolean(state.document.payload.encryptedKey),version:state.version};}
 async save(input:AISettingsInput,expected:string|null){
  const profile=validateAIProfile(input),state=await this.document();if(state.version!==expected)throw new Error('AI 设置已被外部修改，请重新载入');
  if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>8192||/[\r\n\x00]/.test(input.apiKey)))throw new Error('AI 凭据格式无效');
  let encryptedKey=state.document.payload.encryptedKey;
  if(input.clearApiKey||profile.baseUrl!==state.profile.baseUrl)encryptedKey=undefined;
  if(input.apiKey){if(!this.vault.available())throw new Error('系统安全存储不可用，未保存凭据；可使用无需密钥的本机服务');encryptedKey=Buffer.from(this.vault.encrypt(input.apiKey)).toString('base64');}
  const document={...state.document,payload:{...state.document.payload,...profile,encryptedKey}};
  await atomicWrite(this.file,Buffer.from(JSON.stringify(document,null,2)+'\n'),expected,0o600);if(process.platform!=='win32')await fs.chmod(this.file,0o600);
  return this.read();
 }
 async credentials():Promise<{profile:AIProfile;key:string}>{
  const state=await this.document();if(!state.profile.enabled)throw new Error('AI 尚未启用');
  const encoded=state.document.payload.encryptedKey;
  if(encoded&&!this.vault.available())throw new Error('系统安全存储不可用，请解锁后重试');
  return {profile:state.profile,key:encoded?this.vault.decrypt(Buffer.from(encoded,'base64')):''};
 }
}
