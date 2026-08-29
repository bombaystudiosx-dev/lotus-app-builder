"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Sparkles,
  RefreshCw, Code2, Zap, ImageIcon, X, ChevronDown,
  Plus, Upload, FileText, Brain, Bot, Cpu,
  Download, Copy, Eye, Check, RotateCcw,
  Plug, BookOpen, Folder, Grid2X2, Menu, Rocket, Settings,
} from "lucide-react";
import { PreviewWorkbench } from "@/components/lotus/preview-workbench";
import { EditorWorkspace } from "@/components/lotus/editor-workspace";
import { type EditorFile } from "@/lib/editor-workspace";
import { buildProjectPreviewAction, runBuildAction, type WorkspaceMessage } from "@/app/actions/projects";
import { toast } from "sonner";
import { redactSensitiveValues } from "@/lib/safety";
import Image from "next/image";
import Link from "next/link";
import { assembleStaticPreview, type PreviewDiagnostic } from "@/lib/preview-runtime";
import { AuthSignOut } from "@/components/auth-sign-out";

const logoLotus = "/logo_lotus.png";


// ─── Types ───────────────────────────────────────────────────────────────────
type DeviceMode = "phone" | "tablet" | "desktop";
type BuildView  = "preview" | "code" | "deployed";

interface ChatMessage { id: string; role: "user" | "assistant"; content: string; ts: Date; }
interface UploadedFile { id: string; name: string; type: "file" | "image"; mime: string; }
interface ToggleItem   { id: string; name: string; desc: string; on: boolean; }
interface Connector    { id: string; name: string; desc: string; connected: boolean; }
interface Capability   { id: string; name: string; desc: string; category: string; active: boolean; }

// ─── Mock data ────────────────────────────────────────────────────────────────
const MODELS = ["Enigma Auto", "GPT-4.1", "Claude Sonnet", "Claude Opus", "Gemini Pro", "DeepSeek Coder"];

const INIT_CONNECTORS: Connector[] = [
  { id:"sup", name:"Supabase",        desc:"Postgres database & auth",       connected:false },
  { id:"fir", name:"Firebase",        desc:"Realtime DB & hosting",          connected:false },
  { id:"git", name:"GitHub",          desc:"Source control & CI",            connected:false },
  { id:"ver", name:"Vercel",          desc:"Deploy & edge functions",        connected:false },
  { id:"str", name:"Stripe",          desc:"Payments & subscriptions",       connected:false },
  { id:"oar", name:"OpenRouter",      desc:"Multi-model API gateway",        connected:false },
  { id:"oai", name:"OpenAI",          desc:"GPT models & DALL-E",            connected:false },
  { id:"ant", name:"Anthropic",       desc:"Claude models",                  connected:false },
  { id:"gdr", name:"Google Drive",    desc:"File storage & docs",            connected:false },
  { id:"gml", name:"Gmail",           desc:"Email send & receive",           connected:false },
  { id:"gcl", name:"Google Calendar", desc:"Events & scheduling",            connected:false },
  { id:"apl", name:"Apple Developer", desc:"App Store & push certs",         connected:false },
  { id:"gpc", name:"Play Console",    desc:"Google Play distribution",       connected:false },
  { id:"ble", name:"Bluetooth",       desc:"BLE device connectivity",        connected:false },
  { id:"cam", name:"Camera",          desc:"Device camera access",           connected:false },
  { id:"mic", name:"Microphone",      desc:"Audio capture",                  connected:false },
  { id:"psh", name:"Push Notifications", desc:"Cross-platform push",         connected:false },
  { id:"map", name:"Maps / Location", desc:"GPS & map rendering",            connected:false },
];

const INIT_SKILLS: ToggleItem[] = [
  { id:"uip", name:"UI Polish",           desc:"Refine spacing, type, color", on:false },
  { id:"lpb", name:"Landing Page Builder",desc:"Generate marketing pages",    on:false },
  { id:"aus", name:"Auth Setup",          desc:"Adds auth flows",             on:true  },
  { id:"ssc", name:"Supabase Schema",     desc:"Design DB tables",            on:false },
  { id:"asp", name:"App Store Prep",      desc:"Checklist & assets",          on:false },
  { id:"psp", name:"Play Store Prep",     desc:"Checklist & assets",          on:false },
  { id:"seo", name:"SEO Setup",           desc:"Meta tags & sitemaps",        on:false },
  { id:"cpw", name:"Copywriter",          desc:"AI-written UI copy",          on:true  },
  { id:"bug", name:"Bug Fixer",           desc:"Detect & fix issues",         on:false },
  { id:"pay", name:"Payment Flow",        desc:"Stripe checkout setup",       on:false },
  { id:"img", name:"Image Generator",     desc:"AI images inline",            on:false },
  { id:"dim", name:"Data Importer",       desc:"CSV/JSON ingestion",          on:false },
];

const INIT_AGENTS: ToggleItem[] = [
  { id:"pa",  name:"Product Architect",    desc:"Shapes features & flows",    on:true  },
  { id:"uid", name:"UI Designer",          desc:"Visual polish & layout",     on:true  },
  { id:"be",  name:"Backend Engineer",     desc:"API & server logic",         on:false },
  { id:"mob", name:"Mobile App Engineer",  desc:"React Native & Expo",        on:false },
  { id:"db",  name:"Database Planner",     desc:"Schema & indexing",          on:false },
  { id:"qa",  name:"QA Tester",            desc:"Test cases & coverage",      on:false },
  { id:"as",  name:"App Store Strategist", desc:"ASO & store copy",           on:false },
  { id:"gs",  name:"Growth Strategist",    desc:"Retention & funnels",        on:false },
  { id:"sec", name:"Security Reviewer",    desc:"Audits & vulnerabilities",   on:false },
  { id:"dep", name:"Deployment Manager",   desc:"CI/CD & infra",              on:false },
];

