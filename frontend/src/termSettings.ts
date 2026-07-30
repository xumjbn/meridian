// ─────────────────────────────────────────────────────────────
// 终端全局设置（配色 / 字号 / 字体 / 编码）的共享读写。
//
// 为什么需要这一层：App 为每个终端会话各渲染一个 TerminalPage 实例，而这些设置
// 原来是各实例自己的 useState（初始值读 localStorage）。后果是改一处只有当前
// 会话生效，其它已经打开的标签一直停在旧值——实测同屏出现过两个底色不同的终端
// （#0B0F19 与 #1E1E1E 并存）。新建的会话反而是对的，因为它挂载时才去读 localStorage。
//
// 壁纸早先遇到同样的问题，用「写 localStorage + 广播事件 + 各实例订阅」解决了。
// 这里把那套做法抽成通用的，配色/字号/字体/编码共用，避免每加一个设置就重犯一次。
// ─────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';

const EVENT = 'wjw-term-setting';

/** 写设置并广播。所有订阅了该键的实例会立即跟上。 */
export const writeTermSetting = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可用（隐私模式等）：内存里仍然生效，只是重启后回到默认
  }
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: key }));
};

/**
 * 订阅一项设置。返回 [值, 设置函数]，用法与 useState 一致。
 *
 * 注意：广播的 detail 只带键名，回调里重新去 localStorage 读一次而不是直接用
 * 事件里的值——这样多个键共用一个事件类型也不会串，且刷新与广播两条路径读的是
 * 同一份数据，不会出现两套真相。
 */
export const useTermSetting = (key: string, fallback: string): [string, (v: string) => void] => {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== key) return;
      try {
        setValue(localStorage.getItem(key) ?? fallback);
      } catch {
        /* 读不到就保持当前值 */
      }
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [key, fallback]);

  return [value, (v: string) => writeTermSetting(key, v)];
};

/** 数值型设置（字号）的包装：越界或非数字一律回退到默认值 */
export const useTermSettingNumber = (
  key: string,
  fallback: number,
  min: number,
  max: number,
): [number, (v: number) => void] => {
  const [raw, setRaw] = useState<number>(() => {
    const n = parseInt(localStorage.getItem(key) || '', 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  });

  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== key) return;
      const n = parseInt(localStorage.getItem(key) || '', 10);
      setRaw(Number.isFinite(n) && n >= min && n <= max ? n : fallback);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [key, fallback, min, max]);

  return [raw, (v: number) => writeTermSetting(key, String(Math.max(min, Math.min(max, v))))];
};
