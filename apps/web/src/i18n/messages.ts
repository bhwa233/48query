import type { Locale } from "./config";
import { siteConfig } from "../config/site.ts";

export const messages = {
  en: {
    content: {
      navigation: "Articles",
      title: "Articles",
      description: "Guides, ideas, and updates worth sharing.",
      back: "Back to articles",
      articles: {
        welcome: {
          title: "A place to start",
          description:
            "A first page for your ideas and the people who will read them.",
        },
      },
    },
    errors: {
      title: "Something went wrong",
      description: "Please try again.",
      retry: "Try again",
      notFound: "Page not found",
      notFoundText: "This page could not be found.",
      home: "Back to home",
      loading: "Loading…",
    },
    notes: {
      title: "Optional D1 example",
      description:
        "Load or create notes after starting the D1 API profile and applying local migrations.",
      label: "Note title",
      placeholder: "A short note",
      load: "Load notes",
      create: "Create note",
      busy: "Working…",
      empty: "No notes yet.",
      unavailable: "D1 is not configured or initialized.",
      failure: "Could not reach the notes API.",
      created: "Note created.",
      loaded: "Notes loaded.",
    },
    siteName: siteConfig.name,
    navigation: "Primary navigation",
    exampleLink: "Example",
    footer: "Built for Cloudflare Workers.",
    metadataDescription:
      "A small, reusable web product template for Cloudflare.",
    theme: {
      toggleLabel: "Change theme",
      themeLightLabel: "Light",
      themeDarkLabel: "Dark",
      themeSystemLabel: "System",
    },
    home: {
      webTitle: "Vinext + React",
      webText: "Server-rendered pages with small client islands.",
      serverTitle: "Hono + OpenAPI",
      serverText: "A typed API with health, echo, and documentation routes.",
      dataTitle: "D1 when needed",
      dataText: "An isolated notes example enabled by one database binding.",
      eyebrow: "Reusable foundation",
      title: "Start with a clear, production-ready baseline.",
      description:
        "A minimal Vinext and React web app with an optional Hono API and D1 example. Keep the foundation, replace the product.",
      primary: "Try the API example",
      secondary: "Read the structure",
      apiTitle: "API and data are optional",
      apiText:
        "The web app runs on its own. Add the API when a project needs server routes, OpenAPI, or D1 persistence.",
      structureTitle: "A small surface that scales",
      structureText:
        "Server-rendered page shells, focused client islands, shared contracts, and Cloudflare-native deployment settings.",
      exampleTitle: "Interactive example",
      exampleText:
        "Send a message to the API when NEXT_PUBLIC_API_BASE_URL is configured.",
      inputPlaceholder: "Type a short message",
      send: "Send",
      loading: "Sending…",
      success: "API responded successfully.",
      unavailable:
        "API is not configured. Set NEXT_PUBLIC_API_BASE_URL to try it.",
      error: "The API request failed. Check the API dev server and URL.",
    },
  },
  zh: {
    content: {
      navigation: "文章",
      title: "文章",
      description: "分享指南、想法与产品进展。",
      back: "返回文章列表",
      articles: {
        welcome: {
          title: "从这里开始",
          description: "给你的想法，以及即将阅读它们的人，一个起点。",
        },
      },
    },
    errors: {
      title: "出现了一些问题",
      description: "请重试。",
      retry: "重试",
      notFound: "页面不存在",
      notFoundText: "未找到此页面。",
      home: "返回首页",
      loading: "加载中…",
    },
    notes: {
      title: "可选 D1 示例",
      description: "启动 D1 API 配置并应用本地迁移后，可以读取和创建笔记。",
      label: "笔记标题",
      placeholder: "一条简短笔记",
      load: "读取笔记",
      create: "创建笔记",
      busy: "处理中…",
      empty: "暂无笔记。",
      unavailable: "尚未配置或初始化 D1。",
      failure: "无法连接笔记 API。",
      created: "笔记已创建。",
      loaded: "已读取笔记。",
    },
    siteName: siteConfig.name,
    navigation: "主导航",
    exampleLink: "示例",
    footer: "基于 Cloudflare Workers 构建。",
    metadataDescription: "面向 Cloudflare 的小型可复用 Web 产品模板。",
    theme: {
      toggleLabel: "切换主题",
      themeLightLabel: "浅色",
      themeDarkLabel: "深色",
      themeSystemLabel: "跟随系统",
    },
    home: {
      webTitle: "Vinext + React",
      webText: "服务端渲染页面，搭配局部客户端交互。",
      serverTitle: "Hono + OpenAPI",
      serverText: "类型明确的 API，包含健康检查、回显与文档。",
      dataTitle: "按需启用 D1",
      dataText: "通过独立数据库绑定启用 notes 示例。",
      eyebrow: "可复用基础",
      title: "从清晰、可上线的基础开始。",
      description:
        "一个精简的 Vinext + React Web 应用，可按需加入 Hono API 和 D1 示例。保留基础，替换产品。",
      primary: "试用 API 示例",
      secondary: "查看结构",
      apiTitle: "API 和数据层按需启用",
      apiText:
        "Web 应用可以独立运行。需要服务端路由、OpenAPI 或 D1 持久化时再启用 API。",
      structureTitle: "小而可扩展的基础",
      structureText:
        "服务端页面壳、局部客户端交互、共享契约，以及面向 Cloudflare 的部署配置。",
      exampleTitle: "交互示例",
      exampleText: "配置 NEXT_PUBLIC_API_BASE_URL 后，可以向 API 发送消息。",
      inputPlaceholder: "输入一段简短消息",
      send: "发送",
      loading: "发送中…",
      success: "API 返回成功。",
      unavailable: "尚未配置 API。设置 NEXT_PUBLIC_API_BASE_URL 后即可试用。",
      error: "API 请求失败，请检查 API 开发服务和地址。",
    },
  },
} satisfies Record<
  Locale,
  {
    siteName: string;
    navigation: string;
    exampleLink: string;
    footer: string;
    metadataDescription: string;
    theme: Record<string, string>;
    home: Record<string, string>;
    errors: Record<string, string>;
    notes: Record<string, string>;
    content: {
      navigation: string;
      title: string;
      description: string;
      back: string;
      articles: Record<string, { title: string; description: string }>;
    };
  }
>;