const INIT_CAPS: Capability[] = [
  // Device
  { id:"d1", name:"Bluetooth",         category:"Device",  desc:"BLE scanning & pairing",       active:false },
  { id:"d2", name:"Camera",            category:"Device",  desc:"Photo & video capture",         active:false },
  { id:"d3", name:"Microphone",        category:"Device",  desc:"Audio input",                   active:false },
  { id:"d4", name:"Push Notifications",category:"Device",  desc:"OS-level alerts",               active:false },
  { id:"d5", name:"Location Services", category:"Device",  desc:"GPS & geofencing",              active:false },
  { id:"d6", name:"Contacts",          category:"Device",  desc:"Address book access",           active:false },
  { id:"d7", name:"Calendar Access",   category:"Device",  desc:"Read/write calendar events",    active:false },
  { id:"d8", name:"File System Access",category:"Device",  desc:"Local file read/write",         active:false },
  { id:"d9", name:"Offline Mode",      category:"Device",  desc:"Service worker & cache",        active:false },
  // App
  { id:"a1", name:"User Authentication",category:"App",    desc:"Login, signup, OAuth",          active:true  },
  { id:"a2", name:"Payments",          category:"App",     desc:"One-time charges",              active:false },
  { id:"a3", name:"Subscriptions",     category:"App",     desc:"Recurring billing",             active:false },
  { id:"a4", name:"Chat",              category:"App",     desc:"Real-time messaging",           active:false },
  { id:"a5", name:"Image Upload",      category:"App",     desc:"S3/Supabase storage",           active:false },
  { id:"a6", name:"Video Upload",      category:"App",     desc:"Video storage & streaming",     active:false },
  { id:"a7", name:"Admin Dashboard",   category:"App",     desc:"Internal management UI",        active:false },
  { id:"a8", name:"Analytics",         category:"App",     desc:"Event tracking & funnels",      active:false },
  { id:"a9", name:"Search",            category:"App",     desc:"Full-text search",              active:false },
  { id:"a10",name:"Notifications",     category:"App",     desc:"In-app alert system",           active:false },
  { id:"a11",name:"Export Data",       category:"App",     desc:"CSV/JSON data export",          active:false },
  // AI
  { id:"ai1",name:"Text Generation",   category:"AI",      desc:"LLM-powered content",           active:true  },
  { id:"ai2",name:"Image Generation",  category:"AI",      desc:"DALL-E / Stable Diffusion",     active:false },
  { id:"ai3",name:"Audio Transcription",category:"AI",     desc:"Whisper-style STT",             active:false },
  { id:"ai4",name:"Voice Generation",  category:"AI",      desc:"TTS synthesis",                 active:false },
  { id:"ai5",name:"Code Generation",   category:"AI",      desc:"AI-assisted coding",            active:true  },
  { id:"ai6",name:"Document Analysis", category:"AI",      desc:"PDF / doc parsing",             active:false },
  { id:"ai7",name:"Workflow Automation",category:"AI",     desc:"Multi-step agent pipelines",    active:false },
];

const PLUS_ITEMS = [
  { icon:<Upload size={12}/>,   label:"Upload File"         },
  { icon:<ImageIcon size={12}/>,label:"Upload Image"        },
  { icon:<Plug size={12}/>,     label:"Add Connector"       },
  { icon:<Sparkles size={12}/>, label:"Add Skill"           },
  { icon:<Bot size={12}/>,      label:"Add Agent"           },
  { icon:<Cpu size={12}/>,      label:"Add Function"        },
];

const INIT_MESSAGES: ChatMessage[] = [
  { id:"1", role:"assistant", content:"Welcome to Lotus. Describe the app you want to build — I'll bring it to life.", ts: new Date(Date.now()-120000) },
];


// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: Date) { return d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }); }

function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon size={10}/>;
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("typescript")) return <Code2 size={10}/>;
  return <FileText size={10}/>;
}

function downloadGeneratedApp(html: string | null) {
  if (!html) { toast.error("Generate an app first — then you can export it."); return; }
  const url = URL.createObjectURL(new Blob([html], { type:"text/html" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "lotus-preview.html";
  anchor.click();
  URL.revokeObjectURL(url);
}
async function copyGeneratedAppSource(html: string | null) {
  if (!html) { toast.error("Generate an app first — then you can copy its HTML."); return; }
  try {
    await navigator.clipboard.writeText(html);
    toast.success("Preview HTML copied to your clipboard.");
  } catch {
    toast.error("Could not access the clipboard in this context.");
  }
}

export function EmptyPreview() {
  return (
    <div
      className="h-full w-full overflow-auto p-5 sm:p-8"
      style={{
        background:
          "radial-gradient(circle at 50% 12%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 42%), var(--muted)",
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <section
          aria-label="Phone preview screen"
          className="relative flex h-[min(640px,calc(100vh-190px))] min-h-[440px] w-[min(312px,calc(100vw-3rem))] shrink-0 flex-col overflow-hidden rounded-[2.6rem] border-[7px] shadow-[0_24px_70px_rgba(30,18,6,0.22)]"
          style={{ background:"var(--card)", borderColor:"var(--foreground)" }}
        >
          <div className="absolute left-1/2 top-2 z-10 h-6 w-24 -translate-x-1/2 rounded-full" style={{ background:"var(--foreground)" }} />
          <div className="flex items-center justify-between px-6 pb-3 pt-4 text-[10px] font-semibold" style={{ color:"var(--foreground)" }} aria-hidden="true">
            <span>9:41</span>
            <span className="tracking-widest">● ◒ ▰</span>
          </div>
          <div className="mx-3 flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ background:"var(--background)", borderColor:"var(--border)" }}>
            <div className="flex h-7 w-7 items-center justify-center rounded-xl" style={{ background:"color-mix(in srgb, var(--accent) 14%, transparent)" }}>
              <Sparkles size={13} style={{ color:"var(--accent)" }}/>
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold" style={{ color:"var(--foreground)" }}>Untitled app</p>
              <p className="text-[9px]" style={{ color:"var(--muted-foreground)" }}>Live preview</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background:"color-mix(in srgb, var(--accent) 14%, transparent)", border:"1px solid color-mix(in srgb, var(--accent) 24%, transparent)" }}>
              <Sparkles size={21} style={{ color:"var(--accent)" }}/>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>Start building</p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color:"var(--muted-foreground)" }}>Describe what you want to build in the chat.</p>
            </div>
          </div>
          <div className="mx-auto mb-2 h-1 w-24 rounded-full" style={{ background:"var(--foreground)", opacity:0.7 }} aria-hidden="true" />
        </section>
      </div>
    </div>
  );
}
// ─── Deployed panel ───────────────────────────────────────────────────────────
function DeployedPanel({ html, projectName }:{ html:string|null; projectName:string }) {
  const ready = !!html;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background:"rgba(200,146,42,0.12)", border:"1px solid rgba(200,146,42,0.2)" }}>
        <Zap size={20} className="text-accent"/>
      </div>
      <div className="text-center">
        <h3 style={{ fontFamily:"Fraunces,serif", fontSize:18, fontWeight:500, color:"var(--foreground)", marginBottom:6 }}>
          {ready ? `“${projectName}” is ready` : "Ready to deploy"}
        </h3>
        <p style={{ fontSize:12, color:"var(--muted-foreground)", maxWidth:300, lineHeight:1.6 }}>
          {ready
            ? "Your app is built and ready to export as an inert HTML file."
            : "Describe an app in chat to generate it — then you can export or copy its HTML."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 mt-2 justify-center">
        <button onClick={()=>downloadGeneratedApp(html)} disabled={!ready}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ background:"var(--primary)", color:"var(--primary-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>
          <Download size={12}/> Download Preview
        </button>
        <button onClick={()=>copyGeneratedAppSource(html)} disabled={!ready}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ background:"var(--muted)", color:"var(--muted-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>
          <Copy size={12}/> Copy HTML
        </button>
      </div>
    </div>
  );
}

