"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send, Smartphone, Tablet, Monitor, Sparkles,
  RefreshCw, Code2, Zap, ImageIcon, X, ChevronDown,
  Plus, Upload, FileText, Brain, Bot, Cpu, Undo2, Redo2,
  Globe, Copy, Download, Eye, Check, RotateCcw,
  Plug, GripVertical,
  LogOut,
} from "lucide-react";
import { LivePreview } from "@/components/lotus/live-preview";
import { runBuild, type WorkspaceMessage } from "@/app/actions/projects";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { redactSensitiveValues } from "@/lib/safety";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useResolvedTheme } from "@/components/lotus/use-resolved-theme";

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

// Open the generated app HTML full-screen in a new browser tab.
function openGeneratedApp(html: string | null) {
  if (!html) { toast.error("Generate an app first — then you can open it."); return; }
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  // Revoke after the new tab has had time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Copy a shareable data URL of the generated app to the clipboard.
async function copyGeneratedAppLink(html: string | null) {
  if (!html) { toast.error("Generate an app first — then you can copy its link."); return; }
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  try {
    await navigator.clipboard.writeText(dataUrl);
    toast.success("App link copied to your clipboard.");
  } catch {
    toast.error("Could not access the clipboard in this context.");
  }
}

// ─── Device frames ────────────────────────────────────────────────────────────
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position:"relative", width:234, height:480, flexShrink:0 }}>
      <div style={{ position:"absolute", inset:0, borderRadius:"2.6rem", background:"linear-gradient(160deg,#282828 0%,#0E0E0E 60%,#1A1A1A 100%)", boxShadow:"0 0 0 1px rgba(255,255,255,0.06),0 0 0 2px rgba(0,0,0,0.95),0 32px 80px rgba(0,0,0,0.6)" }}/>
      <div style={{ position:"absolute", inset:0, borderRadius:"2.6rem", background:"linear-gradient(135deg,rgba(255,255,255,0.07) 0%,transparent 45%,rgba(255,255,255,0.02) 100%)", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", inset:6, borderRadius:"2.2rem", overflow:"hidden", background:"#050505" }}>
        <div style={{ position:"absolute", top:9, left:"50%", transform:"translateX(-50%)", width:84, height:24, borderRadius:12, background:"#000", zIndex:10 }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 20px 4px", background:"#F0F4EE" }}>
          <span style={{ fontSize:9, fontWeight:700, color:"#2D4A3E" }}>9:41</span>
          <div style={{ width:10 }}/>
          <div style={{ width:12, height:7, borderRadius:2, background:"#2D4A3E", opacity:0.7 }}/>
        </div>
        <div style={{ height:"calc(100% - 33px)" }}>{children}</div>
      </div>
      {/* Buttons */}
      <div style={{ position:"absolute", right:-1.5, top:"30%", width:3, height:48, borderRadius:"0 2px 2px 0", background:"linear-gradient(180deg,#383838,#1E1E1E)" }}/>
      <div style={{ position:"absolute", left:-1.5, top:"26%", width:3, height:26, borderRadius:"2px 0 0 2px", background:"linear-gradient(180deg,#383838,#1E1E1E)" }}/>
      <div style={{ position:"absolute", left:-1.5, top:"36%", width:3, height:26, borderRadius:"2px 0 0 2px", background:"linear-gradient(180deg,#383838,#1E1E1E)" }}/>
    </div>
  );
}

function TabletFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position:"relative", width:500, height:360, flexShrink:0 }}>
      <div style={{ position:"absolute", inset:0, borderRadius:"1.75rem", background:"linear-gradient(145deg,#F0E8D0,#D4C49A)", boxShadow:"0 0 0 1.5px rgba(180,140,60,0.22),0 24px 56px rgba(0,0,0,0.16),inset 0 1px 0 rgba(255,255,255,0.5)" }}/>
      <div style={{ position:"absolute", inset:8, borderRadius:"1.4rem", overflow:"hidden", background:"#0A0A0A" }}>{children}</div>
      <div style={{ position:"absolute", bottom:8, left:"50%", transform:"translateX(-50%)", width:16, height:16, borderRadius:"50%", background:"linear-gradient(145deg,#D4C49A,#B8A070)" }}/>
    </div>
  );
}

function DesktopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flexShrink:0, display:"flex", flexDirection:"column", alignItems:"center", width:580 }}>
      <div style={{ position:"relative", width:"100%", borderRadius:"0.75rem 0.75rem 0 0", background:"linear-gradient(145deg,#EEE4C8,#D0BA8A)", padding:"8px 8px 0", boxShadow:"0 0 0 1.5px rgba(180,140,60,0.2),0 24px 64px rgba(0,0,0,0.2),inset 0 1px 0 rgba(255,255,255,0.5)" }}>
        <div style={{ display:"flex", justifyContent:"center", paddingBottom:6 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#1A1208" }}/>
        </div>
        <div style={{ borderRadius:"0.375rem 0.375rem 0 0", overflow:"hidden", aspectRatio:"16/9" }}>{children}</div>
      </div>
      <div style={{ width:"56%", height:10, background:"linear-gradient(180deg,#C4B07A,#A89060)" }}/>
      <div style={{ width:"70%", height:6, borderRadius:"0 0 0.5rem 0.5rem", background:"linear-gradient(180deg,#B8A070,#9A8055)", boxShadow:"0 2px 10px rgba(0,0,0,0.15)" }}/>
    </div>
  );
}

function DeviceFrame({ device, children }: { device:DeviceMode; children:React.ReactNode }) {
  if (device==="phone")  return <PhoneFrame>{children}</PhoneFrame>;
  if (device==="tablet") return <TabletFrame>{children}</TabletFrame>;
  return <DesktopFrame>{children}</DesktopFrame>;
}

function EmptyPreview() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 px-8 text-center" style={{ background:"var(--background)" }}>
      <Sparkles size={22} style={{ color:"var(--accent)" }}/>
      <p className="text-sm font-semibold" style={{ color:"var(--foreground)" }}>Your app will appear here</p>
      <p className="text-xs leading-relaxed" style={{ color:"var(--muted-foreground)" }}>Describe what you want to build in the chat.</p>
    </div>
  );
}

