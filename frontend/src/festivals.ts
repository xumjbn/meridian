// ─────────────────────────────────────────────────────────────
// 彩蛋主题：按当天日期自动切换节日特效
//
// 敲 wjw 时不再永远是同一场演出——当天是什么日子就放什么：
// 圣诞下雪、六一放气球、生日/纪念日走爱心。非节日则回落到日常表白版。
//
// 只覆盖公历节日：春节、中秋、七夕是农历，需要额外的农历换算表，
// 现有依赖里没有，硬编码逐年日期又会过期，故暂不纳入（见文件末尾说明）。
// ─────────────────────────────────────────────────────────────

/** 粒子演出的一套视觉与文案 */
export interface EggTheme {
  key: string;
  /** 节日名，仅用于调试与提示 */
  label: string;
  /** 主粒子配色（拼字/心形用） */
  particle: string[];
  /** 烟花火花配色 */
  spark: string[];
  /** 两幕字形：第一幕主题词，第二幕落到 WJW */
  shapes: [string, string];
  /** 五句字幕，依次对应：开场 / 心形 / 一幕文字 / 二幕文字 / 收尾 */
  captions: [string, string, string, string, string];
  /** 额外氛围层：雪花 / 气球 / 无 */
  ambient?: 'snow' | 'balloon';
  /** 中心形态：心形或圆环（节日不一定都用心） */
  core?: 'heart' | 'ring';
}

const PINK = ['#ff5c8a', '#ff8fab', '#ff3d71', '#ffc2d1'];
const PARTY = ['#ff5c8a', '#ffd166', '#06d6a0', '#4da3ff', '#c77dff'];

/** 日常（非节日）：默认表白版 */
export const DEFAULT_THEME: EggTheme = {
  key: 'love',
  label: '日常',
  particle: PINK,
  spark: PARTY,
  shapes: ['I LOVE U', 'WJW'],
  captions: [
    '有句话，想借这场烟花说',
    '从遇见你的那天起',
    '我就没想过要放手',
    '往后余生，风雪是你，平淡是你',
    '天天开心，美美哒 ❤',
  ],
  core: 'heart',
};

/** 结婚纪念日：2 月 22 日 */
export const ANNIVERSARY_MD = '02-22';

