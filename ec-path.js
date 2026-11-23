/**
 * ec-path.js —— projectRoot 的路径语义选择（本地路径 / 远程标签）
 *
 * projectRoot 现在是用户声明的**文本标签**（可能是远端路径，如 /remote/path/to/Project），
 * 插件不再对它做白名单或存在性校验。这里提供两套路径语义，职责严格分开：
 *   - *For 助手（标签形态）：按标签自身形态选模块——POSIX 标签（以单个 / 开头）走
 *     node:path/posix，其余走平台原生。用于构造"返回给调用方/写进 state.json 的路径指针"，
 *     保证远端标签 /remote/... 原样保留，不被改写成盘符路径。
 *   - nativePath（宿主 fs 语义）：恒等于宿主原生模块（Windows=win32）。用于**安全校验**——
 *     fs 落盘时 Windows 会把 /remote/... 当成 <当前盘>:\remote\...、把 \ 当分隔符，
 *     只有用同一语义折叠 .. 才不会「校验说在根内、落盘却跑到根外」（防反斜杠穿越）。
 *     （下方示例里的 <当前盘> 是泛指，不是任何真实主机盘符或路径。）
 *
 * 关键区分：标签形态只管"字符串长什么样"，fs 语义管"文件实际写到哪"。
 * 校验必须跟 fs 走，返回值才跟标签走。
 */
import { posix, win32 } from 'node:path'

/** 宿主 fs 实际使用的路径模块（Windows=win32，其余=posix）——安全校验必须用这个。 */
export const nativePath = process.platform === 'win32' ? win32 : posix

/** 是否 POSIX 风格绝对路径标签（以单个 / 开头，排除 // 的 UNC 形态）。 */
export function isPosixLabel(input) {
  return typeof input === 'string' && input.startsWith('/') && !input.startsWith('//')
}

/** 为该标签挑选路径模块（标签形态）。 */
export function pathFor(input) {
  return isPosixLabel(input) ? posix : nativePath
}

/** 按标签形态 resolve+normalize（POSIX 标签保持 / 开头，不被加盘符）。 */
export function resolveFor(input) {
  const p = pathFor(input)
  return p.resolve(p.normalize(input))
}

/** 按标签形态判断绝对路径。 */
export function isAbsoluteFor(input) {
  return pathFor(input).isAbsolute(input)
}

/** 按标签形态 join。 */
export function joinFor(root, ...parts) {
  return pathFor(root).join(root, ...parts)
}

/** 按标签形态 dirname。 */
export function dirnameFor(input) {
  return pathFor(input).dirname(input)
}
