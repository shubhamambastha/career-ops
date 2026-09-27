import type { Settings } from "./types";

const s = (name: string, aliases: string[] = [], weight = 1) => ({ name, aliases, weight });

/**
 * Default settings, seeded from Shubham's resume (Overall / BE / Frontend PDFs)
 * and career-ops config/profile.yml. Everything here is editable in Settings.
 */
export const DEFAULT_SETTINGS: Settings = {
  profile: {
    name: "Shubham Ambastha",
    email: "shubhams.saurav@gmail.com",
    phone: "+91-8602167858",
    linkedin: "https://www.linkedin.com/in/shubhamambastha",
    portfolio: "https://shubhamambastha.dev",
    location: "Raipur, India",
  },
  resumeFolder: "",
  careerOps: {
    syncTracker: true,
    claudeCommand: "claude",
    model: "",
    permission: "allowlist",
    allowedTools: "Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, Bash(node *), Bash(npx *), Bash(ls *), Bash(mkdir *), Bash(cat *), Bash(date *)",
    scanSinceDays: 14,
    scanVerify: false,
  },
  sources: [
    {
      id: "jsgurujobs",
      url: "https://jsgurujobs.com/jobs",
      enabled: true,
      sweepDepth: 700,
      delayMs: 1200,
      refreshAfterDays: 7,
    },
  ],
  scoring: {
    weights: { skills: 35, location: 25, seniority: 20, focus: 12, recency: 8 },
    skills: [
      s("Node.js", ["node", "nodejs", "node js"], 2),
      s("TypeScript", ["ts"], 1.5),
      s("JavaScript", ["js", "es6", "ecmascript"], 1.5),
      s("NestJS", ["nest.js", "nest"], 1.5),
      s("Express", ["express.js", "expressjs"], 1),
      s("React", ["reactjs", "react.js"], 1.5),
      s("Next.js", ["nextjs", "next"], 1),
      s("React Native", [], 1),
      s("Redux", [], 1),
      s("PostgreSQL", ["postgres", "psql"], 1.5),
      s("MySQL", [], 1),
      s("MongoDB", ["mongo", "mongoose"], 1),
      s("Redis", [], 1),
      s("Kafka", ["apache kafka"], 1),
      s("AWS", ["amazon web services", "lambda", "s3", "ec2"], 1.5),
      s("Azure", ["azure functions"], 1),
      s("Docker", [], 1),
      s("Kubernetes", ["k8s"], 1),
      s("CI/CD", ["github actions", "ci", "cd", "jenkins"], 1),
      s("Nginx", [], 1),
      s("Traefik", [], 1),
      s("Git", ["github", "gitlab"], 1),
      s("Python", [], 1),
      s("Java", [], 1),
      s("HTML", ["html5"], 1),
      s("CSS", ["css3", "sass", "scss", "less"], 1),
      s("Tailwind CSS", ["tailwind", "tailwindcss"], 1),
      s("Jest", [], 1),
      s("Cypress", [], 1),
      s("Firebase", [], 1),
      s("REST APIs", ["rest", "restful", "apis", "rest api"], 1),
      s("Microservices", ["microservice"], 1),
      s("GenAI / LLM", ["llm", "ai", "genai", "openai", "claude", "llm apis"], 1),
      s("WebSockets", ["websocket", "socket.io"], 1),
      s("JMeter", ["load testing"], 1),
    ],
    location: {
      homeCountry: "India",
      homeAliases: ["bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "ncr", "noida", "gurugram", "gurgaon", "hyderabad", "pune", "chennai", "kolkata", "ahmedabad", "mohali", "chandigarh", "jaipur", "indore", "raipur", "kochi", "trivandrum", "coimbatore"],
      blockedMaxScore: 40,
      acceptedRegions: ["worldwide", "anywhere", "global", "apac", "asia", "india", "remote worldwide"],
      blockPhrases: [
        "us only",
        "usa only",
        "united states only",
        "must reside in",
        "must be based in",
        "eu only",
        "emea",
        "europe only",
        "latam",
        "latin america",
        "canada only",
        "uk only",
        "us citizens",
        "green card",
        "utc-3 to utc+3",
      ],
      points: { remoteEligible: 100, homeOnsite: 60, unclear: 50, blocked: 0 },
    },
    seniority: {
      myYears: 6,
      unknownPoints: 85,
      penaltyPerYearOver: 20,
      tooJuniorGap: 5,
      tooJuniorPoints: 30,
      titleRules: [
        { pattern: "\\b(intern|internship|trainee|junior|jr\\.?|graduate)\\b", points: -40, label: "Junior title" },
        { pattern: "\\b(middle|mid[- ]level|intermediate)\\b", points: -20, label: "Mid-level title" },
        { pattern: "\\b(principal|head of|director|vp)\\b", points: -15, label: "Very senior title" },
        { pattern: "\\b(senior|sr\\.?|lead|staff|sde[- ]?(iii|3))\\b", points: 5, label: "Senior/lead title" },
      ],
    },
    focus: { backend: 100, fullstack: 95, frontend: 75, other: 40 },
    recency: { halfLifeDays: 60 },
    keywordRules: [
      { pattern: "\\b(nestjs|nest\\.js)\\b", points: 3, label: "NestJS" },
      { pattern: "\\b(php|laravel|wordpress|ruby on rails|rails|\\.net|c#)\\b", points: -8, label: "Non-JS backend stack" },
      { pattern: "\\b(solana|web3|blockchain|smart contract)\\b", points: -4, label: "Web3" },
    ],
    tiers: { A: 85, B: 72, C: 60 },
    hideBlocked: false,
    hideGone: true,
  },
  resumes: [
    {
      id: "backend",
      label: "Backend",
      file: "Shubham Ambastha Resume BE.pdf",
      focus: ["backend"],
      keywords: ["node", "nestjs", "express", "backend", "api", "microservices", "postgres", "mongodb", "redis", "kafka", "aws", "docker", "kubernetes", "platform"],
    },
    {
      id: "frontend",
      label: "Frontend",
      file: "Shubham Ambastha Frontend.pdf",
      focus: ["frontend"],
      keywords: ["react", "next.js", "frontend", "front-end", "ui", "redux", "tailwind", "css", "design system", "accessibility", "vue", "angular"],
    },
    {
      id: "overall",
      label: "Overall (Full-stack)",
      file: "Shubham Ambastha Resume.pdf",
      focus: ["fullstack", "other"],
      keywords: ["full stack", "fullstack", "full-stack", "react", "node", "aws", "product engineer"],
      isDefault: true,
    },
  ],
  email: {
    client: "gmail",
    subject: "Application for {{title}} — {{name}}",
    body: `Hi {{company}} team,

I came across the {{title}} role on {{source}} and would love to be considered. I'm a software engineer with {{years}}+ years of experience building scalable web applications with Node.js, React, TypeScript and AWS, and I'm currently based in {{location}}.

Relevant to this role: {{matchedSkills}}.

I've attached my resume ({{resumeLabel}}). I'd be glad to share more details or jump on a call.

Thanks,
{{name}}
{{phone}}
{{linkedin}}

Job link: {{url}}`,
  },
};