/** 公历节日表：键为 MM-DD */
const FESTIVALS: Record<string, EggTheme> = {
  '01-01': {
    key: 'newyear',
    label: '元旦',
    particle: ['#ffd166', '#ff5c8a', '#ffffff', '#4da3ff'],
    spark: PARTY,
    shapes: ['HAPPY NEW YEAR', 'WJW'],
    captions: [
      '旧的一年，谢谢你陪我走完',
      '新的一年，还想牵着你',
      '愿新岁胜旧年',
      '所愿皆成，所行皆坦途',
      '新年快乐 ❤',
    ],
    core: 'ring',
  },
  '02-14': {
    key: 'valentine',
    label: '情人节',
    particle: PINK,
    spark: ['#ff5c8a', '#ff3d71', '#ffc2d1', '#ffffff'],
    shapes: ['BE MINE', 'WJW'],
    captions: [
      '今天是情人节',
      '想把整片星空都送给你',
      '可是星空也没有你好看',
      '所以只好把我给你',
      '情人节快乐 ❤',
    ],
    core: 'heart',
  },
  '05-01': {
    key: 'labor',
    label: '劳动节',
    particle: ['#ff6b6b', '#ffd166', '#ffffff', '#ff8fab'],
    spark: PARTY,
    shapes: ['HAPPY MAY DAY', 'WJW'],
    captions: [
      '今天不上班，只想你',
      '这些天辛苦啦',
      '把活儿放一放，抱一抱',
      '劳动最光荣，你最好看',
      '五一快乐，好好休息 ❤',
    ],
    core: 'ring',
  },
  '05-20': {
    key: 'i-love-you-day',
    label: '520',
    particle: PINK,
    spark: ['#ff5c8a', '#ffd166', '#ffffff'],
    shapes: ['520', 'WJW'],
    captions: [
      '今天是 5 月 20 号',
      '一年就等这一天说得理直气壮',
      '我喜欢你，很久了',
      '以后每天都想说一遍',
      '520，我爱你 ❤',
    ],
    core: 'heart',
  },
  '06-01': {
    key: 'children',
    label: '六一',
    particle: ['#ffd166', '#06d6a0', '#4da3ff', '#ff8fab', '#c77dff'],
    spark: PARTY,
    shapes: ['HAPPY 61', 'WJW'],
    captions: [
      '大朋友，节日快乐',
      '在我这儿你永远是小孩',
      '想吃什么随便挑',
      '愿你一直有被宠着的底气',
      '六一快乐，永远十八岁 ❤',
    ],
    ambient: 'balloon',
    core: 'ring',
  },
  '10-01': {
    key: 'national',
    label: '国庆',
    particle: ['#ff4d4f', '#ffd166', '#ffffff'],
    spark: ['#ff4d4f', '#ffd166', '#ffffff'],
    shapes: ['HAPPY HOLIDAY', 'WJW'],
    captions: [
      '七天假，终于能好好陪你',
      '不赶路，不加班',
      '就想和你慢慢过',
      '哪儿都行，有你就行',
      '国庆快乐 ❤',
    ],
    core: 'ring',
  },
  '11-29': {
    key: 'birthday',
    label: '生日',
    particle: PINK,
    spark: PARTY,
    shapes: ['HAPPY BIRTHDAY', 'WJW'],
    captions: [
      '今天，是个很特别的日子',
      '闭上眼睛，许个愿吧',
      '愿你所求皆如愿',
      '所行化坦途，笑口常开',
      '生日快乐 ❤',
    ],
    core: 'heart',
  },
  '12-24': {
    key: 'xmas-eve',
    label: '平安夜',
    particle: ['#ffffff', '#ff5c8a', '#06d6a0', '#ffd166'],
    spark: ['#ffffff', '#06d6a0', '#ff4d4f', '#ffd166'],
    shapes: ['MERRY XMAS', 'WJW'],
    captions: [
      '平安夜快乐',
      '外面在下雪，屋里有你',
      '苹果给你留了最大的那个',
      '愿你岁岁平安',
      '晚安，我的圣诞礼物 ❤',
    ],
    ambient: 'snow',
    core: 'ring',
  },
  '12-25': {
    key: 'xmas',
    label: '圣诞节',
    particle: ['#ffffff', '#ff4d4f', '#06d6a0', '#ffd166'],
    spark: ['#ffffff', '#06d6a0', '#ff4d4f', '#ffd166'],
    shapes: ['MERRY XMAS', 'WJW'],
    captions: [
      '圣诞快乐',
      '今年的圣诞老人是我',
      '礼物就是往后的每一天',
      '记得年年都要一起过',
      'Merry Christmas ❤',
    ],
    ambient: 'snow',
    core: 'ring',
  },
};

const ANNIVERSARY_THEME: EggTheme = {
  key: 'anniversary',
  label: '结婚纪念日',
  particle: PINK,
  spark: ['#ff5c8a', '#ffd166', '#ffffff'],
  shapes: ['MARRY U AGAIN', 'WJW'],
  captions: [
    '今天是我们的纪念日',
    '又陪你走过一年',
    '柴米油盐里也全是你',
    '如果重来一次，还是你',
    '纪念日快乐 ❤',
  ],
  core: 'heart',
};

/** 把日期格式化成 MM-DD */
const toMD = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 按日期挑主题。
 * @param forcedKey 显式指定主题（如终端敲 921129 强制生日版），优先于日期
 */
export const resolveTheme = (now: Date = new Date(), forcedKey?: string): EggTheme => {
  if (forcedKey) {
    if (forcedKey === 'anniversary') return ANNIVERSARY_THEME;
    const hit = Object.values(FESTIVALS).find((t) => t.key === forcedKey);
    if (hit) return hit;
    if (forcedKey === 'love') return DEFAULT_THEME;
  }
  const md = toMD(now);
  if (ANNIVERSARY_MD && md === ANNIVERSARY_MD) return ANNIVERSARY_THEME;
  return FESTIVALS[md] ?? DEFAULT_THEME;
};

/** 所有可用主题键，供调试/手动触发 */
export const THEME_KEYS = [
  DEFAULT_THEME.key,
  ANNIVERSARY_THEME.key,
  ...Object.values(FESTIVALS).map((t) => t.key),
];
