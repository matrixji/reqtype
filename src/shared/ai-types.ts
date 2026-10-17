export type AIAction='polish'|'draft'|'review';
export interface AIProfile { enabled:boolean; baseUrl:string; model:string; protocol:'chat-completions' }
export interface AISettings extends AIProfile { hasApiKey:boolean; version:string|null }
export interface AISettingsInput extends AIProfile { apiKey?:string; clearApiKey?:boolean }
export interface AIRequest { id:string; action:AIAction; text:string; instruction:string }
export interface AIUsage { input?:number; output?:number; total?:number }
export type AIEvent={id:string;type:'delta';text:string}|{id:string;type:'done';text:string;usage?:AIUsage}|{id:string;type:'error';error:string}|{id:string;type:'cancelled'};
export interface AIContext { root:string; path:string; source:string; from:number; to:number; text:string }
