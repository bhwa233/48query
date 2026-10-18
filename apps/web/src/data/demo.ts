export type Member = {
  id: string;
  name: string;
  pinyin: string;
  group: string;
  team: string;
  initials: string;
  accent: string;
  messages: number;
  activeDays: number;
  recordings: number;
  lastActive: string;
};

export type Message = {
  id: string;
  memberId: string;
  member: string;
  type: "TEXT" | "IMAGE" | "REPLY" | "AUDIO";
  text: string;
  time: string;
  sender: string;
  senderType: "成员" | "粉丝" | "系统";
};

export type Recording = {
  id: string;
  member: string;
  title: string;
  date: string;
  duration: string;
  danmaku: number;
  status: "已解析" | "待处理";
};

export const demoMembers: Member[] = [
  { id: "snr", name: "宋昕冉", pinyin: "songxinran", group: "SNH48", team: "Team SII", initials: "冉", accent: "#e76f51", messages: 286, activeDays: 24, recordings: 18, lastActive: "2026-10-17" },
  { id: "snh", name: "沈小爱", pinyin: "shenxiaoai", group: "SNH48", team: "Team HII", initials: "爱", accent: "#2a9d8f", messages: 241, activeDays: 22, recordings: 15, lastActive: "2026-10-17" },
  { id: "zjy", name: "张琼予", pinyin: "zhangqiongyu", group: "SNH48", team: "Team SII", initials: "予", accent: "#e9c46a", messages: 198, activeDays: 19, recordings: 12, lastActive: "2026-10-16" },
  { id: "lyx", name: "刘力菲", pinyin: "liulifei", group: "GNZ48", team: "Team G", initials: "菲", accent: "#457b9d", messages: 176, activeDays: 18, recordings: 9, lastActive: "2026-10-17" },
  { id: "syt", name: "苏杉杉", pinyin: "sushanshan", group: "SNH48", team: "Team X", initials: "杉", accent: "#9b5de5", messages: 164, activeDays: 17, recordings: 11, lastActive: "2026-10-15" },
  { id: "mcy", name: "莫寒", pinyin: "mohan", group: "SNH48", team: "Team SII", initials: "寒", accent: "#577590", messages: 153, activeDays: 16, recordings: 8, lastActive: "2026-10-14" },
];

export const demoMessages: Message[] = [
  { id: "m-1", memberId: "snr", member: "宋昕冉", type: "TEXT", text: "今天的排练顺利结束啦，大家晚安。", time: "2026-10-17 23:18", sender: "宋昕冉", senderType: "成员" },
  { id: "m-2", memberId: "snh", member: "沈小爱", type: "IMAGE", text: "分享图片", time: "2026-10-17 22:46", sender: "沈小爱", senderType: "成员" },
  { id: "m-3", memberId: "zjy", member: "张琼予", type: "REPLY", text: "谢谢你的祝福，演出见！", time: "2026-10-17 21:32", sender: "张琼予", senderType: "成员" },
  { id: "m-4", memberId: "lyx", member: "刘力菲", type: "TEXT", text: "广州今天降温了，出门记得加衣服。", time: "2026-10-17 20:51", sender: "刘力菲", senderType: "成员" },
  { id: "m-5", memberId: "snr", member: "宋昕冉", type: "AUDIO", text: "语音消息", time: "2026-10-17 19:08", sender: "粉丝小满", senderType: "粉丝" },
  { id: "m-6", memberId: "syt", member: "苏杉杉", type: "TEXT", text: "新公演的舞台大家有看吗？", time: "2026-10-17 18:24", sender: "苏杉杉", senderType: "成员" },
  { id: "m-7", memberId: "mcy", member: "莫寒", type: "REPLY", text: "收到啦，感谢一直以来的支持。", time: "2026-10-17 16:40", sender: "莫寒", senderType: "成员" },
];

export const demoRecordings: Recording[] = [
  { id: "r-1", member: "宋昕冉", title: "晚间电台｜排练后的闲聊", date: "2026-10-17", duration: "01:12:38", danmaku: 1842, status: "已解析" },
  { id: "r-2", member: "沈小爱", title: "下班啦，来聊天吧", date: "2026-10-16", duration: "00:48:12", danmaku: 1260, status: "已解析" },
  { id: "r-3", member: "刘力菲", title: "广州场公演后记", date: "2026-10-16", duration: "00:35:47", danmaku: 904, status: "已解析" },
  { id: "r-4", member: "张琼予", title: "周末歌单分享", date: "2026-10-15", duration: "00:52:05", danmaku: 731, status: "待处理" },
  { id: "r-5", member: "苏杉杉", title: "新公演准备中", date: "2026-10-14", duration: "01:03:19", danmaku: 1188, status: "已解析" },
];

export const demoDailyActivity = [36, 42, 28, 55, 48, 62, 51, 75, 67, 44, 81, 72, 58, 88];