// ─── Code panel ───────────────────────────────────────────────────────────────
function CodePanel({ html, fontSize }: { html: string | null; fontSize: number }) {
  const files = html ? [{ name:"index.html", lang:"html", code: html }] : [];
  const [activeFile, setActiveFile] = useState(0);
  const [copied, setCopied] = useState(false);
  if (!files.length) {
    return <div className="flex flex-1 items-center justify-center text-sm" style={{ color:"var(--muted-foreground)" }}>Generate an app to inspect its source.</div>;
  }
  const file = files[Math.min(activeFile, files.length-1)];

  function handleCopy() {
    navigator.clipboard.writeText(file.code).catch(()=>{});
    setCopied(true);
    setTimeout(()=>setCopied(false), 1800);
  }

  function handleDownload() {
    const blob = new Blob([file.code], { type:"text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.split("/").pop() || "index.html";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* File tree */}
      <div className="flex-shrink-0 flex flex-col overflow-y-auto" style={{ width:188, borderRight:"1px solid var(--border)", background:"var(--card)" }}>
        <div className="px-3 py-2.5 text-xs font-semibold" style={{ color:"var(--muted-foreground)", letterSpacing:"0.06em", borderBottom:"1px solid var(--border)" }}>FILES</div>
        {files.map((f,i)=>(
          <button key={i} onClick={()=>setActiveFile(i)}
            className="flex items-center gap-2 px-3 py-2 text-left transition-colors"
            style={{ background:i===activeFile?"var(--muted)":"transparent", color:i===activeFile?"var(--foreground)":"var(--muted-foreground)", fontSize:11, fontFamily:"DM Mono,monospace", borderLeft: i===activeFile?"2px solid var(--accent)":"2px solid transparent" }}>
            <FileText size={11}/> {f.name.split("/").pop()}
          </button>
        ))}
      </div>

      {/* Code area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-2" style={{ borderBottom:"1px solid var(--border)", background:"var(--card)" }}>
          <span style={{ fontSize:11, fontFamily:"DM Mono,monospace", color:"var(--muted-foreground)" }}>{file.name}</span>
          <div className="flex gap-1">
            {[
              { icon:copied?<Check size={11}/>:<Copy size={11}/>, label:copied?"Copied":"Copy", fn:handleCopy },
              { icon:<Download size={11}/>,  label:"Download", fn:handleDownload },
            ].map(a=>(
              <button key={a.label} onClick={a.fn}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:opacity-80"
                style={{ background:"var(--muted)", color:"var(--muted-foreground)" }}>
                {a.icon}{a.label}
              </button>
            ))}
          </div>
        </div>
        {/* Code */}
        <div className="flex-1 overflow-auto p-5" style={{ background:"var(--background)", scrollbarWidth:"none" }}>
          <pre style={{ margin:0, fontFamily:"DM Mono,monospace", fontSize, lineHeight:1.7, color:"var(--foreground)", whiteSpace:"pre-wrap" }}>
            {file.code}
          </pre>
        </div>
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
            ? "Your app is built and running. Open it full-screen in a new tab or copy a local share link."
            : "Describe an app in chat to generate it — then you can open it live or copy a local share link."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 mt-2 justify-center">
        <button onClick={()=>openGeneratedApp(html)} disabled={!ready}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ background:"var(--primary)", color:"var(--primary-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>
          <Globe size={12}/> Open Live App
        </button>
        <button onClick={()=>copyGeneratedAppLink(html)} disabled={!ready}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{ background:"var(--muted)", color:"var(--muted-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>
          <Copy size={12}/> Copy Link
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
              {ready ? "Your app is built and ready to open in a new browser tab." : "No app generated yet — describe one in chat first."}
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <button onClick={()=>openGeneratedApp(html)} disabled={!ready}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:"var(--primary)", color:"var(--primary-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>Open Web App</button>
            <button onClick={()=>copyGeneratedAppLink(html)} disabled={!ready}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:"var(--muted)", color:"var(--muted-foreground)", opacity:ready?1:0.5, cursor:ready?"pointer":"not-allowed" }}>Copy Link</button>
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
  };
}

export default function App({ initial }: LotusBuilderProps) {
  const router = useRouter();
  const resolvedTheme = useResolvedTheme(initial.theme);
  const initialMessages: ChatMessage[] = initial.messages.length
    ? initial.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, ts: new Date(m.ts) }))
    : INIT_MESSAGES;

  // Core
  const [messages,  setMessages]  = useState<ChatMessage[]>(initialMessages);
  const [projectId, setProjectId] = useState<string | null>(initial.projectId);
  const [projectName, setProjectName] = useState<string>(initial.name || "Untitled");
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(initial.html);
  const [input,     setInput]     = useState("");
  const [isTyping,  setIsTyping]  = useState(false);
  const [device,    setDevice]    = useState<DeviceMode>(initial.defaultDevice);
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
  const [showAccount,   setShowAccount]   = useState(false);
  const [showConnector, setShowConnector] = useState(false);
  const [showSkills,    setShowSkills]    = useState(false);
  const [showAgents,    setShowAgents]    = useState(false);
  const [showFunctions, setShowFunctions] = useState(false);
  const [showViewApp,   setShowViewApp]   = useState(false);

  // Build state
  const [autosaved,    setAutosaved]    = useState(true);
  const [dragKey,      setDragKey]      = useState(0); // reset phone position
  const [history,      setHistory]      = useState<{ label:string; html:string|null }[]>([{ label:"Initial build", html: initial.html }]);
  const [historyIdx,   setHistoryIdx]   = useState(0);

  // Jump to a point in history and restore that HTML snapshot into the preview.
  function goToHistory(idx:number) {
    if (idx < 0 || idx >= history.length) return;
    setHistoryIdx(idx);
    setGeneratedHtml(history[idx].html);
    setView("preview");
  }

  const messagesEndRef  = useRef<HTMLDivElement>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);
  const imageInputRef   = useRef<HTMLInputElement>(null);
  const canvasRef       = useRef<HTMLDivElement>(null);
  const accountMenuRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages, isTyping]);

  // Close the account menu on outside click.
  useEffect(() => {
    if (!showAccount) return;
    function handler(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccount(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAccount]);

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
      const res = await runBuild({
        projectId,
        prompt: text,
        model: selectedModel,
        currentHtml: generatedHtml,
        context: {
          connectors:   connectors.filter(c=>c.connected).map(c=>c.name),
          skills:       skills.filter(s=>s.on).map(s=>s.name),
          agents:       agents.filter(a=>a.on).map(a=>a.name),
          capabilities: capabilities.filter(c=>c.active).map(c=>c.name),
          attachments:  uploadedFiles.map(f=>f.name),
        },
      });
      setProjectId(res.projectId);
      setProjectName(res.name);
      setGeneratedHtml(res.html);
      setView("preview");
      setMessages(p=>[...p,{ id:(Date.now()+1).toString(), role:"assistant", content:res.reply, ts:new Date() }]);
      setHistory(h=>[...h.slice(0,historyIdx+1), { label:safeText, html:res.html }]);
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
    <div className={`size-full flex flex-col overflow-hidden ${resolvedTheme === "dark" ? "dark" : ""}`} style={{ fontFamily:"Outfit,sans-serif", background:"var(--background)" }}>

      {/* ── Top bar ── */}
      <header className="flex-shrink-0 flex items-center justify-between px-5" style={{ height:60, borderBottom:"1px solid var(--border)", background:"var(--card)" }}>

        {/* Logo */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Image src={logoLotus} alt="Lotus" width={50} height={50} style={{ objectFit:"contain" }}/>
          <span style={{ fontFamily:"Fraunces,serif", fontWeight:500, fontSize:21, color:"var(--foreground)", letterSpacing:"-0.02em" }}>Lotus</span>
          {projectId && (
            <>
              <div className="h-4 w-px" style={{ background:"var(--border)" }}/>
              <span className="truncate max-w-[180px]" title={projectName}
                style={{ fontSize:13, fontWeight:500, color:"var(--muted-foreground)" }}>{projectName}</span>
            </>
          )}
        </div>

        {/* Device switcher */}
        <div className="flex items-center gap-1 px-1.5 py-1.5 rounded-xl" style={{ background:"var(--muted)", border:"1px solid var(--border)" }}>
          {(["phone","tablet","desktop"] as DeviceMode[]).map(d=>{
            const icons = { phone:<Smartphone size={12}/>, tablet:<Tablet size={12}/>, desktop:<Monitor size={12}/> };
            const labels = { phone:"Mobile", tablet:"Tablet", desktop:"Desktop" };
            const active = device===d;
            return (
              <motion.button key={d} onClick={()=>setDevice(d)} whileTap={{ scale:0.96 }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background:active?"var(--card)":"transparent", color:active?"var(--foreground)":"var(--muted-foreground)", boxShadow:active?"0 1px 4px rgba(0,0,0,0.08)":"none" }}>
                {icons[d]}<span className="hidden sm:inline">{labels[d]}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-2">
          {/* Undo/Redo */}
          <div className="flex items-center gap-0.5">
            <button onClick={()=>goToHistory(historyIdx-1)} disabled={historyIdx===0}
              title={historyIdx>0 ? `Undo · ${history[historyIdx-1].label}` : "Nothing to undo"}
              className="p-1.5 rounded-lg transition-all hover:opacity-80" style={{ color:historyIdx===0?"var(--muted-foreground)":"var(--foreground)", opacity:historyIdx===0?0.4:1 }}>
              <Undo2 size={13}/>
            </button>
            <button onClick={()=>goToHistory(historyIdx+1)} disabled={historyIdx===history.length-1}
              title={historyIdx<history.length-1 ? `Redo · ${history[historyIdx+1].label}` : "Nothing to redo"}
              className="p-1.5 rounded-lg transition-all hover:opacity-80" style={{ color:historyIdx===history.length-1?"var(--muted-foreground)":"var(--foreground)", opacity:historyIdx===history.length-1?0.4:1 }}>
              <Redo2 size={13}/>
            </button>
          </div>
          <div className="h-4 w-px mx-1" style={{ background:"var(--border)" }}/>
          <button onClick={()=>setShowViewApp(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
            style={{ background:"var(--secondary)", color:"var(--secondary-foreground)", border:"1px solid var(--border)" }}>
            <Eye size={11}/> View App
          </button>
          <motion.button whileTap={{ scale:0.97 }} onClick={()=>setView("deployed")}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold"
            style={{ background:"linear-gradient(135deg,#D4A030,#B87820)", color:"#FFF8E8", boxShadow:"0 2px 12px rgba(200,146,42,0.35)" }}>
            <Zap size={11}/> Share
          </motion.button>
          <div className="h-4 w-px mx-1" style={{ background:"var(--border)" }}/>
          <div className="relative" ref={accountMenuRef}>
            <button
              type="button"
              onClick={()=>setShowAccount(open=>!open)}
              aria-label={`Open account menu for ${initial.userName}`}
              aria-haspopup="menu"
              aria-expanded={showAccount}
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all hover:opacity-80"
              style={{ background:"var(--primary)", color:"var(--primary-foreground)" }}>
              {initial.userName.trim().charAt(0).toUpperCase() || "U"}
            </button>
            <AnimatePresence>
              {showAccount && (
                <motion.div
                  role="menu"
                  initial={{ opacity:0, y:-6, scale:0.97 }}
                  animate={{ opacity:1, y:0, scale:1 }}
                  exit={{ opacity:0, y:-4, scale:0.97 }}
                  className="absolute right-0 top-full mt-2 z-50 min-w-48 rounded-xl p-1.5"
                  style={{ background:"var(--card)", border:"1px solid var(--border)", boxShadow:"0 8px 32px rgba(0,0,0,0.13)" }}>
                  <div className="px-3 py-2 border-b" style={{ borderColor:"var(--border)" }}>
                    <p className="text-xs font-semibold truncate" style={{ color:"var(--foreground)" }}>{initial.userName}</p>
                    <p className="text-[10px]" style={{ color:"var(--muted-foreground)" }}>Signed in</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async ()=>{ await authClient.signOut(); router.push("/sign-in"); }}
                    className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors hover:bg-[var(--muted)]"
                    style={{ color:"var(--destructive)" }}>
                    <LogOut size={13}/> Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Chat panel ── */}
        <aside className="flex flex-col flex-shrink-0 overflow-hidden" style={{ width:256, borderRight:"1px solid var(--border)", background:"var(--card)" }}>

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
        <main className="flex-1 flex flex-col overflow-hidden" style={{ background:"var(--background)" }}>

          {/* Preview toolbar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2" style={{ borderBottom:"1px solid var(--border)", background:"var(--card)" }}>
            {/* View tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background:"var(--muted)" }}>
              {([["preview","Preview",<Eye key="preview" size={11}/>],["code","Code",<Code2 key="code" size={11}/>],["deployed","Deployed",<Zap key="deployed" size={11}/>]] as const).map(([k,l,icon])=>(
                <button key={k} onClick={()=>setView(k as BuildView)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background:view===k?"var(--card)":"transparent", color:view===k?"var(--foreground)":"var(--muted-foreground)", boxShadow:view===k?"0 1px 4px rgba(0,0,0,0.08)":"none" }}>
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
          {view==="preview" && (
            <div ref={canvasRef} className="flex-1 overflow-hidden relative" style={{
              backgroundImage:`radial-gradient(circle, rgba(44,34,20,0.07) 1px, transparent 1px)`,
              backgroundSize:"22px 22px",
            }}>
              <div className="absolute inset-0 pointer-events-none" style={{ background:"radial-gradient(ellipse at center, transparent 55%, rgba(245,237,216,0.65) 100%)" }}/>
              <AnimatePresence mode="wait">
                <motion.div key={`${device}-${dragKey}`}
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                  transition={{ duration:0.2 }}>
                  <motion.div drag dragMomentum={false} dragElastic={0} dragConstraints={canvasRef}
                    className="cursor-grab active:cursor-grabbing relative"
                    initial={{ scale:0.95, y:12 }} animate={{ scale:1, y:0 }}
                    transition={{ duration:0.3, ease:[0.22,1,0.36,1] }}>
                    {/* Grab affordance */}
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full pointer-events-none" style={{ background:"rgba(44,34,20,0.08)" }}>
                      <GripVertical size={10} style={{ color:"var(--muted-foreground)" }}/>
                      <span style={{ fontSize:9, color:"var(--muted-foreground)", fontWeight:500 }}>Drag</span>
                    </div>
                    <DeviceFrame device={device}>
                      {generatedHtml ? <LivePreview html={generatedHtml}/> : <EmptyPreview/>}
                    </DeviceFrame>
                  </motion.div>
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          {view==="code" && <CodePanel html={generatedHtml} fontSize={initial.editorFontSize}/>}
          {view==="deployed" && <DeployedPanel html={generatedHtml} projectName={projectName}/>}

          {/* Active build context bar */}
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5" style={{ borderTop:"1px solid var(--border)", background:"var(--card)" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontFamily:"DM Mono,monospace", fontSize:9, color:"var(--accent)", fontWeight:600 }}>{selectedModel}</span>
              {[
                { count:activeConnectors, label:"Connector" },
                { count:activeSkills,     label:"Skill" },
                { count:activeAgents,     label:"Agent" },
                { count:activeCaps,       label:"Capability" },
                { count:uploadedFiles.length, label:"File" },
              ].map(item=>(
                item.count>0 && <span key={item.label} style={{ fontSize:9, color:"var(--muted-foreground)", fontFamily:"DM Mono,monospace" }}>
                  · {item.count} {item.label}{item.count!==1?"s":""}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {autosaved
                ? <><div className="w-1.5 h-1.5 rounded-full" style={{ background:"#6BCB77" }}/><span style={{ fontSize:9, color:"var(--muted-foreground)" }}>Saved</span></>
                : <><motion.div className="w-1.5 h-1.5 rounded-full" style={{ background:"var(--accent)" }} animate={{ opacity:[1,0.3,1] }} transition={{ duration:1, repeat:Infinity }}/><span style={{ fontSize:9, color:"var(--muted-foreground)" }}>Saving…</span></>
              }
              <span style={{ fontSize:9, color:"var(--muted-foreground)", marginLeft:6, fontFamily:"DM Mono,monospace" }}>
                {DEVICE_CONFIGS_STATUS[device]}
              </span>
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
      {(showPlus||showModel) && <div className="fixed inset-0 z-30" onClick={()=>{ setShowPlus(false); setShowModel(false); }}/>}
    </div>
  );
}

// Status line dimensions per device
const DEVICE_CONFIGS_STATUS: Record<DeviceMode,string> = {
  phone:   "375 × 720",
  tablet:  "768 × 600",
  desktop: "1100 × 620",
};
