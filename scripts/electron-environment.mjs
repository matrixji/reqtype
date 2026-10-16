// npm 将旧 .npmrc 字段注入环境时，@electron/get 会优先使用它。
// 仅规范当前进程的下载配置，保留全局配置文件不变。
export function electronEnvironment(base = process.env) {
  const env = { ...base };
  const legacy = env.npm_config_electron_mirror || env.NPM_CONFIG_ELECTRON_MIRROR;
  const mirror = env.ELECTRON_MIRROR || (legacy?.includes('npm.taobao.org/mirrors/electron') ? 'https://npmmirror.com/mirrors/electron/' : legacy);
  if (mirror) {
    env.ELECTRON_MIRROR = mirror;
    delete env.npm_config_electron_mirror;
    delete env.NPM_CONFIG_ELECTRON_MIRROR;
  }
  return env;
}