// ─── Overlay modal shell ──────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title:string; onClose:()=>void; children:React.ReactNode }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
      <div className="absolute inset-0" style={{ background:"rgba(30,18,6,0.5)", backdropFilter:"blur(4px)" }} onClick={onClose}/>
      <motion.div className="relative w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{ background:"var(--card)", border:"1px solid var(--border)", maxHeight:"80vh", boxShadow:"0 32px 80px rgba(0,0,0,0.25)" }}
        initial={{ y:24, scale:0.97 }} animate={{ y:0, scale:1 }} exit={{ y:24, scale:0.97 }}
        transition={{ duration:0.25, ease:[0.22,1,0.36,1] }}>
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom:"1px solid var(--border)" }}>
          <span style={{ fontFamily:"Fraunces,serif", fontSize:16, fontWeight:500, color:"var(--foreground)" }}>{title}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:opacity-70" style={{ background:"var(--muted)", color:"var(--muted-foreground)" }}><X size={13}/></button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth:"none" }}>{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ─── Connector panel ──────────────────────────────────────────────────────────
function ConnectorPanel({ connectors, onToggle, onClose }:{ connectors:Connector[]; onToggle:(id:string)=>void; onClose:()=>void }) {
  return (
    <Modal title="Connectors" onClose={onClose}>
      <div className="p-4 flex flex-col gap-2">
        {connectors.map(c=>(
          <div key={c.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background:"var(--background)" }}>
            <div>
              <p style={{ fontSize:13, fontWeight:500, color:"var(--foreground)" }}>{c.name}</p>
              <p style={{ fontSize:11, color:"var(--muted-foreground)", marginTop:1 }}>{c.desc}</p>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ fontSize:9, fontWeight:600, letterSpacing:"0.05em", padding:"2px 8px", borderRadius:999, background:c.connected?"rgba(107,203,119,0.15)":"var(--muted)", color:c.connected?"#3A8A44":"var(--muted-foreground)" }}>
                {c.connected?"Connected":"Not Connected"}
              </span>
              <button onClick={()=>onToggle(c.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                style={{ background:c.connected?"var(--muted)":"var(--accent)", color:c.connected?"var(--muted-foreground)":"var(--accent-foreground)" }}>
                {c.connected?"Disconnect":"Connect"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Skills panel ─────────────────────────────────────────────────────────────
function SkillsPanel({ skills, onToggle, onClose }:{ skills:ToggleItem[]; onToggle:(id:string)=>void; onClose:()=>void }) {
  return (
    <Modal title="Skills" onClose={onClose}>
      <div className="p-4 flex flex-col gap-2">
        {skills.map(s=>(
          <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background:"var(--background)" }}>
            <div>
              <p style={{ fontSize:13, fontWeight:500, color:"var(--foreground)" }}>{s.name}</p>
              <p style={{ fontSize:11, color:"var(--muted-foreground)", marginTop:1 }}>{s.desc}</p>
            </div>
            <button onClick={()=>onToggle(s.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:s.on?"var(--accent)":"var(--muted)", color:s.on?"var(--accent-foreground)":"var(--muted-foreground)" }}>
              {s.on?"On":"Off"}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Agents panel ─────────────────────────────────────────────────────────────
function AgentsPanel({ agents, onToggle, onClose }:{ agents:ToggleItem[]; onToggle:(id:string)=>void; onClose:()=>void }) {
  return (
    <Modal title="Agents" onClose={onClose}>
      <div className="p-4 flex flex-col gap-2">
        {agents.map(a=>(
          <div key={a.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background:"var(--background)" }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:"rgba(200,146,42,0.1)" }}>
                <Bot size={14} className="text-accent"/>
              </div>
              <div>
                <p style={{ fontSize:13, fontWeight:500, color:"var(--foreground)" }}>{a.name}</p>
                <p style={{ fontSize:11, color:"var(--muted-foreground)", marginTop:1 }}>{a.desc}</p>
              </div>
            </div>
            <button onClick={()=>onToggle(a.id)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:a.on?"var(--accent)":"var(--muted)", color:a.on?"var(--accent-foreground)":"var(--muted-foreground)" }}>
              {a.on?"Active":"Off"}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── Functions panel ──────────────────────────────────────────────────────────
function FunctionsPanel({ caps, onToggle, onClose }:{ caps:Capability[]; onToggle:(id:string)=>void; onClose:()=>void }) {
  const active = caps.filter(c=>c.active);
  const cats = Array.from(new Set(caps.map(c=>c.category)));

  return (
    <Modal title="Functions & Capabilities" onClose={onClose}>
      <div className="p-4 flex flex-col gap-4">
        {active.length>0 && (
          <div>
            <p style={{ fontSize:10, fontWeight:600, letterSpacing:"0.06em", color:"var(--accent)", textTransform:"uppercase", marginBottom:8 }}>Active · {active.length}</p>
            <div className="flex flex-wrap gap-1.5">
              {active.map(c=>(
                <div key={c.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full" style={{ background:"rgba(200,146,42,0.12)", border:"1px solid rgba(200,146,42,0.2)" }}>
                  <span style={{ fontSize:11, color:"var(--accent)", fontWeight:500 }}>{c.name}</span>
                  <button onClick={()=>onToggle(c.id)}><X size={9} className="text-accent"/></button>
                </div>
              ))}
            </div>
          </div>
        )}
        {cats.map(cat=>(
          <div key={cat}>
            <p style={{ fontSize:10, fontWeight:600, letterSpacing:"0.06em", color:"var(--muted-foreground)", textTransform:"uppercase", marginBottom:6 }}>{cat}</p>
            <div className="flex flex-col gap-1.5">
              {caps.filter(c=>c.category===cat).map(c=>(
                <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background:"var(--background)" }}>
                  <div>
                    <p style={{ fontSize:12, fontWeight:500, color:"var(--foreground)" }}>{c.name}</p>
                    <p style={{ fontSize:10, color:"var(--muted-foreground)" }}>{c.desc}</p>
                  </div>
                  <button onClick={()=>onToggle(c.id)} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
                    style={{ background:c.active?"var(--accent)":"var(--muted)", color:c.active?"var(--accent-foreground)":"var(--muted-foreground)" }}>
                    {c.active?"Added":"Add"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ─── View App modal ───────────────────────────────────────────────────────────
function ViewAppMenu({ onClose, html }:{ onClose:()=>void; html:string|null }) {
  const ready = !!html;
  return (
    <Modal title="View App" onClose={onClose}>
      <div className="p-4">
        <div className="flex flex-col gap-3">
          <div>
            <label style={{ fontSize:10, fontWeight:600, color:"var(--muted-foreground)", letterSpacing:"0.05em", textTransform:"uppercase", display:"block", marginBottom:4 }}>Status</label>
            <div className="rounded-lg px-3 py-2 text-xs" style={{ background:"var(--background)", border:"1px solid var(--border)", color:ready?"var(--foreground)":"var(--muted-foreground)" }}>
              {ready ? "Your app is built and ready to export safely." : "No app generated yet — describe one in chat first."}
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={()=>downloadGeneratedApp(html)} disabled={!ready}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:"var(--primary)", color:"var(--primary-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>Download Preview</button>
            <button onClick={()=>copyGeneratedAppSource(html)} disabled={!ready}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:"var(--muted)", color:"var(--muted-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>Copy HTML</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mb-3" style={{ background:"rgba(200,146,42,0.15)" }}>
        <Sparkles size={9} className="text-accent"/>
      </div>
      <div className="px-3 py-2.5 rounded-2xl rounded-bl-sm" style={{ background:"var(--card)" }}>
        <div className="flex gap-1 items-center h-3">
          {[0,1,2].map(i=>(
            <motion.div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background:"var(--muted-foreground)" }}
              animate={{ opacity:[0.3,1,0.3], y:[0,-3,0] }}
              transition={{ duration:1, repeat:Infinity, delay:i*0.18, ease:"easeInOut" }}/>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
interface LotusBuilderProps {
  initial: {
    projectId: string | null;
    name: string;
    html: string | null;
    messages: WorkspaceMessage[];
    userName: string;
    editorFontSize: number;
    defaultDevice: DeviceMode;
    theme: "system" | "light" | "dark";
    files: EditorFile[];
    entryPath: string;
    runtime: "static" | "react";
  };
}

export default function App({ initial }: LotusBuilderProps) {
  const initialMessages: ChatMessage[] = initial.messages.length
    ? initial.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, ts: new Date(m.ts) }))
    : INIT_MESSAGES;

  // Core
  const [messages,  setMessages]  = useState<ChatMessage[]>(initialMessages);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [projectName, setProjectName] = useState<string>(initial.name || "Untitled");
  const initialPreview = initial.runtime === "static" ? assembleStaticPreview(initial.files, initial.entryPath) : { html: "", diagnostics: [] };
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(initialPreview.html || null);
  const [previewDiagnostics, setPreviewDiagnostics] = useState<PreviewDiagnostic[]>(initialPreview.diagnostics);
  const [builderFiles, setBuilderFiles] = useState<EditorFile[]>(initial.files);
  const [entryPath, setEntryPath] = useState(initial.entryPath);
  const [input,     setInput]     = useState("");
  const [isTyping,  setIsTyping]  = useState(false);
  const [view,      setView]      = useState<BuildView>("preview");

  // Data
  const [selectedModel,  setSelectedModel]  = useState("Enigma Auto");
  const [uploadedFiles,  setUploadedFiles]  = useState<UploadedFile[]>([]);
  const [connectors,     setConnectors]     = useState<Connector[]>(INIT_CONNECTORS);
  const [skills,         setSkills]         = useState<ToggleItem[]>(INIT_SKILLS);
  const [agents,         setAgents]         = useState<ToggleItem[]>(INIT_AGENTS);
  const [capabilities,   setCapabilities]   = useState<Capability[]>(INIT_CAPS);

  // UI open/close
  const [showPlus,      setShowPlus]      = useState(false);
  const [showModel,     setShowModel]     = useState(false);
  const [showConnector, setShowConnector] = useState(false);
  const [showSkills,    setShowSkills]    = useState(false);
  const [showAgents,    setShowAgents]    = useState(false);
  const [showFunctions, setShowFunctions] = useState(false);
  const [showViewApp,   setShowViewApp]   = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Build state
  const [autosaved,    setAutosaved]    = useState(true);
  const [dragKey,      setDragKey]      = useState(0); // reset phone position
  const [,             setHistory]      = useState<{ label:string; html:string|null }[]>([{ label:"Initial build", html: initialPreview.html || null }]);
  const [historyIdx,   setHistoryIdx]   = useState(0);

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const imageInputRef   = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef(0);
  const previewSessionRef = useRef(globalThis.crypto.randomUUID());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    const revision = ++previewRequestRef.current;
    if (initial.runtime === "static") {
      const result = assembleStaticPreview(builderFiles, entryPath);
      if (revision === previewRequestRef.current) {
        setGeneratedHtml(result.html);
        setPreviewDiagnostics(result.diagnostics);
      }
      return;
    }
    if (!projectId) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      buildProjectPreviewAction(projectId, revision, previewSessionRef.current).then((result) => {
        if (cancelled || revision !== previewRequestRef.current) return;
        setGeneratedHtml(result.html);
        setPreviewDiagnostics(result.diagnostics);
      }).catch((error: unknown) => {
        if (!cancelled && revision === previewRequestRef.current) setPreviewDiagnostics([{ severity:"error", message:error instanceof Error ? error.message : "Local build failed." }]);
      });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [builderFiles, entryPath, initial.runtime, projectId]);

  // Counts for context bar
  const activeConnectors  = connectors.filter(c=>c.connected).length;
  const activeSkills      = skills.filter(s=>s.on).length;
  const activeAgents      = agents.filter(a=>a.on).length;
  const activeCaps        = capabilities.filter(c=>c.active).length;

  async function handleSend(text = input.trim()) {
    if (!text || isTyping) return;
    const uid = Date.now().toString();
    const safeText = redactSensitiveValues(text);
    setMessages(p=>[...p,{ id: uid, role:"user", content:safeText, ts:new Date() }]);
    setInput("");
    setIsTyping(true);
    setAutosaved(false);
    try {
      const result = await runBuildAction({
        projectId,
        prompt: text,
        model: selectedModel,
        currentHtml: builderFiles.find(file => file.path === entryPath)?.content ?? generatedHtml,
        context: {
          connectors:   connectors.filter(c=>c.connected).map(c=>c.name),
          skills:       skills.filter(s=>s.on).map(s=>s.name),
          agents:       agents.filter(a=>a.on).map(a=>a.name),
          capabilities: capabilities.filter(c=>c.active).map(c=>c.name),
          attachments:  uploadedFiles.map(f=>f.name),
        },
      });
      if (!result.ok) {
        setMessages(p=>[...p,{ id:(Date.now()+1).toString(), role:"assistant", content:result.error, ts:new Date() }]);
        return;
      }
      const res = result.data;
      setProjectId(res.projectId);
      setProjectName(res.name);
      const nextFiles = builderFiles.map(file => file.path === res.entryPath ? { ...file, content: res.html, version: res.version } : file);
      setBuilderFiles(nextFiles);
      const preview = initial.runtime === "static"
        ? assembleStaticPreview(nextFiles, entryPath)
        : await buildProjectPreviewAction(res.projectId, 0, previewSessionRef.current);
      setGeneratedHtml(preview.html);
      setPreviewDiagnostics(preview.diagnostics);
      setView("preview");
      setMessages(p=>[...p,{ id:(Date.now()+1).toString(), role:"assistant", content:res.reply, ts:new Date() }]);
      setHistory(h=>[...h.slice(0,historyIdx+1), { label:safeText, html:preview.html }]);
      setHistoryIdx(i=>i+1);
    } catch (e) {
      setMessages(p=>[...p,{ id:(Date.now()+1).toString(), role:"assistant", content: e instanceof Error ? e.message : "Something went wrong while building.", ts:new Date() }]);
    } finally {
      setIsTyping(false);
      setAutosaved(true);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>, type:"file"|"image") {
    const files = Array.from(e.target.files||[]);
    const items: UploadedFile[] = files.map(f=>({ id:Math.random().toString(36).slice(2), name:f.name, type, mime:f.type }));
    setUploadedFiles(p=>[...p,...items]);
    e.target.value = "";
  }

  function removeFile(id: string) { setUploadedFiles(p=>p.filter(f=>f.id!==id)); }

  function toggleConnector(id:string) { setConnectors(p=>p.map(c=>c.id===id?{...c,connected:!c.connected}:c)); }
  function toggleSkill(id:string)     { setSkills(p=>p.map(s=>s.id===id?{...s,on:!s.on}:s)); }
  function toggleAgent(id:string)     { setAgents(p=>p.map(a=>a.id===id?{...a,on:!a.on}:a)); }
  function toggleCap(id:string)       { setCapabilities(p=>p.map(c=>c.id===id?{...c,active:!c.active}:c)); }

  const quickActions = [
    { label:"Generate Plan",       text:"Generate a full product plan for this app." },
    { label:"Fix Bugs",            text:"Review the current code and fix any bugs." },
    { label:"Improve UI",          text:"Improve the visual design and polish the UI." },
  ];

  const toolbarBtns: { icon:React.ReactNode; label:string; onClick:()=>void; active?:boolean }[] = [
    { icon:<Plus size={12}/>,      label:"Plus",      onClick:()=>{ setShowPlus(p=>!p); setShowModel(false); } },
    { icon:<Upload size={12}/>,    label:"File",      onClick:()=>fileInputRef.current?.click() },
    { icon:<ImageIcon size={12}/>, label:"Image",     onClick:()=>imageInputRef.current?.click() },
    { icon:<Plug size={12}/>,      label:"Connect",   onClick:()=>setShowConnector(true), active:activeConnectors>0 },
    { icon:<Sparkles size={12}/>,  label:"Skills",    onClick:()=>setShowSkills(true),    active:activeSkills>0 },
    { icon:<Bot size={12}/>,       label:"Agents",    onClick:()=>setShowAgents(true),    active:activeAgents>0 },
    { icon:<Cpu size={12}/>,       label:"Functions", onClick:()=>setShowFunctions(true), active:activeCaps>0 },
  ];

  return (
    <div className="relative size-full flex flex-col overflow-hidden bg-[#fffdfb] text-[#241b16] lg:pl-[248px]" style={{ fontFamily:"Outfit,sans-serif" }}>

      {mobileNavOpen && <button type="button" aria-label="Close navigation overlay" onClick={()=>setMobileNavOpen(false)} className="fixed inset-0 z-40 bg-black/25 lg:hidden"/>}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[#eadfd8] bg-[#fffcfa] px-5 pb-5 pt-7 transition-transform lg:translate-x-0 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`} aria-label="Lotus navigation">
        <button type="button" onClick={()=>setMobileNavOpen(false)} aria-label="Close navigation" className="absolute right-3 top-3 rounded-lg p-2 lg:hidden"><X size={18}/></button>
        <div className="flex flex-col items-center pt-2">
          <Image src={logoLotus} alt="Lotus" width={124} height={124} loading="eager" className="h-[124px] w-[124px] object-contain" />
          <p className="-mt-1 text-[10px] font-semibold tracking-[0.32em] text-[#5d4538]">APP BUILDER</p>
        </div>
        <nav className="mt-8 grid gap-1.5">
          <Link href="/" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#5f4a3f] hover:bg-[#fff6f0]"><Folder size={19}/>Projects</Link>
          <Link href="/?section=templates" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#5f4a3f] hover:bg-[#fff6f0]"><Grid2X2 size={19}/>Templates</Link>
          <button type="button" onClick={()=>{setView("preview");setMobileNavOpen(false)}} className="flex items-center gap-3 rounded-xl bg-[#fff0e5] px-4 py-3 text-left text-sm font-semibold text-[#3c2a20]"><Eye size={19}/>Preview</button>
          <Link href="/?section=deploy" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#5f4a3f] hover:bg-[#fff6f0]"><Rocket size={19}/>Deploy</Link>
        </nav>
        <nav className="mt-auto border-t border-[#eadfd8] pt-4"><Link href="/?section=settings" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-[#5f4a3f] hover:bg-[#fff6f0]"><Settings size={19}/>Settings</Link></nav>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#eadfd8] bg-white px-3 py-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#ffb887] text-sm font-semibold">{initial.userName.trim().slice(0,2).toUpperCase() || "DU"}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{initial.userName}</p><p className="text-xs text-[#806b60]">Account owner</p></div>
          <AuthSignOut compact/>
        </div>
      </aside>

      {/* ── Top bar ── */}
      <header className="flex h-[92px] flex-shrink-0 items-center justify-between gap-4 border-b border-[#f1e8e3] bg-[#fffdfb] px-4 sm:h-[112px] sm:px-8 lg:h-[132px] lg:px-14">

        {/* Logo */}
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={()=>setMobileNavOpen(true)} aria-label="Open navigation" className="rounded-lg p-2 lg:hidden"><Menu size={21}/></button>
          <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-black sm:text-3xl lg:text-4xl">App Builder</h1>
          <p className="mt-1 text-xs text-[#6c584d] sm:mt-2 sm:text-sm lg:text-base">Describe, preview, and deploy your app.</p>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          <Link href="/docs" className="hidden h-12 items-center gap-2 rounded-xl border border-[#eadfd8] bg-white px-5 text-sm font-semibold text-[#49382f] shadow-sm sm:flex"><BookOpen size={21}/>Docs</Link>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Chat panel ── */}
        <aside className="hidden flex-col flex-shrink-0 overflow-hidden" style={{ width:256, borderRight:"1px solid var(--border)", background:"var(--card)" }}>

          {/* Tab: Chat only */}
          <div className="flex-shrink-0 flex items-center px-3 pt-3 pb-0" style={{ borderBottom:"1px solid var(--border)" }}>
            <div className="flex items-center gap-1.5 px-3 py-2 relative" style={{ color:"var(--foreground)" }}>
              <Sparkles size={11}/><span style={{ fontSize:12, fontWeight:500 }}>Chat</span>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background:"var(--accent)" }}/>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col" style={{ scrollbarWidth:"none" }}>
            <AnimatePresence initial={false}>
              {messages.map(msg=>(
                <motion.div key={msg.id}
                  initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.2 }}
                  className={`flex mb-2.5 ${msg.role==="user"?"justify-end":"items-end gap-1.5"}`}>
                  {msg.role==="assistant" && (
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mb-4" style={{ background:"rgba(200,146,42,0.15)" }}>
                      <Sparkles size={8} className="text-accent"/>
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 max-w-[88%]">
                    <div className="px-3 py-2 leading-relaxed" style={{
                      fontSize:11.5,
                      borderRadius:msg.role==="user"?"14px 14px 3px 14px":"14px 14px 14px 3px",
                      background:msg.role==="user"?"var(--primary)":"var(--background)",
                      color:msg.role==="user"?"var(--primary-foreground)":"var(--foreground)",
                      boxShadow:"0 1px 4px rgba(0,0,0,0.05)",
                    }}>{msg.content}</div>
                    <span suppressHydrationWarning className={`px-1 ${msg.role==="user"?"text-right":""}`} style={{ fontSize:9, color:"var(--muted-foreground)" }}>{fmt(msg.ts)}</span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {isTyping && <TypingIndicator/>}
            <div ref={messagesEndRef}/>
          </div>

          {/* Quick actions */}
          <div className="flex-shrink-0 px-3 pb-2 flex flex-wrap gap-1" style={{ borderTop:"1px solid var(--border)", paddingTop:8 }}>
            {quickActions.map(a=>(
              <button key={a.label} onClick={()=>handleSend(a.text)}
                className="px-2 py-1 rounded-lg text-left transition-all hover:opacity-80"
                style={{ background:"var(--muted)", color:"var(--muted-foreground)", fontSize:10, fontWeight:500 }}>
                {a.label}
              </button>
            ))}
          </div>

          {/* Attachment chips */}
          {uploadedFiles.length>0 && (
            <div className="flex-shrink-0 flex flex-wrap gap-1.5 px-3 pb-2">
              {uploadedFiles.map(f=>(
                <div key={f.id} className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background:"rgba(200,146,42,0.1)", border:"1px solid rgba(200,146,42,0.2)" }}>
                  <span className="text-accent">{fileIcon(f.mime)}</span>
                  <span style={{ fontSize:10, color:"var(--accent)", fontWeight:500, maxWidth:80, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</span>
                  <button onClick={()=>removeFile(f.id)}><X size={9} className="text-accent"/></button>
                </div>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="flex-shrink-0 px-3 pb-3">
            {/* Toolbar */}
            <div className="hidden items-center gap-0.5 mb-1.5 relative">
              {/* Plus with popover */}
              <div className="relative">
                <button onClick={()=>{ setShowPlus(p=>!p); setShowModel(false); }}
                  className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:opacity-80"
                  style={{ background:showPlus?"var(--accent)":"var(--muted)", color:showPlus?"var(--accent-foreground)":"var(--muted-foreground)" }}>
                  <Plus size={12}/>
                </button>
                <AnimatePresence>
                  {showPlus && (
                    <motion.div className="absolute bottom-9 left-0 z-40 rounded-2xl overflow-hidden py-1.5"
                      style={{ background:"var(--card)", border:"1px solid var(--border)", boxShadow:"0 16px 48px rgba(0,0,0,0.18)", width:188, minWidth:"max-content" }}
                      initial={{ opacity:0, y:6, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:4, scale:0.97 }}
                      transition={{ duration:0.18 }}>
                      {PLUS_ITEMS.map(item=>{
                        const actions: Record<string,()=>void> = {
                          "Upload File":   ()=>fileInputRef.current?.click(),
                          "Upload Image":  ()=>imageInputRef.current?.click(),
                          "Add Connector": ()=>setShowConnector(true),
                          "Add Skill":     ()=>setShowSkills(true),
                          "Add Agent":     ()=>setShowAgents(true),
                          "Add Function":  ()=>setShowFunctions(true),
                        };
                        return (
                          <button key={item.label} onClick={()=>{ setShowPlus(false); actions[item.label]?.(); }}
                            className="flex items-center gap-2.5 w-full px-3.5 py-2 text-left transition-colors hover:opacity-80"
                            style={{ fontSize:12, color:"var(--foreground)", fontWeight:400 }}>
                            <span style={{ color:"var(--accent)" }}>{item.icon}</span>{item.label}
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Other tool buttons */}
              {toolbarBtns.slice(1).map(btn=>(
                <button key={btn.label} onClick={btn.onClick}
                  className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:opacity-80 relative"
                  style={{ background:btn.active?"rgba(200,146,42,0.12)":"var(--muted)", color:btn.active?"var(--accent)":"var(--muted-foreground)" }}>
                  {btn.icon}
                  {btn.active && <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full" style={{ background:"var(--accent)" }}/>}
                </button>
              ))}

              {/* Spacer */}
              <div className="flex-1"/>

              {/* Model selector */}
              <div className="relative">
                <button onClick={()=>{ setShowModel(p=>!p); setShowPlus(false); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg transition-all hover:opacity-80"
                  style={{ background:"var(--muted)", color:"var(--muted-foreground)", fontSize:9, fontWeight:600, maxWidth:78, overflow:"hidden" }}>
                  <Brain size={9}/>
                  <span className="truncate">{selectedModel}</span>
                  <ChevronDown size={8}/>
                </button>
                <AnimatePresence>
                  {showModel && (
                    <motion.div className="absolute bottom-9 right-0 z-40 rounded-xl overflow-hidden py-1"
                      style={{ background:"var(--card)", border:"1px solid var(--border)", boxShadow:"0 16px 48px rgba(0,0,0,0.18)", minWidth:148 }}
                      initial={{ opacity:0, y:4, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:4, scale:0.97 }}
                      transition={{ duration:0.15 }}>
                      {MODELS.map(m=>(
                        <button key={m} onClick={()=>{ setSelectedModel(m); setShowModel(false); }}
                          className="flex items-center justify-between w-full px-3.5 py-2 transition-colors hover:opacity-80"
                          style={{ fontSize:11, color:"var(--foreground)", background:m===selectedModel?"var(--muted)":"transparent" }}>
                          {m}{m===selectedModel && <Check size={10} className="text-accent"/>}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Input */}
            <div className="flex items-end gap-2 rounded-2xl px-3 py-2.5" style={{ background:"var(--background)", border:"1.5px solid var(--border)", boxShadow:"0 2px 16px rgba(0,0,0,0.06)" }}>
              <textarea value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); handleSend(); } }}
                placeholder="Describe a change, feature, screen, or function���"
                rows={2}
                className="flex-1 resize-none bg-transparent outline-none leading-relaxed"
                style={{ fontSize:11.5, color:"var(--foreground)", fontFamily:"Outfit,sans-serif", scrollbarWidth:"none" }}/>
              <motion.button whileTap={{ scale:0.88 }} onClick={()=>handleSend()}
                className="flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center transition-all"
                style={{ background:input.trim()?"linear-gradient(135deg,#D4A030,#B87820)":"var(--muted)", color:input.trim()?"#FFF8E8":"var(--muted-foreground)", boxShadow:input.trim()?"0 2px 8px rgba(200,146,42,0.3)":"none" }}>
                <Send size={11}/>
              </motion.button>
            </div>

            {/* Keyboard hint */}
            <p style={{ fontSize:9, color:"var(--muted-foreground)", textAlign:"center", marginTop:4 }}>⏎ Send · ⇧⏎ New line</p>
          </div>

          {/* Hidden file inputs */}
          <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.csv,.json,.zip,.js,.ts,.tsx,.css,.html" multiple onChange={e=>handleFileUpload(e,"file")}/>
          <input ref={imageInputRef} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.svg" multiple onChange={e=>handleFileUpload(e,"image")}/>
        </aside>

        {/* ── Preview / Code / Deployed ── */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#fffdfb] px-2 pb-2 sm:px-5 sm:pb-4 lg:px-8 lg:pb-7">

          {/* Preview toolbar */}
          <div className="flex flex-shrink-0 items-center justify-between py-2 sm:py-3">
            {/* View tabs */}
            <div className="flex items-center gap-1 rounded-xl bg-[#fff4ed] p-1">
              {([["preview","Preview",<Eye key="preview" size={11}/>],["code","Code",<Code2 key="code" size={11}/>],["deployed","Deployed",<Zap key="deployed" size={11}/>]] as const).map(([k,l,icon])=>(
                <button key={k} onClick={()=>setView(k as BuildView)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background:view===k?"#fff":"transparent", color:view===k?"#2b211b":"#806b60", boxShadow:view===k?"0 1px 5px rgba(79,49,31,0.09)":"none" }}>
                  {icon}{l}
                </button>
              ))}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2">
              {view==="preview" && <>
                <button onClick={()=>setDragKey(k=>k+1)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
                  style={{ background:"var(--muted)", color:"var(--muted-foreground)" }}>
                  <RotateCcw size={10}/> Reset
                </button>
                <button onClick={()=>setDragKey(k=>k+1)} aria-label="Reset preview position" className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color:"var(--muted-foreground)" }}><RefreshCw size={12}/></button>
              </>}
            </div>
          </div>


          {/* View content */}
          {view==="preview" && (generatedHtml || previewDiagnostics.length > 0) && <div className="min-h-0 flex-1 overflow-hidden rounded-[20px] border border-[#eadfd8] bg-white shadow-[0_12px_40px_rgba(93,56,34,0.07)]"><PreviewWorkbench key={dragKey} html={generatedHtml ?? ""} diagnostics={previewDiagnostics} initialDevice={initial.defaultDevice}/></div>}
          {view==="preview" && !generatedHtml && previewDiagnostics.length === 0 && <div className="min-h-0 flex-1 overflow-hidden rounded-[20px] border border-[#eadfd8] bg-white"><EmptyPreview/></div>}

          {projectId
            ? <div className={view === "code" ? "flex min-h-0 flex-1" : "hidden"} aria-hidden={view !== "code"}>
              <EditorWorkspace
                active={view === "code"}
                runtime={initial.runtime}
                projectId={projectId}
                files={builderFiles}
                entryPath={entryPath}
                initialFontSize={initial.editorFontSize}
                onFilesChange={setBuilderFiles}
                onEntryPathChange={setEntryPath}
                onPreviewChange={(html) => { setGeneratedHtml(html); setAutosaved(true); }}
              />
              </div>
            : view === "code" && <div className="flex flex-1 items-center justify-center text-sm" style={{ color:"var(--muted-foreground)" }}>Create the project before editing files.</div>}
          {view==="deployed" && <DeployedPanel html={generatedHtml} projectName={projectName}/>}

          {view === "preview" && <div className="mt-2 flex flex-shrink-0 items-center gap-2 rounded-[18px] border border-[#eadfd8] bg-white p-2 shadow-[0_10px_30px_rgba(93,56,34,0.08)] sm:mt-4 sm:gap-3 sm:p-4">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-[#f0e2d9] text-[#f29a70] shadow-sm"><Sparkles size={25}/></span>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); handleSend(); } }} rows={1} placeholder="Describe the app you want to build..." className="min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-base text-[#2d211b] outline-none placeholder:text-[#806b60]"/>
            <motion.button whileTap={{scale:0.98}} onClick={()=>handleSend()} disabled={!input.trim() || isTyping} className="inline-flex h-12 flex-shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ffb17f] to-[#e8835f] px-4 text-sm font-semibold text-white shadow-[0_7px_20px_rgba(232,131,95,0.3)] disabled:opacity-60 sm:px-7 sm:text-base"><Sparkles size={19}/><span className="hidden sm:inline">Generate App</span><span className="sm:hidden">Generate</span></motion.button>
          </div>}

          {/* Active build context bar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5" style={{ borderTop:"1px solid var(--border)", background:"var(--card)" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontFamily:"DM Mono,monospace", fontSize:9, color:"var(--accent)", fontWeight:600 }}>{selectedModel}</span>
              {[
                { count:activeConnectors, label:"Connector", plural:"Connectors" },
                { count:activeSkills,     label:"Skill", plural:"Skills" },
                { count:activeAgents,     label:"Agent", plural:"Agents" },
                { count:activeCaps,       label:"Capability", plural:"Capabilities" },
                { count:uploadedFiles.length, label:"File", plural:"Files" },
              ].map(item=>(
                item.count>0 && <span key={item.label} style={{ fontSize:9, color:"var(--muted-foreground)", fontFamily:"DM Mono,monospace" }}>
                  · {item.count} {item.count === 1 ? item.label : item.plural}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {autosaved
                ? <><div className="w-1.5 h-1.5 rounded-full" style={{ background:"#6BCB77" }}/><span style={{ fontSize:9, color:"var(--muted-foreground)" }}>Saved</span></>
                : <><motion.div className="w-1.5 h-1.5 rounded-full" style={{ background:"var(--accent)" }} animate={{ opacity:[1,0.3,1] }} transition={{ duration:1, repeat:Infinity }}/><span style={{ fontSize:9, color:"var(--muted-foreground)" }}>Saving…</span></>
              }
            </div>
          </div>
        </main>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {showConnector && <ConnectorPanel connectors={connectors} onToggle={toggleConnector} onClose={()=>setShowConnector(false)}/>}
        {showSkills    && <SkillsPanel    skills={skills}         onToggle={toggleSkill}     onClose={()=>setShowSkills(false)}/>}
        {showAgents    && <AgentsPanel    agents={agents}          onToggle={toggleAgent}     onClose={()=>setShowAgents(false)}/>}
        {showFunctions && <FunctionsPanel caps={capabilities}     onToggle={toggleCap}       onClose={()=>setShowFunctions(false)}/>}
        {showViewApp   && <ViewAppMenu    onClose={()=>setShowViewApp(false)} html={generatedHtml}/>}
      </AnimatePresence>

      {/* Click-away to close popovers */}
      {(showPlus||showModel) && (
        <div className="fixed inset-0 z-30" onClick={()=>{ setShowPlus(false); setShowModel(false); }}/>
      )}
    </div>
  );
}
export type { LotusBuilderProps };
